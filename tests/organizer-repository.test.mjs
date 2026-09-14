import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
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
const { createOrganizerPublicationExecutor, PublicationFailure, publicationHasStarted, QUEUED_PUBLICATION_TIMEOUT_MS } = await environment.runner.import("/app/organizer-publication.ts");
const { publicationFailureMessage } = await environment.runner.import("/app/organizer-publication-presentation.ts");
const { sha256Hex } = await environment.runner.import("/app/portal-crypto.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-repository-test" },
}));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const NOW = 1_788_000_000_000;
let adminId;
let ownerId;
let editorId;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
  adminId = await repository.upsertAccount("admin@example.test", NOW);
  ownerId = await repository.upsertAccount("owner@example.test", NOW);
  editorId = await repository.upsertAccount("editor@example.test", NOW);
});

const initialDraft = {
  schema: "organizer-event-draft/1",
  event: { id: null, name: "PF 候選活動", days: [] },
  venue: { assignments: [] },
  officialSource: { label: "", url: null },
};

async function publicationFixture() {
  const id = "publication-candidate";
  await repository.createOrganizerCandidate({ id, tentativeName: "Publication", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify({ ...initialDraft, event: { ...initialDraft.event, id: "second-event" } }), now: NOW });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await database.prepare("UPDATE organizer_event_candidates SET event_id = 'second-event' WHERE id = ?1").bind(id).run();
  const snapshotJson = JSON.stringify({ candidateId: id, candidateVersion: 1, eventId: "second-event" });
  const hash = await sha256Hex(snapshotJson);
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({ candidateId: id, candidateVersion: 1,
    actorAccountId: ownerId, snapshotJson, sha256: hash, now: NOW + 2 });
  await repository.submitOrganizerCandidate({ candidateId: id, actorAccountId: ownerId, expectedVersion: 1, now: NOW + 3 });
  const publication = { jobId: "publication-job", snapshotId: snapshot.snapshotId, approvalHash: hash };
  const approved = await repository.reviewOrganizerCandidate({ candidateId: id, expectedVersion: 1,
    decision: "approve", actorAccountId: adminId, publication, now: NOW + 4 });
  assert.equal(approved.status, "publishing");
  return { id, jobId: publication.jobId };
}

function checkpoint(step) {
  return ({ preparing_data: { data_pr_number: 1, data_head_sha: "a".repeat(40) },
    merging_data: { data_merge_sha: "b".repeat(40) },
    preparing_main: { main_pr_number: 2, main_head_sha: "c".repeat(40) },
    merging_main: { main_merge_sha: "d".repeat(40) }, waiting_deployment: { workflow_run_id: 3 } })[step] ?? {};
}

test("expired publication lease records a retryable failure without losing its step", async () => {
  const { jobId } = await publicationFixture();
  let clock = NOW + 10;
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async () => { clock += 31_000; return { metadata: checkpoint("preparing_data") }; },
  }, () => clock);
  await execute(jobId);
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.failure_code, "lease_lost");
  assert.equal(job.retryable, 1);
  assert.equal(job.step, "preparing_data");
  assert.equal((await repository.retryOrganizerPublicationJob({ jobId, now: clock + 1 })).ok, true);
});

test("an expired executor cannot overwrite or release a newer lease", async () => {
  const { jobId } = await publicationFixture();
  let clock = NOW + 10;
  let newer;
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async () => {
      clock += 31_000;
      newer = await repository.claimOrganizerPublicationLease({ jobId, now: clock, ttlMs: 30_000 });
      return {};
    },
  }, () => clock);
  await assert.rejects(execute(jobId), (error) => error.code === "lease_lost");
  assert.equal(newer.ok, true);
  assert.equal(await repository.hasOrganizerPublicationLease(jobId, newer.token, clock), true);
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).status, "publishing");
});

test("nullish metadata preserves the checkpoint from a pending delivery", async () => {
  const { jobId } = await publicationFixture();
  let pending = true;
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async () => pending ? { pending: true, metadata: checkpoint("preparing_data") }
      : { metadata: { data_pr_number: null, data_head_sha: undefined } },
  }, () => NOW + 10);
  await execute(jobId);
  pending = false;
  await execute(jobId);
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.step, "waiting_data_checks");
  assert.equal(job.status, "publishing");
  assert.equal(job.data_pr_number, 1);
  assert.equal(job.data_head_sha, "a".repeat(40));
});

