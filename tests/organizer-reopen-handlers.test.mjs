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
const { createCirclePortalHandlers } = await environment.runner.import("/app/circle-portal-handlers.ts");
const { sha256Hex } = await environment.runner.import("/app/portal-crypto.ts");

const databaseHost = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-reopen-handlers-test" },
}));
const database = await databaseHost.getD1Database("DB");
const repository = createIdentityRepository(database);

after(async () => {
  await databaseHost.dispose();
  await vite.close();
});

const ORIGIN = "https://verify.kotoban.top";
const NOW = 1_788_000_000_000;
const ADMIN_SESSION_STALE_MS = 24 * 60 * 60 * 1000;
const REASON = "資料需要補充";
const CANDIDATE_ID = "reopen-handler-candidate";
const JOB_ID = "reopen-handler-job";

let now = NOW;
let sent = [];
let handlers;
let adminId;
let ownerId;
let editorId;

function request(path, method = "GET", body, cookie) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function createHandlers(githubRemoteAuditor) {
  const dependencies = {
    repository,
    sendMail: async (message) => { sent.push(message); },
    lookupCircle: async () => null,
    searchCircles: async () => [],
    fetchEvidence: async () => null,
    verifyHuman: async () => true,
    turnstileSitekey: () => "test-sitekey",
    projectCircle: async () => null,
    config: {
      eventId: "ff47",
      origin: ORIGIN,
      sessionSecret: "test-session-secret",
      hashPepper: "test-pepper",
      adminEmails: ["admin@example.test"],
      dataUpdatedAt: "2026-08-30T00:00:00.000+08:00",
      eventEndsAt: "2026-12-31T23:59:59.999+08:00",
      organizerPublicationMode: "disabled",
      now: () => now,
    },
  };
  if (githubRemoteAuditor !== undefined) dependencies.githubRemoteAuditor = githubRemoteAuditor;
  return createCirclePortalHandlers(dependencies);
}

async function signIn(email, audience = "organizer") {
  const link = await handlers.requestLink(request(
    "/api/auth/request-link", "POST", { email, turnstileToken: "solved", audience },
  ));
  assert.equal(link.status, 202, `request-link must accept ${email}`);
  const path = audience === "organizer" ? "organizer" : "circle";
  const token = sent.at(-1).text.match(new RegExp(`/${path}\\?login=([^\\s]+)`))[1];
  const verified = await handlers.verify(request(
    "/api/auth/verify", "POST", { token: decodeURIComponent(token) },
  ));
  assert.equal(verified.status, 200, `verify must accept ${email}`);
  return cookieFrom(verified);
}

