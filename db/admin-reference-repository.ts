import type { OrganizerReferenceRecord } from '../app/organizer-reference-catalog';
import { organizerVenueNameKey, type OrganizerVenueSpaceAreaMode } from '../app/organizer-venue-catalog';

export type AdminReferenceWrite = {
  record: OrganizerReferenceRecord;
  previous?: OrganizerReferenceRecord;
  newVenue?: { name: string; sourceUrl: string };
  newSpace?: { id: string; venueId: string; name: string; sourceUrl: string; defaultAreaMode: OrganizerVenueSpaceAreaMode; record: OrganizerReferenceRecord };
  actorAccountId: string;
  now: number;
};

/** Only the first statement authorizes a mutation. All dependent writes and
 * the audit follow changes() inside the same atomic batch. */
export function createAdminReferenceRepository(database: D1Database, ensureTables: () => Promise<void>) {
  async function saveAdminReference(input: AdminReferenceWrite) {
    await ensureTables();
    const { record: row, actorAccountId: actor, previous } = input;
    const admin = `EXISTS (SELECT 1 FROM accounts a JOIN admins ON admins.email = a.email
      WHERE a.id = ?9 AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL)`;
    const statements = previous ? [database.prepare(`UPDATE organizer_reference_records SET public_reference_json = ?7
      WHERE path = ?1 AND kind = 'venue' AND reference_id = ?3 AND public_reference_json = ?10
        AND json_extract(public_reference_json, '$.address') IS NULL AND ${admin}`)
      .bind(row.path, row.kind, row.id, row.organizerId, row.revision, row.displayName,
        row.publicReferenceJson, row.sourceCapturedAt, actor, previous.publicReferenceJson)] : [database.prepare(`INSERT INTO organizer_reference_records
      (path, kind, reference_id, organizer_id, revision, display_name, public_reference_json, source_captured_at, created_by)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${admin}
        AND (?4 IS NULL OR EXISTS (SELECT 1 FROM organizer_reference_records WHERE kind = 'organizer' AND reference_id = ?4))
        AND (?2 != 'venue' OR ?10 = 1 OR EXISTS (SELECT 1 FROM organizer_venues WHERE id = ?3))
        AND (?2 != 'venue-space' OR EXISTS (SELECT 1 FROM organizer_venues WHERE id = json_extract(?7, '$.venueId')))
        AND (?2 != 'venue-space' OR ?11 = 1 OR EXISTS (SELECT 1 FROM organizer_venue_spaces
          WHERE id = ?3 AND venue_id = json_extract(?7, '$.venueId')))
      ON CONFLICT(path) DO NOTHING`).bind(row.path, row.kind, row.id, row.organizerId, row.revision, row.displayName,
        row.publicReferenceJson, row.sourceCapturedAt, actor, input.newVenue ? 1 : 0, input.newSpace ? 1 : 0)];
    if (input.newVenue) statements.push(database.prepare(`INSERT INTO organizer_venues (id, name, name_key, source_url, created_by, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE changes() = 1`).bind(row.id, input.newVenue.name,
      organizerVenueNameKey(input.newVenue.name), input.newVenue.sourceUrl, actor, input.now));
    const space = input.newSpace;
    if (space) {
      statements.push(database.prepare(`INSERT INTO organizer_venue_spaces
        (id, venue_id, name, name_key, source_url, default_area_mode, created_by, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() = 1`).bind(space.id, space.venueId, space.name,
          organizerVenueNameKey(space.name), space.sourceUrl, space.defaultAreaMode, actor, input.now));
      if (input.newVenue) {
        const ref = space.record;
        statements.push(database.prepare(`INSERT INTO organizer_reference_records
          (path, kind, reference_id, organizer_id, revision, display_name, public_reference_json, source_captured_at, created_by)
          SELECT ?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?7 WHERE changes() = 1`).bind(ref.path, ref.kind, ref.id,
            ref.displayName, ref.publicReferenceJson, ref.sourceCapturedAt, actor));
      }
    }
    statements.push(database.prepare(`INSERT INTO audit_log
      (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
      SELECT ?1, ?2, ?3, 'admin', ?4, 'organizer_reference', ?5, ?6, NULL WHERE changes() = 1`)
      .bind(crypto.randomUUID(), input.now, actor, previous ? 'organizer_reference.address_completed' : 'organizer_reference.created', row.id,
        JSON.stringify({ scope: 'shared', kind: row.kind, ...(space ? { venueSpaceId: space.id } : {}) })));
    try {
      const results = await database.batch(statements);
      return results[0].meta.changes === 1;
    } catch (error) {
      if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) return false;
      throw error;
    }
  }
  return { saveAdminReference };
}