test("repeated approval reuses the same job and rejects a different approval hash", async () => {
  const { id, jobId } = await publicationFixture();
  const job = await repository.getOrganizerPublicationJob(jobId);
  const input = { candidateId: id, expectedVersion: 1, decision: "approve", actorAccountId: adminId,
    publication: { jobId: "another-job", snapshotId: job.snapshot_id, approvalHash: job.approval_hash }, now: NOW + 20 };
  const original = await repository.getOrganizerCandidate(id);
  const result = await repository.reviewOrganizerCandidate(input);
  assert.equal(result.ok, true);
  assert.equal(result.publicationJobId, jobId);
  assert.equal(result.alreadyReviewed, true);
  assert.deepEqual(await repository.getOrganizerCandidate(id), original);
  assert.equal(await repository.getOrganizerPublicationJob("another-job"), null);
  assert.equal((await repository.reviewOrganizerCandidate({ ...input,
    publication: { ...input.publication, approvalHash: "mismatch" } })).reason, "approval_mismatch");

  await database.prepare("UPDATE organizer_event_candidates SET status = 'submitted', approved_at = NULL WHERE id = ?1").bind(id).run();
  const reused = await repository.reviewOrganizerCandidate(input);
  assert.equal(reused.ok, true);
  assert.equal(reused.publicationJobId, jobId);
  assert.equal((await repository.getOrganizerCandidate(id)).status, "publishing");
});

test("publication resumes main and smoke failures without recreating successful data or main steps", async () => {
  const { id, jobId } = await publicationFixture();
  const calls = [];
  let failure = "preparing_main";
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async ({ step, assertLease }) => {
      await assertLease();
      calls.push(step);
      if (step === failure) throw new PublicationFailure("test_outage", "temporary", true);
      return { metadata: checkpoint(step), productionVerified: step === "verifying_production" };
    },
  }, () => NOW + 10);
  for (let i = 0; i < 4; i++) await execute(jobId);
  let job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.step, "preparing_main");
  assert.equal(job.data_merge_sha, "b".repeat(40));
  assert.equal((await repository.getOrganizerCandidate(id)).status, "failed");
  await execute(jobId);
  assert.equal(calls.length, 4, "a webhook cannot silently retry a failed publication");
  await repository.retryOrganizerPublicationJob({ jobId, now: NOW + 11 });
  failure = "verifying_production";
  for (let i = 0; i < 5; i++) await execute(jobId);
  job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.step, "verifying_production");
  assert.equal(job.main_merge_sha, "d".repeat(40));
  await repository.retryOrganizerPublicationJob({ jobId, now: NOW + 12 });
  failure = null;
  await execute(jobId);
  await execute(jobId);
  assert.equal((await repository.getOrganizerCandidate(id)).status, "published");
  for (const step of ["preparing_data", "merging_data", "preparing_main", "merging_main"]) {
    assert.equal(calls.filter((value) => value === step).length, step === "preparing_main" ? 2 : 1);
  }
  assert.equal((await repository.getLatestOrganizerPublicationJob(id)).id, jobId);
});

test("a job nobody dispatched times out into the existing retry path", async () => {
  const { id, jobId } = await publicationFixture();
  const queuedAt = (await repository.getOrganizerPublicationJob(jobId)).updated_at;
  const expire = (now) => repository.expireStalledOrganizerPublicationJobs({ now, timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS });

  assert.deepEqual(await expire(queuedAt + QUEUED_PUBLICATION_TIMEOUT_MS - 1), { expired: [] });
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).status, "queued");

  const timedOut = queuedAt + QUEUED_PUBLICATION_TIMEOUT_MS;
  assert.deepEqual(await expire(timedOut), { expired: [jobId] });
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.failure_code, "queued_timeout");
  assert.equal(job.retryable, 1);
  assert.equal(job.step, "preparing_data", "the job failed on the step it never started");
  assert.equal((await repository.getOrganizerCandidate(id)).status, "failed");

  // The two layers have to meet here. This is the job the approval flow
  // creates, and its owner is the one who must not be sent looking for
  // progress that was never made. Asserting the step alone let the wording key
  // on `assemble`, which only the older creation path ever wrote.
  assert.equal(publicationHasStarted(job), false);
  assert.match(publicationFailureMessage({
    failureCode: job.failure_code, retryable: Boolean(job.retryable), started: publicationHasStarted(job),
  }), /發布沒有開始/);

  // No second way to start a publication: recovery is the retry that already exists.
  const retried = await repository.retryOrganizerPublicationJob({ jobId, now: timedOut + 1 });
  assert.equal(retried.ok, true);
  assert.equal(retried.step, "preparing_data");
  assert.equal((await repository.getOrganizerCandidate(id)).status, "publishing");

  // A live lease owns its job even where a lost delivery left the row queued.
  const lease = await repository.claimOrganizerPublicationLease({ jobId, now: timedOut + 2, ttlMs: 30_000 });
  assert.equal(lease.ok, true);
  await database.prepare("UPDATE organizer_publication_jobs SET status = 'queued', updated_at = ?1 WHERE id = ?2")
    .bind(queuedAt, jobId).run();
  assert.deepEqual(await expire(timedOut + 3), { expired: [] });
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).status, "queued");
});