async function failedCandidate() {
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "reopen-handler-event", name: "Reopen handler", days: [] },
    venue: { assignments: [] },
    officialSource: { label: "", url: null },
  };
  await repository.createOrganizerCandidate({
    id: CANDIDATE_ID,
    tentativeName: "Reopen handler",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(draft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({
    accountId: ownerId, email: "owner@example.test", now: NOW + 1,
  });
  await database.prepare(
    "UPDATE organizer_event_candidates SET event_id = 'reopen-handler-event' WHERE id = ?1",
  ).bind(CANDIDATE_ID).run();

  const snapshotJson = JSON.stringify({
    candidateId: CANDIDATE_ID,
    candidateVersion: 1,
    eventId: "reopen-handler-event",
  });
  const hash = await sha256Hex(snapshotJson);
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({
    candidateId: CANDIDATE_ID,
    candidateVersion: 1,
    actorAccountId: ownerId,
    snapshotJson,
    sha256: hash,
    now: NOW + 2,
  });
  assert.equal(snapshot.ok, true);
  assert.equal((await repository.submitOrganizerCandidate({
    candidateId: CANDIDATE_ID,
    actorAccountId: ownerId,
    expectedVersion: 1,
    now: NOW + 3,
  })).ok, true);
  assert.equal((await repository.reviewOrganizerCandidate({
    candidateId: CANDIDATE_ID,
    expectedVersion: 1,
    decision: "approve",
    actorAccountId: adminId,
    publication: { jobId: JOB_ID, snapshotId: snapshot.snapshotId, approvalHash: hash },
    now: NOW + 4,
  })).ok, true);
  await database.prepare(
    `UPDATE organizer_event_candidates
     SET status = 'failed', approved_by = ?1, approved_at = ?2
     WHERE id = ?3`,
  ).bind(adminId, NOW + 4, CANDIDATE_ID).run();
  await database.prepare(
    `UPDATE organizer_publication_jobs
     SET status = 'failed', step = 'preparing_data', retryable = 1,
       data_pr_number = NULL, data_head_sha = NULL, data_merge_sha = NULL,
       main_pr_number = NULL, main_head_sha = NULL, main_merge_sha = NULL,
       workflow_run_id = NULL, remote_write_intent_at = NULL
     WHERE id = ?1`,
  ).bind(JOB_ID).run();
  return { candidateId: CANDIDATE_ID, jobId: JOB_ID, snapshotId: snapshot.snapshotId };
}

async function grantEditor(candidateId) {
  const result = await repository.manageOrganizerCollaborator({
    candidateId,
    actorAccountId: ownerId,
    email: "editor@example.test",
    role: "editor",
    action: "invite",
    now,
  });
  assert.deepEqual(result, { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({
    accountId: editorId, email: "editor@example.test", now,
  });
}

async function ageSession(cookie) {
  const value = cookie.slice(cookie.indexOf("=") + 1);
  const sessionId = value.slice(0, value.lastIndexOf("."));
  const result = await database.prepare(
    "UPDATE sessions SET created_at = ?1 WHERE id = ?2",
  ).bind(now - ADMIN_SESSION_STALE_MS - 1, sessionId).run();
  assert.equal(result.meta.changes, 1);
}

async function readBusinessState(candidateId = CANDIDATE_ID, jobId = JOB_ID) {
  const [candidate, job, revisions, reviews, audits] = await Promise.all([
    database.prepare(
      `SELECT status, current_version, event_id, event_id_locked_at, current_draft_json,
              updated_at, last_updated_by, last_updated_role, approved_by, approved_at
       FROM organizer_event_candidates WHERE id = ?1`,
    ).bind(candidateId).first(),
    database.prepare(
      `SELECT candidate_version, snapshot_id, approval_hash, status, step,
              data_pr_number, data_head_sha, data_merge_sha,
              main_pr_number, main_head_sha, main_merge_sha, workflow_run_id,
              retryable, remote_write_intent_at, failure_code, error, updated_at
       FROM organizer_publication_jobs WHERE id = ?1`,
    ).bind(jobId).first(),
    database.prepare(
      `SELECT version, event_id, draft_json, created_by, created_by_role, created_at
       FROM organizer_event_revisions WHERE candidate_id = ?1 ORDER BY version, created_at`,
    ).bind(candidateId).all(),
    database.prepare(
      `SELECT version, from_status, to_status, actor_account_id, note, at
       FROM organizer_event_reviews WHERE candidate_id = ?1 ORDER BY at, id`,
    ).bind(candidateId).all(),
    database.prepare(
      `SELECT at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash
       FROM audit_log WHERE subject_id = ?1 ORDER BY at, id`,
    ).bind(candidateId).all(),
  ]);
  return {
    candidate,
    job,
    revisions: revisions.results,
    reviews: reviews.results,
    audits: audits.results,
  };
}

async function readGlobalLease() {
  return database.prepare(
    "SELECT job_id, token, expires_at FROM organizer_publication_lease WHERE id = 'global'",
  ).first();
}

async function reopen(candidate, cookie, body) {
  return handlers.reopenOrganizerCandidate(request(
    `/api/organizer/events/${candidate.candidateId}/reopen`, "POST", body, cookie,
  ), candidate.candidateId);
}

beforeEach(async () => {
  now = NOW;
  sent = [];
  await repository.ensureTables();
  await repository.clearPreviewData();
  adminId = await repository.upsertAccount("admin@example.test", NOW);
  ownerId = await repository.upsertAccount("owner@example.test", NOW);
  editorId = await repository.upsertAccount("editor@example.test", NOW);
  await repository.addAdmin("admin@example.test", "bootstrap", NOW);
  handlers = createHandlers();
});

for (const actor of ["owner", "admin"]) {
  test(`fresh ${actor} can reopen a failed candidate while publication mode is disabled`, async () => {
    const candidate = await failedCandidate();
    now = NOW + 10;
    const calls = [];
    handlers = createHandlers(async (jobId) => {
      calls.push(jobId);
      return { clear: true };
    });
    const cookie = await signIn(actor === "owner" ? "owner@example.test" : "admin@example.test");
    const before = await readBusinessState();

    const response = await reopen(candidate, cookie, { expectedVersion: 1, reason: REASON });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "changes_requested",
      version: 2,
      previousPublicationJobId: candidate.jobId,
    });
    assert.deepEqual(calls, [candidate.jobId]);

    const after = await readBusinessState();
    assert.equal(after.candidate.status, "changes_requested");
    assert.equal(after.candidate.current_version, 2);
    assert.equal(after.candidate.event_id, "reopen-handler-event");
    assert.notEqual(after.candidate.event_id_locked_at, null);
    assert.equal(after.candidate.approved_at, null);
    assert.equal(after.job.status, "failed");
    assert.equal(after.job.retryable, 0);
    assert.equal(after.job.candidate_version, 1);
    assert.deepEqual(after.revisions.map(({ version, event_id, created_by_role }) => ({
      version, event_id, created_by_role,
    })), [
      { version: 1, event_id: null, created_by_role: "admin" },
      { version: 2, event_id: "reopen-handler-event", created_by_role: actor === "admin" ? "admin" : "owner" },
    ]);
    assert.deepEqual(after.reviews.at(-1), {
      version: 2,
      from_status: "failed",
      to_status: "changes_requested",
      actor_account_id: actor === "admin" ? adminId : ownerId,
      note: REASON,
      at: now,
    });
    const reopenedAudit = after.audits.find(({ action }) => action === "organizer_event.reopened");
    assert.ok(reopenedAudit);
    assert.equal(reopenedAudit.actor_account_id, actor === "admin" ? adminId : ownerId);
    assert.equal(reopenedAudit.actor_role, actor === "admin" ? "admin" : "organizer_owner");
    assert.equal(JSON.parse(reopenedAudit.detail_json).reason, REASON);
    assert.equal(await readGlobalLease(), null);
    assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId: candidate.jobId, now: now + 1 }), {
      ok: false,
      reason: "not_retryable",
      status: "failed",
    });
    assert.equal(before.revisions.length, 1);
    assert.equal(before.reviews.length, 1);
  });
}

