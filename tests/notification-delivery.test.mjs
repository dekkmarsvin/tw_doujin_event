import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";
import { resetSiteSettings } from "./support/site-settings-fixture.mjs";
import { applyMigrations } from "./support/d1-migrations.mjs";

// #546 5c: every notice is one email, written to the outbox with the change it
// reports and sent after the write request, with retries by later requests.
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { deliverNotifications } = await load("/app/notification-delivery.ts");
const { MailDeliveryError, sendPortalMail } = await load("/app/portal-mail.ts");
const { SESSION_COOKIE } = await load("/app/circle-portal-handlers.ts");
const { createAuth } = await load("/server/auth.ts");
const { hmacSign } = await load("/app/portal-crypto.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: "notification-delivery" } }));
const db = await mf.getD1Database("DB");
await applyMigrations(db);
const repo = createIdentityRepository(db);
after(async () => { await mf.dispose(); await vite.close(); });

const START = Date.UTC(2027, 0, 1, 0, 1), ADMIN = "admin@example.test", SECOND = "second@example.test";
const application = { name: "測試活動", officialUrl: "https://official.example", startDate: "2027-02-01", endDate: "2027-02-01", location: "", relationship: "curator", note: "依官方來源整理" };
let now, owner, sent, handlers, cookie;

const deliver = (sendMail = async mail => { sent.push(mail); return `provider-${sent.length}`; }) =>
  deliverNotifications({ repository: repo, origin: "https://map.kotoban.top", now: () => now, sendMail });
const items = async (where = "1") => (await db.prepare(`SELECT * FROM account_notification_items WHERE ${where} ORDER BY occurred_at, id`).all()).results;
async function claim(id = "claim", status = "verified") {
  return repo.createClaim({ id, accountId: owner, eventId: "sample", circleId: id, circleNameKey: "same-name", circleNameAtClaim: "同名社團",
    sourceRowAtClaim: null, status, method: status === "verified" ? "email_domain" : null, targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now });
}
function preferences(method = "GET", body) {
  return new Request("https://map.kotoban.top/api/account/notification-preferences", {
    method, headers: { "content-type": "application/json", origin: "https://map.kotoban.top", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  now = START; sent = [];
  await repo.ensureTables(); await repo.clearPreviewData();
  await resetSiteSettings(db, { accountNotificationsEnabled: true, accountNotificationsSince: 0, adminReviewNotificationsEnabled: true });
  await db.prepare("DELETE FROM admins").run();
  for (const email of [ADMIN, SECOND]) {
    await repo.addAdmin(email, "bootstrap", now);
    await repo.upsertAccount(email, now);
  }
  owner = await repo.upsertAccount("owner@example.test", now);
  await repo.createSession(owner, now, now + 365 * 86400000, owner);
  cookie = `${SESSION_COOKIE}=${owner}.${await hmacSign("secret", owner)}`;
  handlers = createAuth({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "sample", origin: "https://map.kotoban.top", sessionSecret: "secret", hashPepper: "pepper", adminEmails: [],
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2027-12-31T00:00:00Z", now: () => now } }).routes;
});

test("each claim result and content change is its own email, sent at once and only once", async () => {
  await claim("approved");
  await claim("rejected", "pending"); await repo.setClaimStatus("rejected", "rejected", now, "admin", "pending");
  await repo.putOverride({ eventId: "sample", circleId: "approved", fieldsJson: JSON.stringify({ pen: "更新" }), updatedBy: owner, accountId: owner, now });
  await deliver();
  // The claim was rejected before delivery, so the admins hear nothing about it.
  assert.equal(sent.filter(mail => mail.to !== "owner@example.test").length, 0);
  sent = sent.filter(mail => mail.to === "owner@example.test");
  assert.equal(sent.length, 3, "approval, rejection and the content update, no digest wait");
  assert.ok(sent.some(mail => mail.subject.includes("認領通過")));
  assert.ok(sent.some(mail => mail.subject.includes("未通過")));
  assert.ok(sent.some(mail => mail.subject.includes("補充資料更新")));
  const before = sent.length; await deliver();
  assert.equal(sent.length, before, "a sent notice is not sent again");
  assert.ok((await items("audience <> 'admin'")).every(item => item.state === "accepted"));
  assert.ok((await items("audience = 'admin'")).every(item => item.state === "cancelled"));
});

test("a new item waiting for review emails each admin once", async () => {
  await repo.submitOrganizerApplication({ id: "application", accountId: owner, data: application, now });
  await repo.submitOrganizerApplication({ id: "application", accountId: owner, data: application, now });
  await deliver();
  assert.deepEqual(sent.map(mail => mail.to).sort(), [ADMIN, SECOND]);
  assert.ok(sent.every(mail => /活動申請：1 筆|活動申請/.test(mail.text) && mail.subject.includes("1 筆")));
  await repo.removeAdmin(SECOND);
  await repo.submitOrganizerApplication({ id: "second", accountId: owner, data: application, now });
  sent = []; await deliver();
  assert.deepEqual(sent.map(mail => mail.to), [ADMIN], "a removed admin gets nothing new");
});

test("the site switches stop new notices; a notice no longer true is not sent", async () => {
  await resetSiteSettings(db, { accountNotificationsEnabled: false, adminReviewNotificationsEnabled: false });
  await claim("quiet");
  await repo.submitOrganizerApplication({ id: "quiet-application", accountId: owner, data: application, now });
  assert.equal((await items()).length, 0);
  await resetSiteSettings(db, { accountNotificationsEnabled: true, accountNotificationsSince: 0, adminReviewNotificationsEnabled: true });
  await claim("withdrawn");
  await repo.setClaimStatus("withdrawn", "revoked", now, "admin", "verified");
  await deliver();
  assert.deepEqual(sent.map(mail => mail.subject.includes("撤銷")), [true], "the approval was revoked before it went out");
  assert.equal((await items("kind = 'claim.approved'"))[0].state, "cancelled");
});

test("a failed send is retried later, a permanent refusal is not, and nothing is retried past 48 hours", async () => {
  await claim("temporary");
  await deliver(async () => { throw new Error("private provider body"); });
  assert.equal((await items())[0].state, "pending");
  await deliver(); assert.equal(sent.length, 0, "not before the retry delay");
  now += 10 * 60_000; await deliver(); assert.equal(sent.length, 1);
  await claim("permanent");
  await deliver(async () => { throw new MailDeliveryError("mailgun_400"); });
  assert.equal((await items("source_id = 'permanent'"))[0].state, "failed");
  await claim("expired");
  await deliver(async () => { throw new Error("down"); });
  now += 48 * 3_600_000; await deliver();
  assert.equal((await items("source_id = 'expired'"))[0].state, "failed");
  assert.equal(sent.length, 1);
});

// #546 5c review fixes.
test("a review notice is dropped once the item stopped waiting; an untried notice is never given up", async () => {
  await claim("withdrawn-claim", "pending");
  await repo.setClaimStatus("withdrawn-claim", "rejected", now, "admin", "pending");
  await deliver();
  assert.equal(sent.filter(mail => mail.to === ADMIN).length, 0, "the claim left the queue before the notice went out");
  await claim("waited");
  now += 72 * 3_600_000;
  sent = []; await deliver();
  assert.ok(sent.some(mail => mail.subject.includes("認領通過")), "a notice nobody tried to send still goes out");
});

test("circle mail uses the account's language; only the language can be saved", async () => {
  assert.deepEqual(await (await handlers.getAccountNotificationPreferences(preferences())).json(), { version: 0, locale: null });
  assert.equal((await handlers.saveAccountNotificationPreferences(preferences("PUT", { version: 0, cadence: "off" }))).status, 400);
  assert.equal((await handlers.saveAccountNotificationPreferences(preferences("PUT", { version: 0, locale: "ja" }))).status, 200);
  await claim("ja");
  await deliver();
  assert.match(sent[0].subject, /管理申請が承認されました/);
  assert.match(sent[0].html, /<html lang="ja">/);
});

test("account deletion removes queued notices and the language preference", async () => {
  await handlers.saveAccountNotificationPreferences(preferences("PUT", { version: 0, locale: "en" }));
  await claim("gone");
  assert.equal(await repo.beginAccountDeletion({ accountId: owner, email: "owner@example.test", now }), true);
  await repo.deleteAccount({ accountId: owner, email: "owner@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now });
  assert.equal((await items(`account_id = '${owner}'`)).length, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM account_notification_preferences WHERE account_id = ?1").bind(owner).first()).n, 0);
});

test("a write request sends what is due after its response", async () => {
  const { onRequest } = await load("/functions/_middleware.ts");
  const pending = [];
  const context = (method) => ({ request: new Request("https://map.kotoban.top/api/claims", { method, headers: { "content-type": "application/json", origin: "https://map.kotoban.top" } }),
    env: { DB: db }, next: async () => new Response("{}"), waitUntil: promise => pending.push(promise) });
  await onRequest(context("GET"));
  assert.equal(pending.length, 0, "a read schedules nothing");
  await onRequest(context("POST"));
  assert.equal(pending.length, 1);
  const rejected = { ...context("POST"), next: async () => new Response("{}", { status: 401 }) };
  await onRequest(rejected);
  assert.equal(pending.length, 1, "a refused write queued nothing, so nothing runs after it");
});

test("Mailgun transport has a timeout, records provider id, and rejects without leaking response text", async () => {
  const originalFetch = globalThis.fetch;
  const env = { MAILGUN_API_KEY: "fixture-key", MAILGUN_DOMAIN: "fixture.example" };
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.body.get("to"), ADMIN);
      return Response.json({ id: "provider-message" });
    };
    assert.equal(await sendPortalMail(env, { to: ADMIN, subject: "x", text: "x" }, async () => assert.fail("production sink")), "provider-message");
    globalThis.fetch = async () => new Response("private recipient and body", { status: 429 });
    await assert.rejects(sendPortalMail(env, { to: ADMIN, subject: "x", text: "x" }, async () => assert.fail("production sink")), error => error.code === "mailgun_429" && !error.message.includes("private"));
  } finally { globalThis.fetch = originalFetch; }
});