test("a timeout that follows real progress keeps the retryable wording", async () => {
  const { jobId } = await publicationFixture();
  const queuedAt = (await repository.getOrganizerPublicationJob(jobId)).updated_at;
  const lease = await repository.claimOrganizerPublicationLease({ jobId, now: queuedAt, ttlMs: 30_000 });
  // What the executor writes when a step completes: it refuses to advance a
  // step whose checkpoint is missing, so a job past `preparing_data` always
  // carries one. This timeout really did stop part-way.
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId, leaseToken: lease.token, expectedStep: "preparing_data", nextStep: "merging_data",
    status: "failed", error: "temporary", retryable: true, now: queuedAt,
    metadata: { data_pr_number: 7, data_head_sha: "a".repeat(40) },
  }), true);
  assert.equal((await repository.retryOrganizerPublicationJob({ jobId, now: queuedAt + 1 })).ok, true);

  const timedOut = queuedAt + 1 + QUEUED_PUBLICATION_TIMEOUT_MS;
  assert.deepEqual(await repository.expireStalledOrganizerPublicationJobs({
    now: timedOut, timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS,
  }), { expired: [jobId] });
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.failure_code, "queued_timeout");
  assert.equal(job.step, "merging_data", "retry keeps the step the job failed on");
  assert.equal(publicationHasStarted(job), true);
  assert.doesNotMatch(publicationFailureMessage({
    failureCode: job.failure_code, retryable: Boolean(job.retryable), started: publicationHasStarted(job),
  }), /發布沒有開始/);
});

test("CREATE collision is permanent, leaves content locked and never calls the adapter", async () => {
  const { id, jobId } = await publicationFixture();
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => true, run: async () => assert.fail("must not publish"),
  }, () => NOW + 10);
  await execute(jobId);
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.failure_code, "event_id_collision");
  assert.equal(job.retryable, 0);
  assert.equal((await repository.retryOrganizerPublicationJob({ jobId, now: NOW + 11 })).reason, "not_retryable");
  assert.equal((await repository.getOrganizerCandidate(id)).status, "failed");
});

test("tampered snapshot fails closed before any remote publication effect", async () => {
  const { jobId } = await publicationFixture();
  await database.prepare("UPDATE organizer_submission_snapshots SET snapshot_json = '{}' ").run();
  await createOrganizerPublicationExecutor(repository, {
    eventExists: async () => assert.fail("must not query remote"), run: async () => assert.fail("must not publish"),
  }, () => NOW + 10)(jobId);
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).failure_code, "snapshot_mismatch");
});

test("pending checks preserve step and release the delivery lease for a later delivery", async () => {
  const { jobId } = await publicationFixture();
  let pending = true;
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false,
    run: async ({ step }) => ({ pending: step === "waiting_data_checks" && pending, metadata: checkpoint(step) }),
  }, () => NOW + 10);
  await execute(jobId);
  await execute(jobId);
  await execute(jobId);
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).step, "waiting_data_checks");
  pending = false;
  await execute(jobId);
  assert.equal((await repository.getOrganizerPublicationJob(jobId)).step, "merging_data");
});

test("production verification must explicitly pass before completing publication", async () => {
  const { jobId } = await publicationFixture();
  const execute = createOrganizerPublicationExecutor(repository, {
    eventExists: async () => false, run: async ({ step }) => ({ metadata: checkpoint(step) }),
  }, () => NOW + 10);
  for (let i = 0; i < 8; i++) await execute(jobId);
  const job = await repository.getOrganizerPublicationJob(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.failure_code, "production_smoke_failed");
  assert.equal(job.step, "verifying_production");
});

test("an admin creates an empty event entry and its invited owner gains only that event", async () => {
  const created = await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  assert.deepEqual(created, { ok: true, version: 1 });

  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: ownerId,
    email: "owner@example.test",
    now: NOW + 1,
  }), [{ candidateId: "candidate-pf", role: "owner" }]);

  const ownerEvents = await repository.listOrganizerCandidatesForAccount(ownerId, false);
  assert.equal(ownerEvents.length, 1);
  assert.equal(ownerEvents[0].id, "candidate-pf");
  assert.equal(ownerEvents[0].role, "owner");
  assert.equal(ownerEvents[0].status, "draft");
  assert.deepEqual(await repository.listOrganizerCandidatesForAccount(editorId, false), []);

  const adminEvents = await repository.listOrganizerCandidatesForAccount(adminId, true);
  assert.equal(adminEvents.length, 1);
  assert.equal(adminEvents[0].role, "admin");
});