test("an Editor cannot reopen a failed candidate and cannot trigger the remote audit", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  await grantEditor(candidate.candidateId);
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    throw new Error("Editor must not reach remote audit");
  });
  const editorCookie = await signIn("editor@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, editorCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /負責人或網站管理者/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readBusinessState(), before);
  assert.equal(await readGlobalLease(), null);
});

for (const actor of ["owner", "admin"]) {
  test(`a stale ${actor} session is rejected before remote audit`, async () => {
    const candidate = await failedCandidate();
    now = NOW + 10;
    const calls = [];
    handlers = createHandlers(async (jobId) => {
      calls.push(jobId);
      throw new Error("stale session must not reach remote audit");
    });
    const cookie = await signIn(actor === "owner" ? "owner@example.test" : "admin@example.test");
    await ageSession(cookie);
    const before = await readBusinessState();

    const response = await reopen(candidate, cookie, { expectedVersion: 1, reason: REASON });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "admin_session_stale");
    assert.deepEqual(calls, []);
    assert.deepEqual(await readBusinessState(), before);
    assert.equal(await readGlobalLease(), null);
  });
}

const invalidBodies = [
  ["missing body", undefined],
  ["missing expectedVersion", { reason: REASON }],
  ["missing reason", { expectedVersion: 1 }],
  ["blank reason", { expectedVersion: 1, reason: " \t\n" }],
  ["non-integer expectedVersion", { expectedVersion: 1.5, reason: REASON }],
  ["oversize reason", { expectedVersion: 1, reason: "x".repeat(1001) }],
];
for (const [label, body] of invalidBodies) {
  test(`required reopen fields reject ${label} before remote audit`, async () => {
    const candidate = await failedCandidate();
    now = NOW + 10;
    const calls = [];
    handlers = createHandlers(async (jobId) => {
      calls.push(jobId);
      throw new Error("invalid request must not reach remote audit");
    });
    const ownerCookie = await signIn("owner@example.test");
    const before = await readBusinessState();

    const response = await reopen(candidate, ownerCookie, body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /版本與退回理由/);
    assert.deepEqual(calls, []);
    assert.deepEqual(await readBusinessState(), before);
    assert.equal(await readGlobalLease(), null);
  });
}

test("a stale expected version refuses before remote audit", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    throw new Error("stale version must not reach remote audit");
  });
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 2, reason: REASON });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "conflict");
  assert.equal(body.currentVersion, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readBusinessState(), before);
  assert.equal(await readGlobalLease(), null);
});

test("a non-failed candidate status refuses before remote audit", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  await database.prepare(
    `UPDATE organizer_event_candidates
     SET status = 'changes_requested', approved_by = NULL, approved_at = NULL
     WHERE id = ?1`,
  ).bind(candidate.candidateId).run();
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    throw new Error("status refusal must not reach remote audit");
  });
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "status");
  assert.deepEqual(calls, []);
  assert.deepEqual(await readBusinessState(), before);
  assert.equal(await readGlobalLease(), null);
});

