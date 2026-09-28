import { IDENTITY_COLUMN_MIGRATIONS, IDENTITY_INDEXES, IDENTITY_TABLES } from "./identity-runtime-schema";
import { INITIAL_ORGANIZER_VENUE_CATALOG, organizerVenueNameKey } from "../app/organizer-venue-catalog";
import { initialVenueReferences, type OrganizerReferenceRecord } from "../app/organizer-reference-catalog";
import runtimeVersion from "./identity-runtime-version.json";

export const IDENTITY_RUNTIME_VERSION = runtimeVersion.version;

/** One successful database initialization survives replacement of a Pages isolate.
 * Versions are monotonic and upgrades must remain additive/backward compatible.
 * A newer marker is never a reason for an older deployment to run its old DDL.
 */
export function createIdentityInitializer(database: D1Database) {
  let ready: Promise<void> | null = null;

  async function initialize() {
    let current: { version: number } | null;
    try {
      current = await database.prepare("SELECT version FROM identity_runtime_state WHERE id = 1")
        .first<{ version: number }>();
    } catch (error) {
      // Only a missing marker table is an uninitialized database. Never turn a
      // transport, permission or other SQL failure into an empty public overlay.
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such table: (?:main\.)?identity_runtime_state(?:[\s:]|$)/i.test(message)) throw error;
      current = null;
    }
    if (current && current.version >= IDENTITY_RUNTIME_VERSION) return;

    // The order is load-bearing: old tables need their new columns before an
    // index using those columns can be created. Partial failure is retryable.
    await database.batch(IDENTITY_TABLES.map(({ sql }) => database.prepare(sql)));
    await addMissingColumns();
    await upgradeOrganizerEventIndex();
    await database.batch(IDENTITY_INDEXES.map(({ sql }) => database.prepare(sql)));
    await seedOrganizerVenueCatalog(database);
    await database.prepare(`INSERT INTO identity_runtime_state (id, version) VALUES (1, ?1)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version
      WHERE identity_runtime_state.version < excluded.version`).bind(IDENTITY_RUNTIME_VERSION).run();
  }

  return function ensureRuntimeReady() {
    if (!ready) ready = initialize().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  async function addMissingColumns() {
    for (const migration of IDENTITY_COLUMN_MIGRATIONS) {
      try {
        await database.prepare(migration.sql).run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/duplicate column name/i.test(message)) throw error;
      }
    }
  }

  async function upgradeOrganizerEventIndex() {
    const previous = await database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'organizer_candidates_event_id_idx'").first<{ sql: string }>();
    if (previous && !previous.sql.includes("publication_operation")) {
      const replacement = IDENTITY_INDEXES.find(({ name }) => name === "organizer_candidates_event_id_idx")!;
      // Keep the same name and replace atomically. Older deployment isolates
      // using CREATE INDEX IF NOT EXISTS cannot recreate the obsolete rule.
      await database.batch([
        database.prepare("DROP INDEX IF EXISTS organizer_candidates_event_id_idx"),
        database.prepare(replacement.sql),
      ]);
    }
    const active = await database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'organizer_candidates_active_amendment_idx'").first<{ sql: string }>();
    if (active && !active.sql.includes("abandoned")) {
      await database.batch([
        database.prepare("DROP INDEX IF EXISTS organizer_candidates_active_amendment_idx"),
        database.prepare(IDENTITY_INDEXES.find(({ name }) => name === "organizer_candidates_active_amendment_idx")!.sql),
      ]);
    }
  }


}

export function referenceInsertStatement(database: D1Database, record: OrganizerReferenceRecord, actor: string, conflict = "") {
  return database.prepare(`INSERT INTO organizer_reference_records
    (path, kind, reference_id, organizer_id, revision, display_name, public_reference_json, source_captured_at, created_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ${conflict}`)
    .bind(record.path, record.kind, record.id, record.organizerId, record.revision, record.displayName,
      record.publicReferenceJson, record.sourceCapturedAt, actor);
}

export async function seedOrganizerVenueCatalog(database: D1Database) {
  const statements: D1PreparedStatement[] = [];
  for (const venue of INITIAL_ORGANIZER_VENUE_CATALOG) {
    statements.push(database.prepare(
      `INSERT INTO organizer_venues (id, name, name_key, source_url, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, 'system', 0)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(venue.id, venue.name, organizerVenueNameKey(venue.name), venue.sourceUrl));
    for (const space of venue.spaces) {
      statements.push(database.prepare(
        `INSERT INTO organizer_venue_spaces (
           id, venue_id, name, name_key, source_url, default_area_mode, created_by, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'system', 0)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(space.id, venue.id, space.name, organizerVenueNameKey(space.name), space.sourceUrl, space.defaultAreaMode));
    }
  }
  if (statements.length > 0) await database.batch(statements);
  // Explicit adoption only for seed identities whose existing metadata still matches.
  // Never repair a changed canonical record by overwriting it during startup.
  for (const reference of initialVenueReferences()) {
    const venue = INITIAL_ORGANIZER_VENUE_CATALOG.find((item) => item.id === reference.id);
    const space = INITIAL_ORGANIZER_VENUE_CATALOG.flatMap((item) => item.spaces.map((space) => ({ ...space, venueId: item.id })))
      .find((item) => item.id === reference.id);
    const compatible = venue
      ? await database.prepare("SELECT id FROM organizer_venues WHERE id = ?1 AND name = ?2 AND source_url = ?3")
        .bind(venue.id, venue.name, venue.sourceUrl).first()
      : space && await database.prepare("SELECT id FROM organizer_venue_spaces WHERE id = ?1 AND name = ?2 AND source_url = ?3 AND venue_id = ?4")
        .bind(space.id, space.name, space.sourceUrl, space.venueId).first();
    if (compatible) await referenceInsertStatement(database, reference, "system", "ON CONFLICT(path) DO NOTHING").run();
  }
}

