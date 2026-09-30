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

// Shared by the advisory GET and the conditional write. History is intentional:
// records that have supplied a snapshot must never change under the same path.
const referenceUsed = `r.created_by = 'system'
  OR EXISTS (SELECT 1 FROM organizer_event_revisions v WHERE
    (r.kind = 'organizer' AND EXISTS (SELECT 1 FROM json_each(v.draft_json, '$.references.organizerAssignments') a WHERE json_extract(a.value, '$.organizerId') = r.reference_id))
    OR (r.kind = 'category-catalog' AND json_extract(v.draft_json, '$.references.categoryCatalog.id') = r.reference_id AND json_extract(v.draft_json, '$.references.categoryCatalog.revision') = r.revision)
    OR (r.kind IN ('venue', 'venue-space') AND EXISTS (SELECT 1 FROM json_each(v.draft_json, '$.venue.assignments') a WHERE
      (r.kind = 'venue' AND json_extract(a.value, '$.venueId') = r.reference_id) OR (r.kind = 'venue-space' AND json_extract(a.value, '$.venueSpaceId') = r.reference_id))))
  OR EXISTS (SELECT 1 FROM organizer_submission_snapshots s, json_tree(s.snapshot_json) j WHERE j.atom = r.path)
  OR (r.kind = 'venue-space' AND (EXISTS (SELECT 1 FROM map_drafts WHERE venue_space_id = r.reference_id)
    OR EXISTS (SELECT 1 FROM organizer_import_rows WHERE venue_space_id = r.reference_id)))
  OR (r.kind = 'venue' AND EXISTS (SELECT 1 FROM organizer_venues WHERE id = r.reference_id AND created_by = 'system'))
  OR (r.kind = 'venue-space' AND EXISTS (SELECT 1 FROM organizer_venue_spaces WHERE id = r.reference_id AND created_by = 'system'))`;
const hasDependents = `(r.kind = 'organizer' AND EXISTS (SELECT 1 FROM organizer_reference_records c WHERE c.organizer_id = r.reference_id))
  OR (r.kind = 'venue' AND EXISTS (SELECT 1 FROM organizer_venue_spaces s WHERE s.venue_id = r.reference_id))`;
const lastRevision = `(SELECT MAX(n) FROM (
  SELECT CAST(revision AS INTEGER) AS n FROM organizer_reference_records WHERE kind = 'category-catalog' AND reference_id = ?3
  UNION ALL SELECT revision FROM organizer_category_sequences WHERE reference_id = ?3))`;

/** Only the first statement authorizes a mutation. All dependent writes and
 * the audit follow changes() inside the same atomic batch. */
export function createAdminReferenceRepository(database: D1Database, ensureTables: () => Promise<void>) {
  async function listAdminReferenceAccess() {
    await ensureTables();
    return (await database.prepare(`SELECT r.path, (${referenceUsed}) AS used, (${hasDependents}) AS dependents
      FROM organizer_reference_records r`).all<{ path: string; used: number; dependents: number }>()).results;
  }
  async function nextAdminCategoryRevision(id: string) {
    await ensureTables();
    const row = await database.prepare(`SELECT COALESCE(${lastRevision}, 0) + 1 AS revision`).bind(null, null, id).first<{ revision: number }>();
    return String(row!.revision);
  }
  async function mutateAdminReference(input: {
    previous: OrganizerReferenceRecord; record?: OrganizerReferenceRecord; action: 'edit' | 'delete';
    actorAccountId: string; now: number; defaultAreaMode?: OrganizerVenueSpaceAreaMode; previousAreaMode?: OrganizerVenueSpaceAreaMode;
  }) {
    await ensureTables();
    const old = input.previous, row = input.record ?? old;
    const revise = input.action === 'edit' && old.kind === 'category-catalog';
    const guard = `r.path = ?1 AND r.public_reference_json = ?2 AND r.display_name = ?10
      AND EXISTS (SELECT 1 FROM accounts a JOIN admins ON admins.email = a.email WHERE a.id = ?4 AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL)
      ${revise ? `AND CAST(?8 AS INTEGER) = ${lastRevision} + 1` : `AND NOT (${referenceUsed})`}
      ${input.action === 'delete' ? `AND NOT (${hasDependents})` : ''}
      ${old.kind === 'venue-space' ? `AND EXISTS (SELECT 1 FROM organizer_venue_spaces WHERE id = ?3 AND default_area_mode = ?11)` : ''}`;
    const query = revise ? `INSERT INTO organizer_reference_records
      (path, kind, reference_id, organizer_id, revision, display_name, public_reference_json, source_captured_at, created_by)
      SELECT ?9, r.kind, r.reference_id, r.organizer_id, ?8, ?6, ?5, ?7, ?4 FROM organizer_reference_records r WHERE ${guard}`
      : input.action === 'delete' ? `DELETE FROM organizer_reference_records AS r WHERE ${guard}`
      : `UPDATE organizer_reference_records AS r SET public_reference_json = ?5, display_name = ?6, source_captured_at = ?7 WHERE ${guard}`;
    const bindings = [old.path, old.publicReferenceJson, old.id, input.actorAccountId, row.publicReferenceJson, row.displayName, input.now, row.revision, row.path, old.displayName,
      ...(old.kind === 'venue-space' ? [input.previousAreaMode!] : [])];
    const statements = [database.prepare(query).bind(...bindings)];
    if (revise) statements.push(database.prepare(`INSERT INTO organizer_category_sequences (reference_id, revision)
      SELECT ?1, ?2 WHERE changes() = 1 ON CONFLICT(reference_id) DO UPDATE SET revision = excluded.revision`)
      .bind(old.id, Number(row.revision)));
    // Use the first write's success to gate both metadata and audit atomically.
    if (old.kind === 'venue' || old.kind === 'venue-space') {
      const table = old.kind === 'venue' ? 'organizer_venues' : 'organizer_venue_spaces';
      const value = JSON.parse(row.publicReferenceJson);
      statements.push(input.action === 'delete'
        ? database.prepare(`DELETE FROM ${table} WHERE id = ?1 AND changes() = 1`).bind(old.id)
        : database.prepare(`UPDATE ${table} SET name = ?2, name_key = ?3, source_url = ?4 ${old.kind === 'venue-space' ? ', default_area_mode = ?5' : ''} WHERE id = ?1 AND changes() = 1`)
          .bind(old.id, value.name, organizerVenueNameKey(value.name), value.officialUrl ?? value.sources[0].url, ...(old.kind === 'venue-space' ? [input.defaultAreaMode!] : [])));
    }
    statements.push(database.prepare(`INSERT INTO audit_log
      (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
      SELECT ?1, ?2, ?3, 'admin', ?4, 'organizer_reference', ?5, ?6, NULL WHERE changes() = 1`)
      .bind(crypto.randomUUID(), input.now, input.actorAccountId, `organizer_reference.${revise ? 'revised' : input.action === 'delete' ? 'deleted' : 'edited'}`, old.id,
        JSON.stringify({ scope: 'shared', kind: old.kind, path: row.path, revision: row.revision })));
    try { return (await database.batch(statements))[0].meta.changes === 1; }
    catch (error) { if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) return false; throw error; }
  }
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
  return { saveAdminReference, listAdminReferenceAccess, nextAdminCategoryRevision, mutateAdminReference };
}
