import type { OrganizerNormalizedImportRow } from "../app/organizer-import";

type Actor = { accountId: string; role: "owner" | "editor" | "admin"; admin: boolean; now: number };
type AmendmentRow = {
  candidate_id: string; source_candidate_id: string; source_version: number; source_job_id: string;
  baseline_json: string; baseline_sha256: string; created_at: number; changes_json: string; changes_version: number;
};

/** Candidate writes only. The handler derives the baseline and rows from trusted
 * publication evidence; the transaction rechecks authority and source state. */
export function createOrganizerAmendmentRepository(database: D1Database, ensureTables: () => Promise<unknown>) {
  const revisionExists = "EXISTS (SELECT 1 FROM organizer_event_revisions WHERE id = ?1)";
  const actorRole = (actor: Actor) => actor.admin ? "admin" : actor.role;
  function audit(revisionId: string, candidateId: string, actor: Actor, action: string, detail: unknown) {
    return database.prepare(`INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json)
      SELECT ?2, ?3, ?4, ?5, ?6, 'organizer_event', ?7, ?8 WHERE ${revisionExists}`)
      .bind(revisionId, crypto.randomUUID(), actor.now, actor.accountId,
        actor.admin ? "admin" : `organizer_${actor.role}`, action, candidateId, JSON.stringify(detail));
  }
  function importStatements(revisionId: string, candidateId: string, version: number, actor: Actor,
    rows: readonly OrganizerNormalizedImportRow[], hash: string) {
    const sourceId = crypto.randomUUID();
    const statements = [
      database.prepare(`UPDATE organizer_import_sources SET replaced_at = ?2
        WHERE candidate_id = ?3 AND replaced_at IS NULL AND ${revisionExists}`)
        .bind(revisionId, actor.now, candidateId),
      database.prepare(`INSERT INTO organizer_import_sources (id, candidate_id, candidate_version, file_name, worksheet,
        sha256, source_description, mapping_json, created_by, created_by_role, created_at)
        SELECT ?2, ?3, ?4, '已發布名單修正', NULL, ?5, '依已發布基準及明確修正宣告產生', '{}', ?6, ?7, ?8 WHERE ${revisionExists}`)
        .bind(revisionId, sourceId, candidateId, version, hash, actor.accountId, actorRole(actor), actor.now),
    ];
    for (let offset = 0; offset < rows.length; offset += 500) {
      statements.push(database.prepare(`INSERT INTO organizer_import_rows
        (id, source_id, candidate_id, source_row, day_id, venue_space_id, area_id, booth_code, codes_json, circle_name, stable_key, identity_group)
        SELECT lower(hex(randomblob(16))), ?2, ?3,
          json_extract(item.value, '$.sourceRow'), json_extract(item.value, '$.dayId'), json_extract(item.value, '$.venueSpaceId'),
          json_extract(item.value, '$.areaId'), json_extract(item.value, '$.codes[0]'), json_extract(item.value, '$.codes'),
          json_extract(item.value, '$.circleName'), json_extract(item.value, '$.stableKey'), json_extract(item.value, '$.identityGroup')
        FROM json_each(?4) item WHERE ${revisionExists}`)
        .bind(revisionId, sourceId, candidateId, JSON.stringify(rows.slice(offset, offset + 500))));
    }
    return statements;
  }

  async function getOrganizerAmendment(candidateId: string): Promise<AmendmentRow | null> {
    await ensureTables();
    return database.prepare(`SELECT a.*, changes.changes_json, changes.version AS changes_version
      FROM organizer_amendments a JOIN organizer_amendment_changes changes ON changes.candidate_id = a.candidate_id
      WHERE a.candidate_id = ?1 ORDER BY changes.version DESC LIMIT 1`).bind(candidateId).first<AmendmentRow>();
  }

  async function createOrganizerAmendment(input: {
    id: string; sourceCandidateId: string; sourceVersion: number; sourceJobId: string;
    sourceSnapshotId: string; sourceApprovalHash: string; sourceMainCommit: string;
    eventId: string; draftJson: string; baselineJson: string; baselineSha256: string;
    rows: readonly OrganizerNormalizedImportRow[];
    maps: ReadonlyArray<{ periodKey: string; venueSpaceId: string; content: unknown }>;
    actor: Actor;
  }) {
    await ensureTables();
    const { actor } = input;
    const revisionId = crypto.randomUUID();
    const statements = [
      database.prepare(`INSERT INTO organizer_event_candidates
        (id, tentative_name, event_id, event_id_locked_at, status, current_version, current_draft_json,
         created_by, created_at, updated_at, last_updated_by, last_updated_role, publication_operation)
        SELECT ?1, c.tentative_name, c.event_id, ?2, 'draft', 1, ?3, ?4, ?2, ?2, ?4, ?5, 'AMEND'
        FROM organizer_event_candidates c JOIN organizer_publication_jobs j ON j.candidate_id = c.id
        JOIN organizer_submission_snapshots s ON s.id = j.snapshot_id
        WHERE c.id = ?6 AND c.current_version = ?7 AND c.published_version = ?7 AND c.status = 'published'
          AND c.event_id = ?8 AND j.id = ?9 AND j.status = 'published' AND j.candidate_version = ?7
          AND j.snapshot_id = ?10 AND j.approval_hash = ?11 AND s.sha256 = ?11 AND j.main_merge_sha = ?12
          AND (?13 = 1 OR EXISTS (SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = c.id
            AND g.account_id = ?4 AND g.role = 'owner' AND g.revoked_at IS NULL))`)
        .bind(input.id, actor.now, input.draftJson, actor.accountId, actorRole(actor), input.sourceCandidateId,
          input.sourceVersion, input.eventId, input.sourceJobId, input.sourceSnapshotId, input.sourceApprovalHash,
          input.sourceMainCommit, actor.admin ? 1 : 0),
      database.prepare(`INSERT INTO organizer_event_revisions
        (id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at)
        SELECT ?1, id, 1, event_id, current_draft_json, ?2, ?3, ?4 FROM organizer_event_candidates WHERE id = ?5`)
        .bind(revisionId, actor.accountId, actorRole(actor), actor.now, input.id),
      database.prepare(`INSERT INTO organizer_amendments
        (candidate_id, source_candidate_id, source_version, source_job_id, baseline_json, baseline_sha256, created_at)
        SELECT ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${revisionExists}`)
        .bind(revisionId, input.id, input.sourceCandidateId, input.sourceVersion, input.sourceJobId, input.baselineJson, input.baselineSha256, actor.now),
      database.prepare(`INSERT INTO organizer_amendment_changes (candidate_id, version, changes_json, revision_id, created_at)
        SELECT ?2, 1, '[]', ?1, ?3 WHERE ${revisionExists}`).bind(revisionId, input.id, actor.now),
      database.prepare(`INSERT INTO organizer_workspace_state
        (candidate_id, onboarding_completed_at, onboarding_completed_by, last_validated_version, created_at, updated_at)
        SELECT ?2, ?3, ?4, NULL, ?3, ?3 WHERE ${revisionExists}`).bind(revisionId, input.id, actor.now, actor.accountId),
      database.prepare(`INSERT INTO organizer_event_grants
        (id, candidate_id, account_id, role, granted_by, granted_at, revoked_by, revoked_at)
        SELECT lower(hex(randomblob(16))), ?2, account_id, role, ?3, ?4, NULL, NULL FROM organizer_event_grants
        WHERE candidate_id = ?5 AND revoked_at IS NULL AND ${revisionExists}`)
        .bind(revisionId, input.id, actor.accountId, actor.now, input.sourceCandidateId),
      ...importStatements(revisionId, input.id, 1, actor, input.rows, input.baselineSha256),
    ];
    for (const map of input.maps) {
      const id = crypto.randomUUID();
      statements.push(
        database.prepare(`INSERT INTO map_drafts
          (id, event_id, candidate_id, period_key, venue_space_id, owner_account_id, status, current_revision, created_at, updated_at, last_activity_at)
          SELECT ?2, ?3, ?4, ?5, ?6, ?7, 'draft', 1, ?8, ?8, ?8 WHERE ${revisionExists}`)
          .bind(revisionId, id, input.eventId, input.id, map.periodKey, map.venueSpaceId, actor.accountId, actor.now),
        database.prepare(`INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
          SELECT ?2, ?3, 1, ?4, ?5, ?6 WHERE ${revisionExists}`)
          .bind(revisionId, crypto.randomUUID(), id, JSON.stringify(map.content), actor.accountId, actor.now),
      );
    }
    statements.push(audit(revisionId, input.id, actor, "organizer.amendment.create", {
      sourceCandidateId: input.sourceCandidateId, sourceVersion: input.sourceVersion,
      sourceJobId: input.sourceJobId, baselineSha256: input.baselineSha256,
    }));
    try {
      const result = await database.batch(statements);
      return result[0].meta.changes === 1 ? { ok: true as const, candidateId: input.id, version: 1 } : { ok: false as const };
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) return { ok: false as const };
      throw error;
    }
  }

  async function saveOrganizerAmendment(input: {
    candidateId: string; expectedVersion: number; baselineSha256: string;
    changesJson: string; changesSha256: string; rows: readonly OrganizerNormalizedImportRow[]; actor: Actor;
  }) {
    await ensureTables();
    const { actor } = input;
    const version = input.expectedVersion + 1;
    const revisionId = crypto.randomUUID();
    // Insert a unique operation revision first. Every subsequent write is
    // anchored to this token, not just a coincident timestamp/account/version.
    const statements = [
      database.prepare(`INSERT INTO organizer_event_revisions
        (id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at)
        SELECT ?1, c.id, ?2, c.event_id, c.current_draft_json, ?3, ?4, ?5
        FROM organizer_event_candidates c JOIN organizer_amendments a ON a.candidate_id = c.id
        WHERE c.id = ?6 AND c.current_version = ?7 AND c.publication_operation = 'AMEND'
          AND c.status IN ('draft', 'changes_requested') AND a.baseline_sha256 = ?8
          AND (?9 = 1 OR EXISTS (SELECT 1 FROM organizer_event_grants g
            WHERE g.candidate_id = c.id AND g.account_id = ?3 AND g.revoked_at IS NULL))`)
        .bind(revisionId, version, actor.accountId, actorRole(actor), actor.now, input.candidateId,
          input.expectedVersion, input.baselineSha256, actor.admin ? 1 : 0),
      database.prepare(`UPDATE organizer_event_candidates SET current_version = ?2, updated_at = ?3, last_updated_by = ?4,
        last_updated_role = ?5 WHERE id = ?6 AND ${revisionExists}`)
        .bind(revisionId, version, actor.now, actor.accountId, actorRole(actor), input.candidateId),
      database.prepare(`INSERT INTO organizer_amendment_changes (candidate_id, version, changes_json, revision_id, created_at)
        SELECT ?2, ?3, ?4, ?1, ?5 WHERE ${revisionExists}`).bind(revisionId, input.candidateId, version, input.changesJson, actor.now),
      ...importStatements(revisionId, input.candidateId, version, actor, input.rows, input.changesSha256),
      audit(revisionId, input.candidateId, actor, "organizer.amendment.save", {
        version, baselineSha256: input.baselineSha256, changesSha256: input.changesSha256,
      }),
    ];
    try {
      const result = await database.batch(statements);
      return result[0].meta.changes === 1 ? { ok: true as const, version } : { ok: false as const };
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) return { ok: false as const };
      throw error;
    }
  }
  return { getOrganizerAmendment, createOrganizerAmendment, saveOrganizerAmendment };
}
