import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { createOrganizerPublicationExecutor } = await environment.runner.import("/app/organizer-publication.ts");
const { sha256Hex } = await environment.runner.import("/app/portal-crypto.ts");
const databaseHost = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-reopen-test" },
}));
const database = await databaseHost.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await databaseHost.dispose(); await vite.close(); });

const NOW = 1_788_000_000_000;
let adminId;
let ownerId;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
  adminId = await repository.upsertAccount("admin@example.test", NOW);
  ownerId = await repository.upsertAccount("owner@example.test", NOW);
});

async function failedCandidate(jobId = "reopen-job") {
  const candidateId = "reopen-candidate";
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "reopen-event", name: "Reopen", days: [] },
    venue: { assignments: [] },
    officialSource: { label: "", url: null },
  };
  await repository.createOrganizerCandidate({
    id: candidateId, tentativeName: "Reopen", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(draft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await database.prepare("UPDATE organizer_event_candidates SET event_id = 'reopen-event' WHERE id = ?1").bind(candidateId).run();
  const snapshotJson = JSON.stringify({ candidateId, candidateVersion: 1, eventId: "reopen-event" });
  const hash = await sha256Hex(snapshotJson);
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({
    candidateId, candidateVersion: 1, actorAccountId: ownerId, snapshotJson, sha256: hash, now: NOW + 2,
  });
  await repository.submitOrganizerCandidate({ candidateId, actorAccountId: ownerId, expectedVersion: 1, now: NOW + 3 });
  const approved = await repository.reviewOrganizerCandidate({
    candidateId, expectedVersion: 1, decision: "approve", actorAccountId: adminId,
    publication: { jobId, snapshotId: snapshot.snapshotId, approvalHash: hash }, now: NOW + 4,
  });
  assert.equal(approved.ok, true);
  await database.prepare(
    `UPDATE organizer_event_candidates SET status = 'failed', approved_by = ?1, approved_at = ?2 WHERE id = ?3`,
  ).bind(adminId, NOW + 4, candidateId).run();
  await database.prepare(
    `UPDATE organizer_publication_jobs SET status = 'failed', step = 'preparing_data', retryable = 1,
       data_pr_number = NULL, data_head_sha = NULL, data_merge_sha = NULL,
       main_pr_number = NULL, main_head_sha = NULL, main_merge_sha = NULL,
       workflow_run_id = NULL, remote_write_intent_at = NULL WHERE id = ?1`,
  ).bind(jobId).run();
  return { candidateId, jobId, snapshotId: snapshot.snapshotId, hash };
}

function audit(candidateId, reason = "資料需要補充") {
  return {
    at: NOW + 10, actorAccountId: ownerId, actorRole: "organizer_owner",
    action: "organizer_event.reopened", subjectType: "organizer_event", subjectId: candidateId,
    detail: { reason }, ipHash: null,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test("reopen advances the version, preserves event identity/history, and retires the failed job atomically", async () => {
  const { candidateId, jobId } = await failedCandidate();
  const lease = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 10, ttlMs: 30_000,
  });
  assert.equal(lease.ok, true);
  const result = await repository.reopenFailedOrganizerCandidate({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, reason: "資料需要補充",
    jobId, leaseToken: lease.token, now: NOW + 10, audit: audit(candidateId),
  });
  assert.deepEqual(result, { ok: true, status: "changes_requested", version: 2, jobId });

  const candidate = await repository.getOrganizerCandidate(candidateId);
  assert.equal(candidate.status, "changes_requested");
  assert.equal(candidate.current_version, 2);
  assert.equal(candidate.event_id, "reopen-event");
  assert.equal(candidate.event_id_locked_at !== null, true);
  assert.equal(candidate.approved_at, null);
  const revisions = await repository.listOrganizerCandidateRevisions(candidateId);
  assert.deepEqual(revisions.map(({ version, event_id, created_by_role }) => ({ version, event_id, created_by_role })), [
    { version: 1, event_id: null, created_by_role: "admin" },
    { version: 2, event_id: "reopen-event", created_by_role: "owner" },
  ]);
  const review = await database.prepare(
    "SELECT version, from_status, to_status, actor_account_id, note FROM organizer_event_reviews WHERE candidate_id = ?1 ORDER BY at DESC LIMIT 1",
  ).bind(candidateId).first();
  assert.deepEqual(review, {
    version: 2, from_status: "failed", to_status: "changes_requested", actor_account_id: ownerId, note: "資料需要補充",
  });
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.retryable, 0);
  assert.equal(await repository.hasOrganizerPublicationLease(jobId, lease.token, NOW + 10), false);
  const auditRow = await database.prepare(
    "SELECT action, detail_json FROM audit_log WHERE subject_id = ?1 ORDER BY at DESC LIMIT 1",
  ).bind(candidateId).first();
  assert.equal(auditRow.action, "organizer_event.reopened");
  assert.equal(JSON.parse(auditRow.detail_json).reason, "資料需要補充");
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId, now: NOW + 11 }), {
    ok: false, reason: "not_retryable", status: "failed",
  });
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId, leaseToken: lease.token, expectedStep: "preparing_data", nextStep: "preparing_data",
    status: "failed", error: "stale", retryable: true, now: NOW + 11,
  }), false);
});

