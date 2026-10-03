import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";
import { resetSiteSettings } from "./support/site-settings-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { createCirclePortalHandlers, SESSION_COOKIE } = await load("/app/circle-portal-handlers.ts");
const { hmacSign } = await load("/app/portal-crypto.ts");
const { runPublicationTick } = await load("/app/publication-scheduler.ts");
const { runRequestedServiceCheck, checkMailService, checkPublicationService } = await load("/app/site-service-check.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: "site-settings" } }));
const db = await mf.getD1Database("DB");
const repo = createIdentityRepository(db);
const origin = "https://map.example.test", now = Date.UTC(2027, 0, 1);
let admin, cookie, memberCookie, handlers;
after(async () => { await mf.dispose(); await vite.close(); });
beforeEach(async () => {
  await repo.ensureTables(); await repo.clearPreviewData(); await resetSiteSettings(db);
  await db.prepare("DELETE FROM site_service_check").run();
  await repo.addAdmin("admin@example.test", "bootstrap", now);
  admin = await repo.upsertAccount("admin@example.test", now);
  await repo.createSession(admin, now, now + 86400000, "admin-session");
  cookie = `${SESSION_COOKIE}=admin-session.${await hmacSign("secret", "admin-session")}`;
  const member = await repo.upsertAccount("member@example.test", now);
  await repo.createSession(member, now, now + 86400000, "member-session");
  memberCookie = `${SESSION_COOKIE}=member-session.${await hmacSign("secret", "member-session")}`;
  handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null, searchCircles: async () => [],
    fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "sample", origin, sessionSecret: "secret", hashPepper: "pepper", adminEmails: [], now: () => now,
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2027-12-31T00:00:00Z", organizerPublicationMode: "github" } });
});
function request(method = "GET", body, signed = cookie) {
  return new Request(`${origin}/api/admin/site-settings`, { method, headers: { origin, "content-type": "application/json", ...(signed ? { cookie: signed } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function save(change, signed = cookie, version) {
  const current = await repo.getSiteSettings();
  const settings = { organizerApplicationMode: current.organizerApplicationMode, organizerAllowedEmails: current.organizerAllowedEmails,
    accountNotificationsEnabled: current.accountNotificationsEnabled, adminReviewNotificationsEnabled: current.adminReviewNotificationsEnabled,
    publicationEnabled: current.publicationEnabled, contactUrl: current.contactUrl, claimReviewNotice: current.claimReviewNotice };
  return handlers.adminUpdateSiteSettings(request("PUT", { settings: { ...settings, ...change }, expectedUpdatedAt: version ?? current.updatedAt }, signed));
}

test("settings are admin-only, validate the complete object and atomically audit a versioned update", async () => {
  assert.equal((await handlers.adminGetSiteSettings(request("GET", undefined, ""))).status, 401);
  assert.equal((await handlers.adminGetSiteSettings(request("GET", undefined, memberCookie))).status, 403);
  assert.equal((await save({ organizerApplicationMode: "public" }, memberCookie)).status, 403);
  for (const change of [{ organizerApplicationMode: "open" }, { publicationEnabled: "true" }, { organizerAllowedEmails: ["bad"] }, { accountNotificationsSince: 0 },
    { contactUrl: "http://discord.gg/x" }, { contactUrl: "javascript:alert(1)" }, { claimReviewNotice: "字".repeat(201) }]) {
    assert.equal((await save(change)).status, 400);
  }
  assert.equal((await handlers.adminUpdateSiteSettings(request("PUT", { settings: { publicationEnabled: true }, expectedUpdatedAt: 1 }))).status, 400);
  const response = await save({ organizerApplicationMode: "invite_only", organizerAllowedEmails: ["  MEMBER@example.test ", "member@example.test", " "] });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await response.json()).settings;
  assert.deepEqual(saved.organizerAllowedEmails, ["member@example.test"]);
  assert.equal(saved.updatedBy, "admin@example.test");
  assert.equal((await save({ organizerApplicationMode: "public" }, cookie, 1)).status, 409);
  const audit = (await db.prepare("SELECT * FROM audit_log WHERE action = 'site_settings.updated'").all()).results;
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_account_id, admin);
  assert.doesNotMatch(audit[0].detail_json, /member@example/);
  await db.prepare("UPDATE sessions SET revoked_at = ?1 WHERE id = 'admin-session'").bind(now).run();
  assert.equal((await save({ organizerApplicationMode: "public" })).status, 401);
  assert.equal((await repo.getSiteSettings()).organizerApplicationMode, "invite_only");
});

test("warm repositories and the same handlers see new modes and notification epochs without recreation", async () => {
  const warmWorker = createIdentityRepository(db, { initializeSiteSettings: false });
  assert.equal((await warmWorker.getSiteSettings()).organizerApplicationMode, "closed");
  assert.equal((await handlers.session(request("GET", undefined, memberCookie))).status, 200);
  assert.equal((await (await handlers.session(request("GET", undefined, memberCookie))).json()).canApplyForEvent, false);
  await save({ organizerApplicationMode: "invite_only", organizerAllowedEmails: ["member@example.test"], accountNotificationsEnabled: true });
  assert.equal((await warmWorker.getSiteSettings()).accountNotificationsSince, now);
  assert.equal((await (await handlers.session(request("GET", undefined, memberCookie))).json()).canApplyForEvent, true);
  await save({ organizerApplicationMode: "closed", accountNotificationsEnabled: false });
  assert.equal((await warmWorker.getSiteSettings()).accountNotificationsEnabled, false);
  assert.equal((await (await handlers.session(request("GET", undefined, memberCookie))).json()).canApplyForEvent, false);
  await save({ organizerApplicationMode: "public", organizerAllowedEmails: [] });
  assert.equal((await (await handlers.session(request("GET", undefined, memberCookie))).json()).canApplyForEvent, true);
});

test("Worker does not seed settings; Pages defaults are conservative and never overwrite persisted choices", async () => {
  await db.prepare("DELETE FROM site_settings").run();
  const worker = createIdentityRepository(db, { initializeSiteSettings: false });
  assert.equal(await worker.getSiteSettings(), null);
  const pages = createIdentityRepository(db);
  const initial = await pages.getSiteSettings();
  assert.equal(initial.organizerApplicationMode, "closed");
  assert.deepEqual(initial.organizerAllowedEmails, []);
  assert.equal(initial.accountNotificationsEnabled, false);
  assert.equal(initial.accountNotificationsSince, null);
  assert.equal(initial.adminReviewNotificationsEnabled, false);
  assert.equal(initial.publicationEnabled, false);
  assert.equal(initial.contactUrl, ""); assert.equal(initial.claimReviewNotice, "");
  await resetSiteSettings(db, { organizerApplicationMode: "invite_only", organizerAllowedEmails: ["invited@example.test"],
    accountNotificationsEnabled: true, accountNotificationsSince: 1_790_000_000_000,
    adminReviewNotificationsEnabled: true, publicationEnabled: true });
  const settings = await pages.getSiteSettings();
  await createIdentityRepository(db).getSiteSettings();
  assert.deepEqual(await worker.getSiteSettings(), settings);
});

test("publication pause preserves queued work and resume restarts the existing timeout window", async () => {
  await repo.createOrganizerCandidate({ id: "candidate", tentativeName: "排程活動", ownerEmail: "owner@example.test", createdByAccountId: admin,
    draftJson: "{}", now });
  await db.prepare(`INSERT INTO organizer_publication_jobs (id, candidate_id, candidate_version, snapshot_id, approval_hash, created_at, updated_at)
    VALUES ('job', 'candidate', 1, 'snapshot', 'hash', ?1, ?1)`).bind(now - 3600000).run();
  const before = await repo.getOrganizerPublicationJob("job");
  await save({ publicationEnabled: false });
  const driver = { eventExists: () => { throw new Error("must not execute"); }, run: () => { throw new Error("must not execute"); } };
  assert.deepEqual(await runPublicationTick({ repository: repo, driver, now: () => now }), { expired: [], results: [] });
  assert.deepEqual(await repo.getOrganizerPublicationJob("job"), before);
  const listed = (await (await handlers.adminGetSiteSettings(request())).json()).publicationActivities;
  assert.equal(listed[0].eventName, "排程活動"); assert.equal(listed[0].status, "queued");
  await save({ publicationEnabled: true });
  const resumed = await repo.getOrganizerPublicationJob("job");
  assert.equal(resumed.updated_at, now);
  for (const key of ["id", "step", "snapshot_id", "approval_hash", "status"]) assert.equal(resumed[key], before[key]);
  assert.deepEqual(await repo.expireStalledOrganizerPublicationJobs({ now, timeoutMs: 900000 }), { expired: [] });
});

test("service checks use Worker credentials, return safe sources and never send a message", async () => {
  assert.equal((await handlers.adminRequestServiceCheck(request("POST", {}, memberCookie))).status, 403);
  assert.equal((await handlers.adminRequestServiceCheck(request("POST", {}))).status, 202);
  await runRequestedServiceCheck(repo, { PREVIEW_MAIL_SINK: "d1", ORGANIZER_PUBLICATION_MODE: "disabled" });
  const checked = await repo.getServiceChecks();
  assert.equal(checked.mail.status, "available"); assert.equal(checked.publication.status, "unavailable");
  assert.match(checked.publication.source, /發布設定/);
  const env = { MAILGUN_API_KEY: "never-return-this-key", MAILGUN_DOMAIN: "mail.example.test" };
  let calls = 0;
  const rejected = await checkMailService(env, async (url, init) => { calls++; assert.equal(init.method, undefined); assert.match(url, /\/v4\/domains\//); return new Response("secret-provider-body", { status: 401 }); });
  assert.equal(calls, 1); assert.equal(rejected.status, "unavailable"); assert.equal(rejected.source, "Mailgun");
  assert.doesNotMatch(JSON.stringify(rejected), /never-return|secret-provider/);
  assert.equal((await checkMailService(env, async () => new Response(null, { status: 403 }))).status, "unknown");
  assert.equal((await checkMailService(env, async () => { throw new Error("timeout"); })).status, "unknown");
  assert.equal((await checkPublicationService({ ORGANIZER_PUBLICATION_MODE: "github" })).source, "GitHub App 設定");
  await repo.requestServiceCheck(now + 1);
  await repo.completeServiceCheck(checked.requestedAt, now + 2, { mail: rejected, publication: rejected });
  assert.equal((await repo.getServiceChecks()).checkedAt, null, "an older check cannot overwrite a newer request");
});

test("contact settings reach both workspaces through the session and are cleared by saving empty values", async () => {
  const contact = async () => {
    const { contactUrl, claimReviewNotice } = await (await handlers.session(request("GET", undefined, memberCookie))).json();
    return { contactUrl, claimReviewNotice };
  };
  assert.deepEqual(await contact(), { contactUrl: "", claimReviewNotice: "" });
  assert.equal((await save({ contactUrl: " https://discord.gg/example ", claimReviewNotice: " 預計 1–3 天內完成審核。 " })).status, 200);
  assert.deepEqual(await contact(), { contactUrl: "https://discord.gg/example", claimReviewNotice: "預計 1–3 天內完成審核。" });
  assert.equal((await save({ contactUrl: "", claimReviewNotice: "" })).status, 200);
  assert.deepEqual(await contact(), { contactUrl: "", claimReviewNotice: "" });
});
