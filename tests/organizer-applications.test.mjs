import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("SSR unavailable");
const { createIdentityRepository } = await vite.environments.ssr.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await vite.environments.ssr.runner.import("/app/circle-portal-handlers.ts");
const { parseOrganizerApplication } = await vite.environments.ssr.runner.import("/app/organizer-applications.ts");
const miniflare = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "applications-test" } }));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.test"] });
after(async () => { await miniflare.dispose(); await vite.close(); });
before(() => repository.ensureTables());
const ORIGIN = "https://verify.kotoban.top";
const PATH = "/api/organizer/applications";
const now = 1_790_000_000_000;
const data = { name: "驗收活動", officialUrl: "https://official.example/event", startDate: "2026-12-05", endDate: "2026-12-06", location: "", relationship: "curator", note: "依官方名單整理活動。" };
let handlers, sent, options;
function request(path = PATH, method = "GET", body, cookie) {
  return new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
beforeEach(async () => {
  await repository.clearPreviewData();
  await repository.addAdmin("admin@example.test", "bootstrap", now);
  sent = [];
  options = { repository, sendMail: async (message) => { sent.push(message); }, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test",
    projectCircle: async () => null,
    config: { eventId: "sample", origin: ORIGIN, sessionSecret: "test-session", hashPepper: "test-pepper", adminEmails: ["admin@example.test"],
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2026-12-31T00:00:00Z", now: () => now,
      organizerApplicationAllowedEmails: ["applicant@example.test"] } };
  handlers = createCirclePortalHandlers(options);
});
async function signIn(email) {
  await handlers.requestLink(request("/api/auth/request-link", "POST", { email, audience: "organizer", turnstileToken: "test" }));
  const token = decodeURIComponent(sent.at(-1).text.match(/\/organizer\?login=([^\s]+)/)[1]);
  const response = await handlers.verify(request("/api/auth/verify", "POST", { token }));
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
const submit = (cookie, id = crypto.randomUUID(), application = data) => handlers.submitEventApplication(request(PATH, "POST", { id, application }, cookie));
const review = (cookie, id, decision = "approved", reason = "") => handlers.reviewEventApplication(request(`/api/admin/organizer/applications/${id}`, "POST", { decision, reason }, cookie), id);
async function created(cookie, application = data) {
  const response = await submit(cookie, crypto.randomUUID(), application);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).application;
}
async function count(table) { return (await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n; }

test("submission is closed by default and only the exact controlled account is admitted", async () => {
  assert.equal((await submit(undefined)).status, 401);
  const applicant = await signIn("applicant@example.test");
  const stranger = await signIn("stranger@example.test");
  assert.equal((await submit(stranger)).status, 403);
  assert.equal((await handlers.listEventApplications(request())).status, 401);
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config, organizerApplicationAllowedEmails: [] } });
  assert.equal((await submit(applicant)).status, 403);
  assert.equal(await count("organizer_applications"), 0);
});

test("explicit public gate admits all three relationships while rejecting malformed data and injected privileges", async () => {
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config, organizerApplicationsOpen: true } });
  const applicant = await signIn("stranger@example.test");
  for (const relationship of ["organizer", "authorized", "curator"]) await created(applicant, { ...data, relationship });
  for (const change of [{ officialUrl: "javascript:alert(1)" }, { officialUrl: "https://user:pass@example.test" }, { startDate: "2026-02-30" },
    { endDate: "2026-12-01" }, { relationship: "admin" }, { note: "" }, { eventId: "ff47" }, { candidateId: "existing" }]) {
    assert.equal((await submit(applicant, crypto.randomUUID(), { ...data, ...change })).status, 400);
  }
  assert.equal(parseOrganizerApplication({ ...data, name: "x".repeat(121) }), null);
  assert.equal(await count("organizer_event_grants"), 0);
});

test("submission retries are idempotent without exposing or overwriting another account's request", async () => {
  const owner = await signIn("applicant@example.test");
  const id = crypto.randomUUID();
  const responses = await Promise.all([submit(owner, id), submit(owner, id)]);
  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  assert.equal(await count("organizer_applications"), 1);
  assert.equal((await submit(owner, id, { ...data, name: "changed" })).status, 409);
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config, organizerApplicationsOpen: true } });
  const other = await signIn("other@example.test");
  assert.equal((await submit(other, id)).status, 409);
  const listed = await handlers.listEventApplications(request(PATH, "GET", undefined, other));
  assert.deepEqual((await listed.json()).applications, []);
  assert.equal((await review(other, id)).status, 403);
  assert.equal((await review(undefined, id)).status, 401);
});