test("reopen claim fails closed for intent, checkpoints, and a live global lease", async () => {
  const { candidateId, jobId } = await failedCandidate("reopen-guards");
  const first = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 10, ttlMs: 30_000,
  });
  assert.equal(first.ok, true);
  const busy = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 11, ttlMs: 30_000,
  });
  assert.deepEqual(busy, { ok: false, reason: "busy" });
  await repository.releaseOrganizerPublicationLease(jobId, first.token);

  await database.prepare("UPDATE organizer_publication_jobs SET remote_write_intent_at = ?1 WHERE id = ?2")
    .bind(NOW + 12, jobId).run();
  const intent = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 13, ttlMs: 30_000,
  });
  assert.deepEqual(intent, { ok: false, reason: "remote_write_started" });

  await database.prepare("UPDATE organizer_publication_jobs SET remote_write_intent_at = NULL, data_pr_number = 42 WHERE id = ?1")
    .bind(jobId).run();
  const checkpoint = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 14, ttlMs: 30_000,
  });
  assert.deepEqual(checkpoint, { ok: false, reason: "started" });
  const checkpoints = [
    ["data_pr_number", 1], ["data_head_sha", "a".repeat(40)], ["data_merge_sha", "b".repeat(40)],
    ["main_pr_number", 2], ["main_head_sha", "c".repeat(40)], ["main_merge_sha", "d".repeat(40)],
    ["workflow_run_id", 3],
  ];
  for (const [column, value] of checkpoints) {
    await database.prepare(`UPDATE organizer_publication_jobs SET
      data_pr_number = NULL, data_head_sha = NULL, data_merge_sha = NULL,
      main_pr_number = NULL, main_head_sha = NULL, main_merge_sha = NULL,
      workflow_run_id = NULL, remote_write_intent_at = NULL, ${column} = ?1 WHERE id = ?2`)
      .bind(value, jobId).run();
    assert.deepEqual(await repository.claimFailedOrganizerCandidateReopenLease({
      candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 15, ttlMs: 30_000,
    }), { ok: false, reason: "started" });
  }
});

test("an expired executor keeps remote-write intent sticky when its remote mutation is released", async () => {
  const { candidateId, jobId } = await failedCandidate("reopen-intent");
  await database.prepare("UPDATE organizer_event_candidates SET status = 'publishing' WHERE id = ?1")
    .bind(candidateId).run();
  await database.prepare("UPDATE organizer_publication_jobs SET status = 'publishing' WHERE id = ?1")
    .bind(jobId).run();
  let clock = NOW + 10;
  let remoteMutationCalls = 0;
  const mutationStarted = deferred();
  const remoteMutation = deferred();
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async ({ beginRemoteWrite }) => {
      await beginRemoteWrite();
      remoteMutationCalls += 1;
      mutationStarted.resolve();
      return remoteMutation.promise;
    },
  }, () => clock);
  const executing = execute(jobId);
  await mutationStarted.promise;
  const intentBeforeExpiry = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(intentBeforeExpiry.remote_write_intent_at !== null, true);
  clock += 30_001;
  remoteMutation.resolve({});
  await executing;

  const failedJob = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(remoteMutationCalls, 1);
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.retryable, 1);
  assert.equal(failedJob.remote_write_intent_at !== null, true);
  assert.equal([
    failedJob.data_pr_number, failedJob.data_head_sha, failedJob.data_merge_sha,
    failedJob.main_pr_number, failedJob.main_head_sha, failedJob.main_merge_sha,
    failedJob.workflow_run_id,
  ].every((value) => value === null), true);
  const refused = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: clock, ttlMs: 30_000,
  });
  assert.deepEqual(refused, { ok: false, reason: "remote_write_started" });
});