const checkpointColumns = [
  ["data_pr_number", 42],
  ["data_head_sha", "data-head"],
  ["data_merge_sha", "data-merge"],
  ["main_pr_number", 43],
  ["main_head_sha", "main-head"],
  ["main_merge_sha", "main-merge"],
  ["workflow_run_id", 44],
];
for (const [column, value] of checkpointColumns) {
  test(`a ${column} checkpoint refuses before remote audit`, async () => {
    const candidate = await failedCandidate();
    now = NOW + 10;
    await database.prepare(`UPDATE organizer_publication_jobs SET ${column} = ?1 WHERE id = ?2`)
      .bind(value, candidate.jobId).run();
    const calls = [];
    handlers = createHandlers(async (jobId) => {
      calls.push(jobId);
      throw new Error("checkpoint refusal must not reach remote audit");
    });
    const ownerCookie = await signIn("owner@example.test");
    const before = await readBusinessState();

    const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "started");
    assert.deepEqual(calls, []);
    assert.deepEqual(await readBusinessState(), before);
    assert.equal(await readGlobalLease(), null);
  });
}

test("a sticky remote write intent refuses before remote audit", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  await database.prepare(
    "UPDATE organizer_publication_jobs SET remote_write_intent_at = ?1 WHERE id = ?2",
  ).bind(now - 1, candidate.jobId).run();
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    throw new Error("intent refusal must not reach remote audit");
  });
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "remote_write_started");
  assert.deepEqual(calls, []);
  assert.deepEqual(await readBusinessState(), before);
  assert.equal(await readGlobalLease(), null);
});

test("a live global publication lease refuses before remote audit", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  await database.batch([
    database.prepare("UPDATE organizer_event_candidates SET status = 'publishing' WHERE id = ?1").bind(candidate.candidateId),
    database.prepare("UPDATE organizer_publication_jobs SET status = 'publishing' WHERE id = ?1").bind(candidate.jobId),
  ]);
  const competingLease = await repository.claimOrganizerPublicationLease({
    jobId: candidate.jobId, now, ttlMs: 30_000,
  });
  assert.equal(competingLease.ok, true);
  await database.batch([
    database.prepare("UPDATE organizer_event_candidates SET status = 'failed' WHERE id = ?1").bind(candidate.candidateId),
    database.prepare("UPDATE organizer_publication_jobs SET status = 'failed' WHERE id = ?1").bind(candidate.jobId),
  ]);
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    throw new Error("live lease refusal must not reach remote audit");
  });
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "busy");
  assert.deepEqual(calls, []);
  assert.deepEqual(await readBusinessState(), before);
  const lease = await readGlobalLease();
  assert.equal(lease.token, competingLease.token);
  await repository.releaseOrganizerPublicationLease(candidate.jobId, competingLease.token);
});

const remoteAuditFailures = [
  ["false", async () => ({ clear: false })],
  ["malformed", async () => ({ clear: "true" })],
  ["throw", async () => { throw new Error("remote audit unavailable"); }],
];
for (const [label, auditor] of remoteAuditFailures) {
  test(`a ${label} remote audit fails closed, releases the lease, and leaves rows unchanged`, async () => {
    const candidate = await failedCandidate();
    now = NOW + 10;
    const calls = [];
    handlers = createHandlers(async (jobId) => {
      calls.push(jobId);
      return auditor();
    });
    const ownerCookie = await signIn("owner@example.test");
    const before = await readBusinessState();

    const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "github_remote_audit_failed");
    assert.deepEqual(calls, [candidate.jobId]);
    assert.deepEqual(await readBusinessState(), before);
    assert.equal(await readGlobalLease(), null);
  });
}

test("an omitted remote auditor fails closed before claiming a lease", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  handlers = createHandlers();
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "github_remote_audit_unavailable");
  assert.deepEqual(await readBusinessState(), before);
  assert.equal(await readGlobalLease(), null);
});

test("a candidate version race after a clear audit returns conflict without partial audit or revision", async () => {
  const candidate = await failedCandidate();
  now = NOW + 10;
  const calls = [];
  handlers = createHandlers(async (jobId) => {
    calls.push(jobId);
    const result = await database.prepare(
      `UPDATE organizer_event_candidates
       SET current_version = 2, status = 'changes_requested', approved_by = NULL,
           approved_at = NULL, updated_at = ?1, last_updated_by = ?2, last_updated_role = 'owner'
       WHERE id = ?3 AND current_version = 1`,
    ).bind(now + 1, ownerId, candidate.candidateId).run();
    assert.equal(result.meta.changes, 1);
    return { clear: true };
  });
  const ownerCookie = await signIn("owner@example.test");
  const before = await readBusinessState();

  const response = await reopen(candidate, ownerCookie, { expectedVersion: 1, reason: REASON });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "conflict");
  assert.deepEqual(calls, [candidate.jobId]);
  const after = await readBusinessState();
  assert.equal(after.candidate.current_version, 2);
  assert.equal(after.candidate.status, "changes_requested");
  assert.deepEqual(after.revisions, before.revisions);
  assert.deepEqual(after.reviews, before.reviews);
  assert.deepEqual(after.audits, before.audits);
  assert.deepEqual(after.job, before.job);
  assert.equal(await readGlobalLease(), null);
});