test("an admin's own submission immediately carries the same review identity as the list", async () => {
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config,
    organizerApplicationAllowedEmails: ["applicant@example.test", "admin@example.test"] } });
  const admin = await signIn("admin@example.test");
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await submit(admin, id);
    assert.equal(response.status, 201);
    const application = (await response.json()).application;
    assert.equal(application.applicantEmail, "admin@example.test");
    const listed = await (await handlers.listEventApplications(request(PATH, "GET", undefined, admin))).json();
    assert.deepEqual(application, listed.applications[0]);
  }
  const applicant = await signIn("applicant@example.test");
  assert.equal((await created(applicant)).applicantEmail, undefined);
});

test("concurrent approvals create one draft, revision, invitation and grant; retry cannot restore revoked access", async () => {
  const owner = await signIn("applicant@example.test");
  const admin = await signIn("admin@example.test");
  const application = await created(owner);
  const before = await handlers.listOrganizerCandidates(request("/api/organizer/events", "GET", undefined, owner));
  assert.deepEqual((await before.json()).events, []);
  const responses = await Promise.all([review(admin, application.id), review(admin, application.id)]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const outcomes = await Promise.all(responses.map((response) => response.json()));
  assert.equal(outcomes[0].application.candidateId, outcomes[1].application.candidateId);
  for (const table of ["organizer_event_candidates", "organizer_event_revisions", "organizer_workspace_state", "organizer_event_invitations", "organizer_event_grants"]) assert.equal(await count(table), 1, table);
  const candidateId = outcomes[0].application.candidateId;
  const candidate = await repository.getOrganizerCandidate(candidateId);
  assert.equal(candidate.status, "draft");
  assert.equal(candidate.event_id, null);
  assert.equal(JSON.parse(candidate.current_draft_json).officialSource.url, data.officialUrl);
  assert.equal(await count("organizer_publication_jobs"), 0);
  const detail = await handlers.getOrganizerCandidate(request(`/api/organizer/events/${candidateId}`, "GET", undefined, owner), candidateId);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).event.role, "owner");
  const grant = await database.prepare("SELECT * FROM organizer_event_grants").first();
  await database.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE id = ?2").bind(now, grant.id).run();
  assert.equal((await review(admin, application.id)).status, 200);
  assert.equal(await repository.organizerRole(candidateId, grant.account_id), null);
  const revoked = await (await handlers.listEventApplications(request(PATH, "GET", undefined, owner))).json();
  assert.equal(revoked.applications[0].candidateId, null, "a revoked owner is not offered an unusable workspace link");
  assert.equal((await review(admin, application.id, "rejected", "changed")).status, 409);
});

test("rejection keeps its reason private, grants nothing and remains readable after the gate closes", async () => {
  const owner = await signIn("applicant@example.test");
  const other = await signIn("other@example.test");
  const admin = await signIn("admin@example.test");
  const application = await created(owner);
  assert.equal((await review(admin, application.id, "rejected")).status, 400);
  assert.equal((await review(admin, application.id, "rejected", "此活動已存在，請聯絡負責人邀請協作。")).status, 200);
  assert.equal(await count("organizer_event_candidates"), 0);
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config, organizerApplicationAllowedEmails: [] } });
  const own = await (await handlers.listEventApplications(request(PATH, "GET", undefined, owner))).json();
  assert.equal(own.canApply, false);
  assert.match(own.applications[0].reason, /已存在/);
  assert.equal(own.applications[0].applicantEmail, undefined);
  assert.deepEqual((await (await handlers.listEventApplications(request(PATH, "GET", undefined, other))).json()).applications, []);
  const session = await (await handlers.session(request("/api/auth/session", "GET", undefined, owner))).json();
  assert.equal(session.hasEventApplications, true); assert.equal(session.canApplyForEvent, false); assert.equal(session.hasOrganizerAccess, false);
});