test("an admin named as their own event's owner is granted it in the creating transaction", async () => {
  const created = await repository.createOrganizerCandidate({
    id: "candidate-self-owned",
    tentativeName: "自己負責的候選活動",
    ownerEmail: "admin@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
    ownerGrant: { accountId: adminId, audit: {
      at: NOW, actorAccountId: adminId, actorRole: "admin",
      action: "organizer_event.owner_granted_on_create", subjectType: "organizer_event",
      subjectId: "candidate-self-owned", detail: { reason: "creator_is_owner" },
    } },
  });
  assert.deepEqual(created, { ok: true, version: 1 });
  assert.equal(await repository.organizerRole("candidate-self-owned", adminId), "owner");

  // The grant and the audit row that explains it are in the same batch: an
  // account holding owner with nothing saying why is not an outcome to allow.
  const audit = await database.prepare(
    "SELECT action, actor_role FROM audit_log WHERE subject_id = ?1",
  ).bind("candidate-self-owned").all();
  assert.deepEqual(audit.results.map((row) => `${row.actor_role}:${row.action}`),
    ["admin:organizer_event.owner_granted_on_create"]);

  // The invitation is stamped accepted at creation, so the ordinary sign-in
  // path finds nothing pending and cannot mint a second grant.
  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: adminId, email: "admin@example.test", now: NOW + 1,
  }), []);
  assert.equal((await database.prepare(
    "SELECT COUNT(*) AS total FROM organizer_event_grants WHERE candidate_id = ?1",
  ).bind("candidate-self-owned").first()).total, 1);

  // Everyone else still reaches the workspace through the invitation.
  await repository.createOrganizerCandidate({
    id: "candidate-invited",
    tentativeName: "別人負責的候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  assert.equal(await repository.organizerRole("candidate-invited", ownerId), null);
  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: ownerId, email: "owner@example.test", now: NOW + 2,
  }), [{ candidateId: "candidate-invited", role: "owner" }]);
});

test("workspace progress is per candidate and resume location is per collaborator without candidate revisions", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-workspace",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerCollaborator({
    candidateId: "candidate-workspace", actorAccountId: ownerId,
    email: "editor@example.test", role: "editor", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const ownerWorkspace = await repository.getOrganizerWorkspace("candidate-workspace", ownerId);
  assert.equal(ownerWorkspace.state.onboarding_completed_at, null);
  assert.equal(ownerWorkspace.preference, null);
  assert.equal((await repository.listOrganizerCandidatesForAccount(ownerId, false))[0].workspace_mode, "guided");

  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-workspace", accountId: ownerId,
    guidedTask: "days", lastSection: "import", now: NOW + 4,
  }), true);
  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-workspace", accountId: editorId,
    guidedTask: "venue", lastSection: "map", now: NOW + 5,
  }), true);
  assert.equal((await repository.getOrganizerWorkspace("candidate-workspace", ownerId)).preference.last_section, "import");
  assert.equal((await repository.getOrganizerWorkspace("candidate-workspace", editorId)).preference.last_section, "map");
  assert.deepEqual((await repository.listOrganizerCandidateRevisions("candidate-workspace")).map((row) => row.version), [1]);

  const completions = await Promise.all([
    repository.completeOrganizerOnboarding({
      candidateId: "candidate-workspace", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 6,
    }),
    repository.completeOrganizerOnboarding({
      candidateId: "candidate-workspace", actorAccountId: editorId, expectedVersion: 1, now: NOW + 7,
    }),
  ]);
  assert.equal(completions.every((result) => result.ok), true);
  assert.equal(completions.filter((result) => result.ok && !result.alreadyCompleted).length, 1);
  assert.equal(completions.filter((result) => result.ok && result.alreadyCompleted).length, 1);
  const completedAt = completions.find((result) => result.ok && !result.alreadyCompleted).completedAt;
  assert.deepEqual(await repository.completeOrganizerOnboarding({
    candidateId: "candidate-workspace", actorAccountId: editorId, expectedVersion: 99, now: NOW + 8,
  }), { ok: true, completedAt, alreadyCompleted: true });
  assert.equal((await repository.listOrganizerCandidatesForAccount(ownerId, false))[0].workspace_mode, "binder");
  assert.equal((await repository.getOrganizerCandidate("candidate-workspace")).current_version, 1);
  assert.deepEqual((await repository.listOrganizerCandidateRevisions("candidate-workspace")).map((row) => row.version), [1]);
});

test("a revoked collaborator cannot change workspace navigation or complete onboarding", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-revoked-workspace",
    tentativeName: "撤銷測試活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoked-workspace", actorAccountId: ownerId,
    email: "editor@example.test", role: "editor", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-revoked-workspace", accountId: editorId,
    guidedTask: "days", lastSection: "event", now: NOW + 4,
  }), true);
  await repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoked-workspace", actorAccountId: ownerId,
    email: "editor@example.test", role: "editor", action: "revoke", now: NOW + 5,
  });

  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-revoked-workspace", accountId: editorId,
    guidedTask: "venue", lastSection: "map", now: NOW + 6,
  }), false);
  assert.equal((await repository.getOrganizerWorkspace("candidate-revoked-workspace", editorId)).preference.last_section, "event");
  assert.deepEqual(await repository.completeOrganizerOnboarding({
    candidateId: "candidate-revoked-workspace", actorAccountId: editorId,
    expectedVersion: 1, now: NOW + 7,
  }), { ok: false, reason: "forbidden" });
  assert.equal((await repository.getOrganizerWorkspace("candidate-revoked-workspace", ownerId)).state.onboarding_completed_at, null);
});

