/** Retire a failed, unpublished amendment only after a remote restoration audit.
 * The failed job and its immutable publication checkpoints remain history. */
export function createOrganizerRecoveryRepository(database: D1Database, ensureTables: () => Promise<unknown>) {
  const eligible = `c.status = 'failed' AND c.publication_operation = 'AMEND'
    AND c.approved_at IS NOT NULL AND c.current_version = j.candidate_version
    AND j.status = 'failed' AND j.data_pr_number IS NOT NULL AND j.data_head_sha IS NOT NULL
    AND j.data_merge_sha IS NOT NULL AND j.main_merge_sha IS NULL AND j.workflow_run_id IS NULL
    AND j.remote_write_intent_at IS NOT NULL
    AND j.snapshot_id = s.id AND j.approval_hash = s.sha256
    AND EXISTS (SELECT 1 FROM accounts actor JOIN admins ON admins.email = actor.email
      WHERE actor.id = ?3 AND actor.deletion_started_at IS NULL)`;

  async function claimOrganizerRecoveryLease(input: { candidateId: string; expectedVersion: number; actorAccountId: string; now: number }) {
    await ensureTables();
    const token = crypto.randomUUID();
    const result = await database.prepare(`INSERT INTO organizer_publication_lease (id,job_id,token,acquired_at,expires_at)
      SELECT 'global',j.id,?4,?5,?5 + 60000 FROM organizer_event_candidates c
      JOIN organizer_publication_jobs j ON j.candidate_id = c.id
      JOIN organizer_submission_snapshots s ON s.candidate_id = c.id AND s.candidate_version = c.current_version
      WHERE c.id = ?1 AND c.current_version = ?2 AND ${eligible}
      ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id,token=excluded.token,
        acquired_at=excluded.acquired_at,expires_at=excluded.expires_at
      WHERE organizer_publication_lease.expires_at <= ?5`)
      .bind(input.candidateId, input.expectedVersion, input.actorAccountId, token, input.now).run();
    if (result.meta.changes !== 1) return null;
    return database.prepare("SELECT job_id AS jobId,token FROM organizer_publication_lease WHERE id='global' AND token=?1")
      .bind(token).first<{ jobId: string; token: string }>();
  }

  async function abandonRestoredOrganizerAmendment(input: {
    candidateId: string; expectedVersion: number; actorAccountId: string; now: number;
    job: { id: string; snapshot_id: string; approval_hash: string; data_pr_number: number | null;
      data_head_sha: string | null; data_merge_sha: string | null; main_pr_number: number | null;
      main_head_sha: string | null; step: string; remote_write_intent_at: number | null };
    leaseToken: string; baselineSha256: string; reason: string; evidence: Record<string, string | number>;
  }) {
    await ensureTables();
    const reviewId = crypto.randomUUID();
    const reviewed = "EXISTS (SELECT 1 FROM organizer_event_reviews WHERE id=?1)";
    const result = await database.batch([
      database.prepare(`INSERT INTO organizer_event_reviews
        (id,candidate_id,version,from_status,to_status,actor_account_id,note,at)
        SELECT ?4,c.id,c.current_version,'failed','abandoned',?3,?5,?6
        FROM organizer_event_candidates c JOIN organizer_publication_jobs j ON j.candidate_id=c.id
        JOIN organizer_submission_snapshots s ON s.candidate_id=c.id AND s.candidate_version=c.current_version
        JOIN organizer_amendments a ON a.candidate_id=c.id
        WHERE c.id=?1 AND c.current_version=?2 AND ${eligible}
          AND a.baseline_sha256=?7 AND j.id=json_extract(?8,'$.id')
          AND j.snapshot_id=json_extract(?8,'$.snapshot_id') AND j.approval_hash=json_extract(?8,'$.approval_hash')
          AND j.data_pr_number=json_extract(?8,'$.data_pr_number') AND j.data_head_sha=json_extract(?8,'$.data_head_sha')
          AND j.data_merge_sha=json_extract(?8,'$.data_merge_sha') AND j.step=json_extract(?8,'$.step')
          AND j.main_pr_number IS json_extract(?8,'$.main_pr_number') AND j.main_head_sha IS json_extract(?8,'$.main_head_sha')
          AND j.remote_write_intent_at=json_extract(?8,'$.remote_write_intent_at')
          AND EXISTS (SELECT 1 FROM organizer_publication_lease WHERE id='global' AND job_id=j.id AND token=?9 AND expires_at>?6)`)
        .bind(input.candidateId, input.expectedVersion, input.actorAccountId, reviewId, input.reason, input.now,
          input.baselineSha256, JSON.stringify(input.job), input.leaseToken),
      database.prepare(`UPDATE organizer_event_candidates SET status='abandoned',updated_at=?2,last_updated_by=?3,last_updated_role='admin'
        WHERE id=?4 AND ${reviewed}`).bind(reviewId, input.now, input.actorAccountId, input.candidateId),
      database.prepare(`UPDATE organizer_publication_jobs SET retryable=0 WHERE id=?2 AND ${reviewed}`).bind(reviewId, input.job.id),
      database.prepare(`INSERT INTO audit_log (id,at,actor_account_id,actor_role,action,subject_type,subject_id,detail_json)
        SELECT ?2,?3,?4,'admin','organizer.amendment.abandoned','organizer_event',?5,?6 WHERE ${reviewed}`)
        .bind(reviewId, crypto.randomUUID(), input.now, input.actorAccountId, input.candidateId,
          JSON.stringify({ reason: input.reason, jobId: input.job.id, approvalHash: input.job.approval_hash,
            baselineSha256: input.baselineSha256, ...input.evidence })),
      database.prepare("DELETE FROM organizer_publication_lease WHERE id='global' AND job_id=?1 AND token=?2")
        .bind(input.job.id, input.leaseToken),
    ]);
    return result[0].meta.changes === 1;
  }
  return { claimOrganizerRecoveryLease, abandonRestoredOrganizerAmendment };
}