test("approve versus reject has exactly one winning decision and no orphaned candidate", async () => {
  const owner = await signIn("applicant@example.test"); const admin = await signIn("admin@example.test");
  const application = await created(owner);
  const responses = await Promise.all([review(admin, application.id), review(admin, application.id, "rejected", "來源不足")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const row = await repository.getOrganizerApplication(application.id);
  assert.equal(await count("organizer_event_candidates"), row.status === "approved" ? 1 : 0);
  assert.equal(await count("organizer_event_grants"), row.status === "approved" ? 1 : 0);
});

test("a failure creating the owner grant rolls back the whole approval", async () => {
  const owner = await signIn("applicant@example.test"); const admin = await signIn("admin@example.test");
  const application = await created(owner);
  await database.prepare("CREATE TRIGGER fail_application_grant BEFORE INSERT ON organizer_event_grants BEGIN SELECT RAISE(ABORT, 'test grant failure'); END").run();
  try { await assert.rejects(review(admin, application.id), /test grant failure/); }
  finally { await database.prepare("DROP TRIGGER fail_application_grant").run(); }
  assert.equal((await repository.getOrganizerApplication(application.id)).status, "pending");
  for (const table of ["organizer_event_candidates", "organizer_event_revisions", "organizer_workspace_state", "organizer_event_invitations", "organizer_event_grants"]) assert.equal(await count(table), 0, table);
  assert.equal((await review(admin, application.id)).status, 200);
});

for (const failure of ["applicant-deletion", "admin-revoked", "session-revoked"]) test(`approval rechecks ${failure} inside its transaction`, async () => {
  const owner = await signIn("applicant@example.test"); const admin = await signIn("admin@example.test");
  const application = await created(owner);
  let armed = false;
  const guarded = createIdentityRepository({ prepare: (...args) => database.prepare(...args), batch: async (statements) => {
    if (armed) {
      armed = false;
      if (failure === "applicant-deletion") await database.prepare("UPDATE accounts SET deletion_started_at = ?1 WHERE email = 'applicant@example.test'").bind(now).run();
      if (failure === "admin-revoked") await database.prepare("DELETE FROM admins WHERE email = 'admin@example.test'").run();
      if (failure === "session-revoked") await database.prepare("UPDATE sessions SET revoked_at = ?1 WHERE account_id IN (SELECT id FROM accounts WHERE email = 'admin@example.test')").bind(now).run();
    }
    return database.batch(statements);
  } });
  await guarded.ensureTables(); armed = true;
  handlers = createCirclePortalHandlers({ ...options, repository: guarded });
  assert.equal((await review(admin, application.id)).status, 409);
  assert.equal((await repository.getOrganizerApplication(application.id)).status, "pending");
  assert.equal(await count("organizer_event_candidates"), 0); assert.equal(await count("organizer_event_grants"), 0);
});

test("account deletion erases application free text and pending requests while keeping reviewed decisions", async () => {
  const owner = await signIn("applicant@example.test"); const admin = await signIn("admin@example.test");
  const pending = await created(owner); const rejected = await created(owner); const approved = await created(owner);
  await review(admin, rejected.id, "rejected", "個人說明"); await review(admin, approved.id);
  const account = await database.prepare("SELECT id FROM accounts WHERE email = 'applicant@example.test'").first();
  // Existing sole-owner safeguards apply before deletion; this test exercises
  // the repository's erasure once transfer has removed the last-owner block.
  await database.prepare("DELETE FROM organizer_event_grants WHERE account_id = ?1").bind(account.id).run();
  await repository.beginAccountDeletion({ accountId: account.id, email: "applicant@example.test", now });
  assert.equal(await repository.deleteAccount({ accountId: account.id, email: "applicant@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now }), true);
  assert.equal(await repository.getOrganizerApplication(pending.id), null);
  for (const id of [rejected.id, approved.id]) {
    const row = await repository.getOrganizerApplication(id);
    assert.equal(row.data_json, "{}"); assert.equal(row.account_id, "[shredded]"); assert.equal(row.reason, ""); assert.equal(row.applicant_email, null);
  }
  assert.equal(await count("organizer_event_candidates"), 1);
  assert.equal((await review(admin, pending.id)).status, 409);
});