test("a candidate without ADR-0047 state is treated as a legacy binder", async () => {
  await database.prepare(
    `INSERT INTO organizer_event_candidates (
       id, tentative_name, status, current_version, current_draft_json,
       created_by, created_at, updated_at, last_updated_by, last_updated_role
     ) VALUES ('legacy-candidate', '既有活動', 'draft', 1, ?1, ?2, ?3, ?3, ?2, 'admin')`,
  ).bind(JSON.stringify(initialDraft), adminId, NOW).run();
  assert.equal(await repository.markOrganizerValidated("legacy-candidate", 1, NOW + 1), true);
  const workspace = await repository.getOrganizerWorkspace("legacy-candidate", adminId);
  assert.equal(workspace.state.onboarding_completed_at, NOW);
  assert.equal(workspace.state.onboarding_completed_by, null);
  assert.equal(workspace.state.last_validated_version, 1);
});

test("account deletion refuses a sole Owner and preserves candidate history after ownership transfer", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-account-deletion",
    tentativeName: "需交接的活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  assert.deepEqual(await repository.listSoleOwnerOrganizerCandidates(ownerId), [
    { id: "candidate-account-deletion", tentative_name: "需交接的活動" },
  ]);
  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 2,
  }), false);

  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-account-deletion",
    actorAccountId: adminId,
    email: "editor@example.test",
    action: "invite",
    now: NOW + 3,
  }), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 4 });
  assert.deepEqual(await repository.listSoleOwnerOrganizerCandidates(ownerId), []);
  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 5,
  }), true);
  assert.equal(await repository.deleteAccount({
    accountId: ownerId,
    email: "owner@example.test",
    emailAuditDigest: "email-digest",
    legacyEmailAuditDigest: "legacy-email-digest",
    now: NOW + 6,
  }), true);
  assert.equal(await repository.organizerRole("candidate-account-deletion", ownerId), null);
  assert.equal(await repository.organizerRole("candidate-account-deletion", editorId), "owner");
  const candidate = await repository.getOrganizerCandidate("candidate-account-deletion");
  assert.equal(candidate.created_by, adminId);
  assert.equal(candidate.last_updated_by, adminId);
});

test("optimistic versions refuse stale edits and editors cannot submit", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  assert.deepEqual(await repository.manageOrganizerCollaborator({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    email: "editor@example.test",
    role: "editor",
    action: "invite",
    now: NOW + 2,
  }), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const edited = structuredClone(initialDraft);
  edited.event.id = "pf45-rf14";
  edited.event.days = [{ id: "1", label: "第一日", date: "2026-11-07" }];
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: editorId,
    expectedVersion: 1,
    eventId: "pf45-rf14",
    draftJson: JSON.stringify(edited),
    now: NOW + 4,
  }), { ok: true, version: 2 });

  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    expectedVersion: 1,
    eventId: "stale-id",
    draftJson: JSON.stringify(initialDraft),
    now: NOW + 5,
  }), {
    ok: false,
    reason: "conflict",
    currentVersion: 2,
    updatedAt: NOW + 4,
    updatedByRole: "editor",
  });

  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: editorId,
    expectedVersion: 2,
    now: NOW + 6,
  }), { ok: false, reason: "forbidden" });
  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    expectedVersion: 2,
    now: NOW + 7,
  }), { ok: true, status: "submitted" });
});

test("event id locks at submission while requested changes can produce a new reviewed revision", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const complete = structuredClone(initialDraft);
  complete.event.id = "pf45-rf14";
  complete.event.days = [{ id: "1", label: "第一日", date: "2026-11-07" }];
  await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "pf45-rf14", draftJson: JSON.stringify(complete), now: NOW + 2,
  });
  await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2, now: NOW + 3,
  });

  assert.deepEqual(await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 2, decision: "changes_requested",
    actorAccountId: adminId, note: "補上第二日", now: NOW + 4,
  }), { ok: true, status: "changes_requested" });

  const changed = structuredClone(complete);
  changed.event.id = "different-id";
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2,
    eventId: "different-id", draftJson: JSON.stringify(changed), now: NOW + 5,
  }), { ok: false, reason: "event_id_locked", eventId: "pf45-rf14" });

  changed.event.id = "pf45-rf14";
  changed.event.days.push({ id: "2", label: "第二日", date: "2026-11-08" });
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2,
    eventId: "pf45-rf14", draftJson: JSON.stringify(changed), now: NOW + 6,
  }), { ok: true, version: 3 });
  await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 3, now: NOW + 7,
  });
  assert.deepEqual(await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 3, decision: "approve",
    actorAccountId: adminId, note: "ready", now: NOW + 8,
  }), { ok: true, status: "approved" });

  const candidate = await repository.getOrganizerCandidate("candidate-pf");
  assert.equal(candidate.status, "approved");
  assert.equal(candidate.current_version, 3);
  assert.equal(candidate.event_id, "pf45-rf14");
  const revisions = await repository.listOrganizerCandidateRevisions("candidate-pf");
  assert.deepEqual(revisions.map(({ version }) => version), [1, 2, 3]);
});

