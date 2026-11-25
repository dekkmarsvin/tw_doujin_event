/**
 * The initial venue catalog and its reference records (#546 5d). The schema
 * comes from `migrations/`; only this data is seeded at control-plane start,
 * and only where it is missing.
 */
import { INITIAL_ORGANIZER_VENUE_CATALOG, organizerVenueNameKey } from "../app/organizer-venue-catalog";
import { initialVenueReferences, type OrganizerReferenceRecord } from "../app/organizer-reference-catalog";

export function referenceInsertStatement(database: D1Database, record: OrganizerReferenceRecord, actor: string, conflict = "", requireChange = false) {
  return database.prepare(`INSERT INTO organizer_reference_records
    (path, kind, reference_id, organizer_id, revision, display_name, public_reference_json, source_captured_at, created_by)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${requireChange ? 'changes() = 1' : '1 = 1'} ${conflict}`)
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