test("a stale executor is fenced before beginRemoteWrite after a valid reopen", async () => {
  const { candidateId, jobId, snapshotId, hash } = await failedCandidate("reopen-fenced");
  await database.prepare("UPDATE organizer_event_candidates SET status = 'publishing' WHERE id = ?1")
    .bind(candidateId).run();
  await database.prepare("UPDATE organizer_publication_jobs SET status = 'publishing' WHERE id = ?1")
    .bind(jobId).run();
  let clock = NOW + 20;
  const driverEntered = deferred();
  const releaseDriver = deferred();
  let remoteMutationCalls = 0;
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async ({ beginRemoteWrite }) => {
      driverEntered.resolve();
      await releaseDriver.promise;
      await beginRemoteWrite();
      remoteMutationCalls += 1;
      return { metadata: { data_pr_number: 17, data_head_sha: "a".repeat(40) } };
    },
  }, () => clock);
  const executing = execute(jobId);
  await driverEntered.promise;
  const oldLease = await database.prepare(
    "SELECT token, expires_at FROM organizer_publication_lease WHERE id = 'global' AND job_id = ?1",
  ).bind(jobId).first();
  assert.ok(oldLease);
  clock = oldLease.expires_at + 1;
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId, leaseToken: oldLease.token, expectedStep: "preparing_data", nextStep: "preparing_data",
    status: "failed", error: "Publication lease expired.", failureCode: "lease_lost", retryable: true,
    allowExpiredFailure: true, now: clock,
  }), true);
  const failed = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryable, 1);

  const reopenLease = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: clock, ttlMs: 30_000,
  });
  assert.equal(reopenLease.ok, true);
  const reopened = await repository.reopenFailedOrganizerCandidate({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, reason: "先修正資料",
    jobId, leaseToken: reopenLease.token, now: clock, audit: { ...audit(candidateId, "先修正資料"), at: clock },
  });
  assert.deepEqual(reopened, { ok: true, status: "changes_requested", version: 2, jobId });
  assert.deepEqual(await repository.claimOrganizerPublicationLease({ jobId, now: clock + 1, ttlMs: 30_000 }), {
    ok: false, reason: "busy",
  });
  assert.equal(await repository.markOrganizerPublicationRemoteWriteIntent({
    jobId, leaseToken: oldLease.token, now: clock + 1,
  }), false);
  assert.equal(await repository.hasOrganizerPublicationLease(jobId, oldLease.token, clock + 1), false);

  releaseDriver.resolve();
  await assert.rejects(executing, (error) => error?.code === "lease_lost");
  assert.equal(remoteMutationCalls, 0);
  const candidate = await repository.getOrganizerCandidate(candidateId);
  assert.equal(candidate.current_version, 2);
  assert.equal(candidate.status, "changes_requested");
  const currentJob = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(currentJob.status, "failed");
  assert.equal(currentJob.retryable, 0);
  assert.equal(currentJob.candidate_version, 1);
  assert.equal(currentJob.snapshot_id, snapshotId);
  assert.equal(currentJob.approval_hash, hash);
  assert.equal(currentJob.remote_write_intent_at, null);
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId, now: clock + 2 }), {
    ok: false, reason: "not_retryable", status: "failed",
  });
});

test("a stale reopen commit cannot add a revision, review, or audit after its candidate CAS no longer matches", async () => {
  const { candidateId, jobId } = await failedCandidate("reopen-stale");
  const lease = await repository.claimFailedOrganizerCandidateReopenLease({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, now: NOW + 10, ttlMs: 30_000,
  });
  assert.equal(lease.ok, true);
  await database.prepare("UPDATE organizer_event_candidates SET current_version = 2, status = 'changes_requested', approved_at = NULL WHERE id = ?1")
    .bind(candidateId).run();
  const before = await database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE subject_id = ?1").bind(candidateId).first();
  const result = await repository.reopenFailedOrganizerCandidate({
    candidateId, expectedVersion: 1, actorAccountId: ownerId, reason: "stale",
    jobId, leaseToken: lease.token, now: NOW + 10, audit: audit(candidateId, "stale"),
  });
  assert.deepEqual(result, { ok: false, reason: "conflict" });
  const after = await database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE subject_id = ?1").bind(candidateId).first();
  assert.equal(after.count, before.count);
  assert.equal((await repository.listOrganizerCandidateRevisions(candidateId)).length, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM organizer_event_reviews WHERE candidate_id = ?1").bind(candidateId).first()).count, 1);
  await repository.releaseOrganizerPublicationLease(jobId, lease.token);
});