test("normalized import rows advance the candidate version without storing workbook bytes", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF 候選活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });

  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 2,
    source: {
      fileName: "official.xlsx", worksheet: "Day 1", sha256: "a".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ day: { fixed: "1" } }),
    },
    rows: [{
      sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "A",
      boothCode: "A01", circleName: "甲社", stableKey: "circle-1", identityGroup: "stable:circle-1",
    }],
  }), { ok: true, version: 2 });

  const imported = await repository.getOrganizerImport("candidate-pf");
  assert.equal(imported.source.file_name, "official.xlsx");
  assert.equal(imported.source.worksheet, "Day 1");
  assert.equal(Object.hasOwn(imported.source, "raw_bytes"), false);
  assert.deepEqual(imported.rows.map(({ day_id, booth_code, circle_name, identity_group }) => ({ day_id, booth_code, circle_name, identity_group })), [{
    day_id: "1", booth_code: "A01", circle_name: "甲社", identity_group: "stable:circle-1",
  }]);

  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 3,
    source: {
      fileName: "stale.csv", worksheet: null, sha256: "b".repeat(64),
      sourceDescription: "stale", mappingJson: "{}",
    }, rows: [],
  }), { ok: false, reason: "conflict", currentVersion: 2, updatedAt: NOW + 2, updatedByRole: "owner" });
});

test("map revisions are scoped by candidate, period and venue-space while owner and editor share editing", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerCollaborator({
    candidateId: "candidate-pf", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  const content = JSON.stringify({ schema: "map-contribution-draft/1", layout: {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
    floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
  } });

  assert.deepEqual(await repository.createOrganizerMapDraft({
    id: "map-pf-day1", candidateId: "candidate-pf", periodKey: "1", venueSpaceId: "hall-a",
    actorAccountId: editorId, expectedVersion: 1, contentJson: content, now: NOW + 4,
  }), { ok: true, version: 2, mapRevision: 1 });
  const maps = await repository.listOrganizerMapDrafts("candidate-pf");
  assert.deepEqual(maps.map(({ id, candidate_id, period_key, venue_space_id }) => ({ id, candidate_id, period_key, venue_space_id })), [{
    id: "map-pf-day1", candidate_id: "candidate-pf", period_key: "1", venue_space_id: "hall-a",
  }]);

  const changed = JSON.parse(content);
  changed.layout.landmarks.push({ id: "stage", kind: "stage", label: "舞台", rect: { x: 5, y: 5, width: 10, height: 10 } });
  assert.deepEqual(await repository.saveOrganizerMapDraft({
    candidateId: "candidate-pf", draftId: "map-pf-day1", actorAccountId: ownerId,
    expectedVersion: 2, expectedMapRevision: 1, contentJson: JSON.stringify(changed), now: NOW + 5,
  }), { ok: true, version: 3, mapRevision: 2 });
  assert.equal((await repository.getOrganizerMapDraft("candidate-pf", "map-pf-day1")).current_revision, 2);
});

test("approved snapshots create one leased publication job and webhook deliveries are idempotent", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const draft = structuredClone(initialDraft);
  draft.event.id = "pf45";
  await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "pf45", draftJson: JSON.stringify(draft), now: NOW + 2,
  });
  const snapshotJson = JSON.stringify({ schema: "organizer-submission-snapshot/1", candidateId: "candidate-pf", candidateVersion: 2 });
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({
    candidateId: "candidate-pf", candidateVersion: 2, actorAccountId: ownerId,
    snapshotJson, sha256: "a".repeat(64), now: NOW + 3,
  });
  assert.equal(snapshot.ok, true);
  await repository.submitOrganizerCandidate({ candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2, now: NOW + 4 });
  await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 2, decision: "approve",
    actorAccountId: adminId, now: NOW + 5,
  });
  const publication = await repository.createOrganizerPublicationJob({
    candidateId: "candidate-pf", candidateVersion: 2, snapshotId: snapshot.snapshotId,
    approvalHash: "a".repeat(64), now: NOW + 6,
  });
  assert.equal(publication.ok, true);
  const lease = await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 7, ttlMs: 60_000 });
  assert.equal(lease.ok, true);
  assert.deepEqual(await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 8, ttlMs: 60_000 }), { ok: false, reason: "busy" });
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: lease.token, expectedStep: "assemble", nextStep: "assemble",
    status: "failed", error: "simulated", now: NOW + 9,
  }), true);
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId: publication.jobId, now: NOW + 10 }), {
    ok: true, step: "assemble",
  });
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId: publication.jobId, now: NOW + 11 }), {
    ok: false, reason: "status", status: "queued",
  });
  const retriedLease = await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 12, ttlMs: 60_000 });
  assert.equal(retriedLease.ok, true);
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: retriedLease.token, expectedStep: "assemble", nextStep: "completed",
    status: "published", now: NOW + 13,
  }), false, "merge alone cannot mark a publication complete");
  await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: retriedLease.token, expectedStep: "assemble", nextStep: "verifying_production",
    status: "publishing", now: NOW + 13,
  });
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: retriedLease.token, expectedStep: "verifying_production", nextStep: "completed",
    status: "published", productionVerified: true, now: NOW + 13,
  }), true);
  assert.equal((await repository.getOrganizerCandidate("candidate-pf")).status, "published");

  const delivery = { deliveryId: "delivery-1", event: "check_run", payloadSha256: "b".repeat(64), now: NOW + 14 };
  assert.equal(await repository.recordGitHubWebhookDelivery(delivery), "recorded");
  assert.equal(await repository.completeGitHubWebhookDelivery({ deliveryId: delivery.deliveryId, processed: true, now: NOW + 15 }), true);
  assert.equal(await repository.recordGitHubWebhookDelivery(delivery), "duplicate");
  assert.equal(await repository.recordGitHubWebhookDelivery({ ...delivery, payloadSha256: "c".repeat(64) }), "mismatch");
});

