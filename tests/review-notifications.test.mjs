import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { runReviewNotificationTick } = await load("/app/review-notification-scheduler.ts");
const { nextNotificationSlot, notificationRetryDelay } = await load("/app/review-notifications.ts");
const { MailDeliveryError, sendPortalMail, sendMailgun } = await load("/app/portal-mail.ts");
const notificationWorker = (await load("/workers/publication-dispatch/index.ts")).default;
const { createCirclePortalHandlers, SESSION_COOKIE } = await load("/app/circle-portal-handlers.ts");
const { hmacSign } = await load("/app/portal-crypto.ts");
const { purgeExpiredRecords } = await load("/db/retention-purge.ts");
const { createEmptyOrganizerEventDraft } = await load("/app/organizer-event.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: "review-notifications" } }));
const db = await mf.getD1Database("DB");
const repo = createIdentityRepository(db);
after(async () => { await mf.dispose(); await vite.close(); });
const START = Date.UTC(2027, 0, 1, 0, 1), ADMIN = "admin@example.test", SECOND = "second@example.test";
let now, owner, sent, handlers, cookie;
const application = { name: "測試活動", officialUrl: "https://official.example", startDate: "2027-02-01", endDate: "2027-02-01", location: "", relationship: "curator", note: "依官方來源整理。" };
async function count(table, where = "1") { return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first()).n; }
async function submit(id = crypto.randomUUID()) {
  return repo.submitOrganizerApplication({ id, accountId: owner, data: application, now });
}
async function tick(sendMail = async mail => { sent.push(mail); return `provider-${sent.length}`; }) {
  return runReviewNotificationTick({ repository: repo, origin: "https://map.kotoban.top", now: () => now, sendMail });
}
async function prefs(email = ADMIN) { return repo.getNotificationPreferences(email); }
async function save(change, email = ADMIN) {
  return repo.saveNotificationPreferences({ ...await prefs(email), ...change, email, sessionId: email, now });
}
function request(method = "GET", body, signed = cookie) {
  return new Request("https://map.kotoban.top/api/admin/notification-preferences?event=missing", {
    method, headers: { "content-type": "application/json", origin: "https://map.kotoban.top", ...(signed ? { cookie: signed } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  now = START; sent = [];
  await repo.ensureTables(); await repo.clearPreviewData();
  await db.prepare("DELETE FROM admin_notification_preferences").run();
  await db.prepare("DELETE FROM admins").run();
  for (const email of [ADMIN, SECOND]) {
    await repo.addAdmin(email, "bootstrap", now);
    const id = await repo.upsertAccount(email, now);
    await repo.createSession(id, now, now + 365 * 86400000, email);
  }
  owner = await repo.upsertAccount("owner@example.test", now);
  cookie = `${SESSION_COOKIE}=${ADMIN}.${await hmacSign("secret", ADMIN)}`;
  handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "sample", origin: "https://map.kotoban.top", sessionSecret: "secret", hashPepper: "pepper", adminEmails: [],
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2027-12-31T00:00:00Z", now: () => now } });
});

test("slots use whole five minutes, whole hours and Taipei 09:00, never the current slot", () => {
  assert.equal(nextNotificationSlot("five_minutes", START), Date.UTC(2027, 0, 1, 0, 5));
  assert.equal(nextNotificationSlot("hourly", START), Date.UTC(2027, 0, 1, 1));
  assert.equal(nextNotificationSlot("daily", START), Date.UTC(2027, 0, 1, 1));
  assert.equal(nextNotificationSlot("daily", Date.UTC(2027, 0, 1, 1)), Date.UTC(2027, 0, 2, 1));
  assert.equal(notificationRetryDelay(1), 60000);
  assert.equal(notificationRetryDelay(99), 6 * 3600000);
});

test("preferences default independently; API enforces session, admin, enum and CAS without event scope", async () => {
  assert.equal((await handlers.adminGetNotificationPreferences(request())).status, 200);
  assert.deepEqual(await prefs(), { enabled: true, cadence: "five_minutes", version: 1 });
  assert.equal((await handlers.adminGetNotificationPreferences(request("GET", undefined, ""))).status, 401);
  for (const change of [{ cadence: "weekly" }, { email: SECOND }, { enabled: "true" }, { version: 0 }]) {
    assert.equal((await handlers.adminSaveNotificationPreferences(request("PUT", { ...await prefs(), ...change }))).status, 400);
  }
  const original = await prefs();
  assert.equal((await handlers.adminSaveNotificationPreferences(request("PUT", { ...original, cadence: "daily" }))).status, 200);
  assert.equal((await handlers.adminSaveNotificationPreferences(request("PUT", { ...original, enabled: false }))).status, 409);
  assert.equal((await prefs()).cadence, "daily");
  assert.equal((await prefs(SECOND)).cadence, "five_minutes");
  await repo.removeAdmin(ADMIN);
  assert.equal((await handlers.adminGetNotificationPreferences(request())).status, 403);
});

test("no backfill, atomic enqueue, application replay and source rollback", async () => {
  await submit("first"); await submit("first");
  assert.equal(await count("review_notification_items"), 2);
  await repo.addAdmin("new@example.test", ADMIN, now);
  assert.equal(await count("review_notification_items", "recipient = 'new@example.test'"), 0);
  await db.exec("CREATE TRIGGER test_outbox_failure BEFORE INSERT ON review_notification_items BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;");
  try { await assert.rejects(submit("rollback")); }
  finally { await db.exec("DROP TRIGGER test_outbox_failure;"); }
  assert.equal(await repo.getOrganizerApplication("rollback"), null);
});

test("close cancels queued and retry batches; reopen receives only new submissions", async () => {
  await submit("before");
  now = nextNotificationSlot("five_minutes", now);
  await tick(async () => { throw new MailDeliveryError("mailgun_429"); });
  await save({ enabled: false });
  assert.equal(await count("review_notification_batches", "recipient = 'admin@example.test' AND state = 'pending'"), 0);
  await submit("during");
  now += 1000; await save({ enabled: true });
  await submit("after");
  now = nextNotificationSlot("five_minutes", now);
  await tick();
  const adminMail = sent.find(mail => mail.to === ADMIN);
  assert.match(adminMail.subject, /1 筆/);
  assert.equal(await count("review_notification_items", "recipient = 'admin@example.test' AND subject_id = 'during'"), 0);
});

test("different schedules aggregate once; no mail before slot or repeated overdue reminders", async () => {
  await save({ cadence: "daily" }, SECOND);
  await submit(); await submit();
  assert.deepEqual(await tick(), []);
  now = nextNotificationSlot("five_minutes", now); await tick();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, ADMIN); assert.match(sent[0].subject, /2 筆/);
  now = Date.UTC(2027, 0, 3, 2); await tick();
  assert.equal(sent.length, 2); assert.equal(sent[1].to, SECOND);
  now += 86400000; await tick(); assert.equal(sent.length, 2);
  await submit(); await tick(); assert.equal(sent.length, 2, "new item after an idle period waits for its next slot");
});

test("cadence change keeps pending work and stale saves cannot move its retry schedule", async () => {
  await submit();
  now = nextNotificationSlot("five_minutes", now);
  await tick(async () => { throw new Error("private provider body"); });
  const old = await prefs();
  await save({ cadence: "daily" });
  const expected = nextNotificationSlot("daily", now);
  assert.equal(await repo.saveNotificationPreferences({ ...old, cadence: "hourly", email: ADMIN, sessionId: ADMIN, now }), null);
  assert.equal((await db.prepare("SELECT retry_at FROM review_notification_batches WHERE recipient = ?1 AND state = 'pending'").bind(ADMIN).first()).retry_at, expected);
  now = expected; await tick();
  assert.ok(sent.find(mail => mail.to === ADMIN));
});

test("independent retries preserve batch membership, cancel handled items and sanitize errors", async () => {
  await submit("handled"); await submit("still-pending");
  now = nextNotificationSlot("five_minutes", now);
  await tick(async mail => {
    if (mail.to === ADMIN) throw new MailDeliveryError("mailgun_500");
    sent.push(mail); return "second-ok";
  });
  await db.prepare("UPDATE organizer_applications SET status = 'rejected' WHERE id = 'handled'").run();
  await submit("later");
  now += 60000; await tick();
  assert.equal(sent.filter(mail => mail.to === SECOND).length, 1);
  assert.match(sent.find(mail => mail.to === ADMIN).subject, /1 筆/);
  assert.equal(await count("review_notification_items", "recipient = 'admin@example.test' AND subject_id = 'later' AND batch_id IS NULL"), 1);
});

test("overlapping ticks send once; expired lease recovers after process loss", async () => {
  await submit(); now = nextNotificationSlot("five_minutes", now);
  await Promise.all([tick(), tick()]);
  assert.equal(sent.length, 2); assert.equal(new Set(sent.map(mail => mail.to)).size, 2);
  await submit(); now = nextNotificationSlot("five_minutes", now);
  const abandoned = await repo.claimNotificationBatch(ADMIN, now);
  assert.ok(abandoned);
  await tick(); assert.equal(sent.length, 3);
  now += 120001; await tick(); assert.equal(sent.length, 4);
  assert.equal(await repo.readNotificationBatch(abandoned, now), null);
});

test("revoked and disabled recipients stop immediately; removing and readding does not replay old work", async () => {
  await submit(); await repo.removeAdmin(ADMIN); await repo.disableAccount(SECOND, now);
  now = nextNotificationSlot("five_minutes", now); await tick(); assert.equal(sent.length, 0);
  await repo.addAdmin(ADMIN, SECOND, now); await tick(); assert.equal(sent.length, 0);
  await submit(); now = nextNotificationSlot("five_minutes", now); await tick(); assert.equal(sent.length, 1);
});

test("claim occurrences survive reused ids without reviving earlier notifications; verified claims are silent", async () => {
  const claim = { id: "claim", accountId: owner, eventId: "sample", circleId: "c-1", circleNameKey: "circle", circleNameAtClaim: "Circle", sourceRowAtClaim: null,
    status: "pending", method: null, targetUrl: null, challengeTokenHash: null, challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now };
  assert.equal(await repo.createClaim(claim), "claim");
  assert.equal(await repo.createClaim(claim), null);
  await repo.createClaim({ ...claim, id: "verified", circleId: "c-2", status: "verified", method: "email_domain" });
  await repo.withdrawClaim("claim", owner);
  assert.equal(await repo.createClaim(claim), "claim");
  assert.equal(await count("review_notification_items"), 4);
  now = nextNotificationSlot("five_minutes", now); await tick();
  assert.equal(sent.length, 2); assert.match(sent[0].subject, /1 筆/);
  assert.match(sent[0].text, /\/admin\?event=sample#admin/);
});

test("organizer and independent map submissions enqueue and resubmit separately", async () => {
  const draft = createEmptyOrganizerEventDraft("Review event");
  await repo.createOrganizerCandidate({ id: "event", tentativeName: "Review event", ownerEmail: "owner@example.test", createdByAccountId: owner, draftJson: JSON.stringify(draft), now });
  await repo.acceptOrganizerInvitations({ accountId: owner, email: "owner@example.test", now });
  await db.prepare("UPDATE organizer_event_candidates SET event_id = 'sample' WHERE id = 'event'").run();
  assert.equal((await repo.submitOrganizerCandidate({ candidateId: "event", actorAccountId: owner, expectedVersion: 1, now })).ok, true);
  assert.equal((await repo.submitOrganizerCandidate({ candidateId: "event", actorAccountId: owner, expectedVersion: 1, now })).ok, false);
  await repo.manageMapContributor({ email: "owner@example.test", action: "grant", by: ADMIN, now });
  await repo.createMapDraft({ id: "map", eventId: "sample", periodKey: "day-1", venueSpaceId: "hall", ownerAccountId: owner, contentJson: "{}", now });
  assert.equal(await repo.submitMapDraft({ draftId: "map", eventId: "sample", ownerAccountId: owner, expectedRevision: 1, now }), true);
  await db.prepare("UPDATE map_drafts SET status = 'changes_requested' WHERE id = 'map'").run();
  assert.equal(await repo.submitMapDraft({ draftId: "map", eventId: "sample", ownerAccountId: owner, expectedRevision: 1, now }), true);
  now = nextNotificationSlot("five_minutes", now); await tick();
  assert.equal(sent.length, 2); assert.match(sent[0].text, /活動內容送審.*：1 筆/); assert.match(sent[0].text, /地圖貢獻.*：1 筆/);
});

test("preview sink end-to-end and thirty day purge retain pending work", async () => {
  await submit(); now = nextNotificationSlot("five_minutes", now);
  await tick(mail => sendPortalMail({ PREVIEW_MAIL_SINK: "d1", PREVIEW_TEST_RECIPIENTS: `${ADMIN},${SECOND}` }, mail,
    message => repo.storePreviewMail({ email: message.to, subject: message.subject, text: message.text, now })));
  assert.match((await repo.latestPreviewMail(ADMIN)).text, /活動申請：1 筆/);
  await assert.rejects(sendPortalMail({ PREVIEW_MAIL_SINK: "d1" }, { to: "denied@example.test", subject: "x", text: "x" }, async () => {}), /preview_recipient_denied/);
  await submit("pending");
  const summary = await purgeExpiredRecords(db, now + 31 * 86400000);
  assert.equal(summary.deleted.review_notification_items, 2);
  assert.equal(summary.deleted.review_notification_batches, 2);
  assert.equal(await count("review_notification_items", "state = 'pending'"), 2);
});

test("real preference API and application API feed the scheduled digest", async () => {
  await repo.createSession(owner, now, now + 86400000, "owner-session");
  const ownerCookie = `${SESSION_COOKIE}=owner-session.${await hmacSign("secret", "owner-session")}`;
  // Session and write gates are the production handlers; only external mail is
  // replaced with the same isolated sink used by preview.
  const enabled = await handlers.adminSaveNotificationPreferences(request("PUT", { ...await prefs(), cadence: "hourly" }));
  assert.equal(enabled.status, 200);
  const openHandlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "sample", origin: "https://map.kotoban.top", sessionSecret: "secret", hashPepper: "pepper", adminEmails: [],
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2027-12-31T00:00:00Z", now: () => now, organizerApplicationsOpen: true } });
  const response = await openHandlers.submitEventApplication(new Request("https://map.kotoban.top/api/organizer/applications", {
    method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ id: crypto.randomUUID(), application }),
  }));
  assert.equal(response.status, 201, await response.clone().text());
  now = nextNotificationSlot("hourly", now);
  await tick(mail => sendPortalMail({ PREVIEW_MAIL_SINK: "d1", PREVIEW_TEST_RECIPIENTS: `${ADMIN},${SECOND}` }, mail,
    message => repo.storePreviewMail({ email: message.to, subject: message.subject, text: message.text, now })));
  assert.match((await repo.latestPreviewMail(ADMIN)).subject, /1 筆新增待審/);
});

test("Worker notification tick runs with publication disabled and despite publication failure", async () => {
  now = Date.now() - 600000;
  await db.prepare("UPDATE admin_notification_preferences SET enabled_since = 0, next_digest_at = 0").run();
  await submit("worker-disabled-publication");
  const env = { DB: db, ORGANIZER_PUBLICATION_MODE: "disabled", ADMIN_REVIEW_NOTIFICATIONS_ENABLED: "true",
    NOTIFICATION_ORIGIN: "https://map.kotoban.top", PREVIEW_MAIL_SINK: "d1", PREVIEW_TEST_RECIPIENTS: `${ADMIN},${SECOND}` };
  await notificationWorker.scheduled({}, env);
  assert.match((await repo.latestPreviewMail(ADMIN)).subject, /1 筆新增待審/);
  await submit("worker-failing-publication");
  await db.prepare("UPDATE admin_notification_preferences SET next_digest_at = 0").run();
  const failingPublicationDB = { prepare(sql) {
    if (/^(SELECT|UPDATE)[\s\S]*organizer_publication_jobs/.test(sql.trim())) throw new Error("publication unavailable");
    return db.prepare(sql);
  }, batch: statements => db.batch(statements) };
  await notificationWorker.scheduled({}, { ...env, DB: failingPublicationDB, ORGANIZER_PUBLICATION_MODE: "fake" });
  assert.equal(await count("review_notification_batches", "state = 'accepted'"), 4);
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
    assert.equal(await sendMailgun(env, { to: ADMIN, subject: "x", text: "x" }), "provider-message");
    globalThis.fetch = async () => new Response("private recipient and body", { status: 429 });
    await assert.rejects(sendMailgun(env, { to: ADMIN, subject: "x", text: "x" }), error => error.code === "mailgun_429" && !error.message.includes("private"));
  } finally { globalThis.fetch = originalFetch; }
});