/**
 * Organizer candidates share the map_drafts table, and their event_id is the
 * candidate's own — which an organizer may set to an already published event.
 * The candidate_id column is the only thing separating the two pipelines, so
 * the public map-contribution statements have to restate it. Without that a
 * candidate map is submittable, approvable and exportable as a public map.
 */
test("a candidate map never enters the public map-contribution pipeline", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-crossover", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  // The candidate claims the very event id this deployment already serves.
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-crossover", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "ff47", draftJson: JSON.stringify({ ...initialDraft, event: { ...initialDraft.event, id: "ff47" } }),
    now: NOW + 2,
  }), { ok: true, version: 2 });
  // The same person is also a map contributor for the published event.
  assert.equal(await repository.manageMapContributor({
    email: "owner@example.test", action: "grant", by: adminId, now: NOW + 3,
  }), "granted");

  const content = JSON.stringify({ schema: "map-contribution-draft/1", layout: {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
    floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
  } });
  assert.deepEqual(await repository.createOrganizerMapDraft({
    id: "map-crossover", candidateId: "candidate-crossover", periodKey: "1", venueSpaceId: "hall-a",
    actorAccountId: ownerId, expectedVersion: 2, contentJson: content, now: NOW + 4,
  }), { ok: true, version: 3, mapRevision: 1 });
  const stored = await database.prepare("SELECT event_id, candidate_id FROM map_drafts WHERE id = 'map-crossover'").first();
  assert.deepEqual(stored, { event_id: "ff47", candidate_id: "candidate-crossover" });

  // Invisible to every contributor and admin read scoped by that event id.
  assert.deepEqual(await repository.listMapDraftsForOwner(ownerId, "ff47"), []);
  assert.deepEqual(await repository.listMapDraftsForAdmin("ff47"), []);
  assert.equal(await repository.getMapDraft("map-crossover", "ff47"), null);
  assert.equal(await repository.getMapDraft("map-crossover"), null);
  assert.equal(await repository.getActiveApprovedMapDraft("ff47", "1", "hall-a"), null);

  // And unwritable through them: the candidate's own API stays the only door.
  assert.equal(await repository.writeMapDraftRevision({
    draftId: "map-crossover", eventId: "ff47", ownerAccountId: ownerId,
    expectedRevision: 1, contentJson: content, now: NOW + 5,
  }), null);
  assert.equal(await repository.submitMapDraft({
    draftId: "map-crossover", eventId: "ff47", ownerAccountId: ownerId,
    expectedRevision: 1, now: NOW + 6,
  }), false);
  assert.equal(await repository.addMapDraftFile({
    id: "file-crossover", draftId: "map-crossover", eventId: "ff47", revision: 1,
    objectKey: "raw/crossover", sourceUrl: "https://example.test/plan.png", documentDate: "2026-08-31",
    pageNumber: null, sha256: "0".repeat(64), mime: "image/png", sizeBytes: 10,
    width: 10, height: 10, pageCount: null, uploadedBy: ownerId, now: NOW + 7,
  }), false);
  assert.equal((await repository.getOrganizerMapDraft("candidate-crossover", "map-crossover")).current_revision, 1);
});

test("revoking an editor who has not signed in yet withdraws the pending invitation", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-revoke", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const invite = (now) => repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "invite", now,
  });
  const revoke = (now) => repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "revoke", now,
  });

  // Never accepted: only an invitation row exists, and revoking it must report
  // success rather than "nothing changed".
  assert.deepEqual(await invite(NOW + 2), { ok: true, result: "invited" });
  assert.deepEqual(await revoke(NOW + 3), { ok: true, result: "revoked" });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 4 });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);

  // Nothing left to revoke reports missing.
  assert.deepEqual(await revoke(NOW + 5), { ok: false, reason: "missing" });

  // An accepted editor still revokes through the grant.
  assert.deepEqual(await invite(NOW + 6), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 7 });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), "editor");
  assert.deepEqual(await revoke(NOW + 8), { ok: true, result: "revoked" });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);
});

test("a booth list larger than one bound parameter still imports atomically", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-bulk", tentativeName: "大型活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  // Past the 500-row chunk boundary, and past what one JSON parameter should
  // carry: a two-day event with this many circles is an ordinary large event.
  const rows = Array.from({ length: 1_700 }, (unused, index) => ({
    sourceRow: index + 2,
    dayId: String((index % 2) + 1),
    venueSpaceId: "hall-a",
    areaId: "a",
    boothCode: `A-${String(index).padStart(5, "0")}`,
    circleName: `サークル${index}・${"名".repeat(40)}`,
    stableKey: null,
    identityGroup: null,
  }));
  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-bulk", actorAccountId: ownerId, expectedVersion: 1,
    source: {
      fileName: "booths.xlsx", worksheet: "Sheet1", sha256: "b".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ boothCode: { column: 0 } }),
    },
    rows, now: NOW + 2,
  }), { ok: true, version: 2 });

  const imported = await repository.getOrganizerImport("candidate-bulk");
  assert.equal(imported.rows.length, rows.length);
  assert.equal(imported.rows[0].booth_code, "A-00000");
  assert.equal(imported.rows.at(-1).booth_code, "A-01699");
  assert.equal(new Set(imported.rows.map(({ id }) => id)).size, rows.length);
  assert.equal(new Set(imported.rows.map(({ source_id }) => source_id)).size, 1);

  // Replacing it retires the old source and leaves exactly the new rows.
  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-bulk", actorAccountId: ownerId, expectedVersion: 2,
    source: {
      fileName: "booths-v2.xlsx", worksheet: "Sheet1", sha256: "c".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ boothCode: { column: 0 } }),
    },
    rows: rows.slice(0, 3), now: NOW + 3,
  }), { ok: true, version: 3 });
  const replaced = await repository.getOrganizerImport("candidate-bulk");
  assert.equal(replaced.rows.length, 3);
  assert.equal(replaced.source.sha256, "c".repeat(64));
});

test("account deletion shreds the private workbook name alongside its uploader", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-shred", tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-shred", actorAccountId: adminId, email: "editor@example.test",
    action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  await repository.replaceOrganizerImport({
    candidateId: "candidate-shred", actorAccountId: ownerId, expectedVersion: 1,
    source: {
      fileName: "PF45 內部攤位表 最終版.xlsx", worksheet: "不要外流", sha256: "d".repeat(64),
      sourceDescription: "主辦提供", mappingJson: "{}",
    },
    rows: [{
      sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "a",
      boothCode: "A-01", circleName: "測試社團", stableKey: null, identityGroup: null,
    }],
    now: NOW + 4,
  });

  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 5,
  }), true);
  assert.equal(await repository.deleteAccount({
    accountId: ownerId, email: "owner@example.test",
    emailAuditDigest: "email-digest", legacyEmailAuditDigest: "legacy-email-digest", now: NOW + 6,
  }), true);

  const source = await database.prepare(
    "SELECT created_by, file_name, worksheet, sha256 FROM organizer_import_sources WHERE candidate_id = 'candidate-shred'",
  ).first();
  assert.equal(source.created_by, "[shredded]");
  assert.equal(source.file_name, "[shredded]");
  assert.equal(source.worksheet, null);
  // The provenance hash is not personal data and outlives the account.
  assert.equal(source.sha256, "d".repeat(64));
});

test("the last Owner survives two admins revoking the final two at once", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-race", tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-race", actorAccountId: adminId, email: "editor@example.test",
    action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const revoke = (email) => repository.manageOrganizerOwner({
    candidateId: "candidate-race", actorAccountId: adminId, email, action: "revoke", now: NOW + 4,
  });
  // Both see two active Owners; a count read before the write would let both
  // through and leave the candidate with none.
  const [first, second] = await Promise.all([revoke("owner@example.test"), revoke("editor@example.test")]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((result) => result.ok).length, 1, "exactly one revoke may win");
  assert.deepEqual(outcomes.find((result) => !result.ok), { ok: false, reason: "last_owner" });

  const owners = await database.prepare(
    "SELECT COUNT(*) AS n FROM organizer_event_grants WHERE candidate_id = 'candidate-race' AND role = 'owner' AND revoked_at IS NULL",
  ).first();
  assert.equal(owners.n, 1, "the candidate must never be left ownerless");
});
