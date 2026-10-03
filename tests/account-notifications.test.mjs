import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";
import { resetSiteSettings } from "./support/site-settings-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { runAccountNotificationTick } = await load("/app/account-notification-scheduler.ts");
const { notificationParameters } = await load("/app/notification-navigation.ts");
const { accountNotificationLetter } = await load("/app/account-notifications.ts");
const { onRequest: middleware } = await load("/functions/_middleware.ts");
const { nextNotificationSlot } = await load("/app/review-notifications.ts");
const { MailDeliveryError, sendPortalMail } = await load("/app/portal-mail.ts");
const notificationWorker = (await load("/workers/publication-dispatch/index.ts")).default;
const { createCirclePortalHandlers, SESSION_COOKIE } = await load("/app/circle-portal-handlers.ts");
const { hmacSign, sha256Hex } = await load("/app/portal-crypto.ts");
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
  return runAccountNotificationTick({ repository: repo, origin: "https://map.kotoban.top", now: () => now, sendMail });
}
async function prefs(accountId = owner) { return repo.getAccountNotificationPreferences(accountId); }
async function save(change, accountId = owner) {
  return repo.saveAccountNotificationPreferences({ ...await prefs(accountId), ...change, accountId, sessionId: accountId, now });
}
function request(method = "GET", body, signed = cookie) {
  return new Request("https://map.kotoban.top/api/account/notification-preferences?event=missing", {
    method, headers: { "content-type": "application/json", origin: "https://map.kotoban.top", ...(signed ? { cookie: signed } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  now = START; sent = [];
  await repo.ensureTables(); await repo.clearPreviewData();
  await resetSiteSettings(db, { accountNotificationsEnabled: true, accountNotificationsSince: 0 });
  await db.prepare("DELETE FROM admin_notification_preferences").run();
  await db.prepare("DELETE FROM admins").run();
  for (const email of [ADMIN, SECOND]) {
    await repo.addAdmin(email, "bootstrap", now);
    const id = await repo.upsertAccount(email, now);
    await repo.createSession(id, now, now + 365 * 86400000, email);
  }
  owner = await repo.upsertAccount("owner@example.test", now);
  await repo.createSession(owner, now, now + 365 * 86400000, owner);
  cookie = `${SESSION_COOKIE}=${owner}.${await hmacSign("secret", owner)}`;
  handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "sample", origin: "https://map.kotoban.top", sessionSecret: "secret", hashPepper: "pepper", adminEmails: [],
      dataUpdatedAt: "2026-09-01T00:00:00Z", eventEndsAt: "2027-12-31T00:00:00Z", now: () => now } });
});

async function claim(id = "claim", status = "verified", eventId = "sample", accountId = owner) {
  return repo.createClaim({ id, accountId, eventId, circleId: id, circleNameKey: "same-name", circleNameAtClaim: "同名社團",
    sourceRowAtClaim: null, status, method: status === "verified" ? "email_domain" : null, targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now });
}
async function update(fields = { pen: "更新" }, id = "claim", eventId = "sample") {
  return repo.putOverride({ eventId, circleId: id, fieldsJson: JSON.stringify(fields), updatedBy: owner, accountId: owner, now });
}
const items = async (where = "1") => (await db.prepare(`SELECT * FROM account_notification_items WHERE ${where} ORDER BY occurred_at, id`).all()).results;
async function candidate(id = "candidate") {
  const draft = createEmptyOrganizerEventDraft("測試活動"); draft.event.id = id;
  const admin = await repo.upsertAccount(ADMIN, now);
  await repo.createOrganizerCandidate({ id, tentativeName: "測試活動", ownerEmail: "owner@example.test", createdByAccountId: admin,
    draftJson: JSON.stringify(draft), now });
  await repo.acceptOrganizerInvitations({ accountId: owner, email: "owner@example.test", now });
  await db.prepare("UPDATE organizer_event_candidates SET event_id = ?1 WHERE id = ?1").bind(id).run();
  return admin;
}
async function submitted(id = "candidate") {
  const admin = await candidate(id);
  const snapshotJson = JSON.stringify({ candidateId: id, candidateVersion: 1, eventId: id });
  const hash = await sha256Hex(snapshotJson);
  const snapshot = await repo.storeOrganizerSubmissionSnapshot({ candidateId: id, candidateVersion: 1, actorAccountId: owner, snapshotJson, sha256: hash, now });
  assert.equal((await repo.submitOrganizerCandidate({ candidateId: id, actorAccountId: owner, expectedVersion: 1, now })).ok, true);
  return { admin, publication: { jobId: `job-${id}`, snapshotId: snapshot.snapshotId, approvalHash: hash } };
}

test("account preferences require session, validate input, reject stale writes and preserve admin preferences", async () => {
  assert.deepEqual(await (await handlers.getAccountNotificationPreferences(request())).json(), { cadence: "daily", version: 0 });
  assert.equal((await handlers.getAccountNotificationPreferences(request("GET", undefined, ""))).status, 401);
  for (const change of [{ cadence: "weekly" }, { accountId: "other" }, { version: -1 }]) {
    assert.equal((await handlers.saveAccountNotificationPreferences(request("PUT", { ...await prefs(), ...change }))).status, 400);
  }
  assert.equal((await handlers.saveAccountNotificationPreferences(request("PUT", { cadence: "off", version: 0 }))).status, 200);
  assert.equal((await handlers.saveAccountNotificationPreferences(request("PUT", { cadence: "hourly", version: 0 }))).status, 409);
  assert.equal((await prefs()).cadence, "off");
  assert.deepEqual(await repo.getNotificationPreferences(ADMIN), { enabled: true, cadence: "five_minutes", version: 1 });
  for (const headers of [{ origin: "https://attacker.test", "content-type": "application/json" }, { origin: "https://map.kotoban.top", "content-type": "text/plain" }]) {
    const response = await middleware({ request: new Request("https://map.kotoban.top/api/account/notification-preferences", { method: "PUT", headers, body: "{}" }), next: () => { throw new Error("CSRF reached handler"); } });
    assert.ok([403, 415].includes(response.status));
  }
});

test("automatic/manual claim approvals, rejection and revocation notify once per occurrence", async () => {
  await claim(); await claim(); await claim("manual", "pending");
  assert.equal(await repo.markClaimVerified("manual", "manual", now, "admin"), true);
  assert.equal(await repo.markClaimVerified("manual", "manual", now, "admin"), false);
  await claim("reject", "pending");
  await repo.setClaimStatus("reject", "rejected", now, "admin", "pending");
  await repo.setClaimStatus("reject", "rejected", now, "admin", "pending");
  await repo.setClaimStatus("claim", "revoked", now, "admin", "verified");
  assert.equal((await items()).length, 4);
  await tick(); assert.equal(sent.length, 3);
  assert.ok(sent.every(mail => mail.to === "owner@example.test" && mail.html && !mail.text.includes("login=")));
  assert.ok(sent.some(mail => mail.subject.includes("未通過")));
  assert.ok(sent.some(mail => mail.subject.includes("撤銷")));
  await claim("resubmit", "pending"); await repo.withdrawClaim("resubmit", owner); await claim("resubmit", "pending"); await repo.setClaimStatus("resubmit", "rejected", now, "admin", "pending");
  await tick(); assert.equal(sent.length, 4, "resubmission is a new occurrence");
});

test("outbox failure rolls back claim, content and review domain writes", async () => {
  await claim("existing", "pending");
  await db.exec("CREATE TRIGGER account_outbox_failure BEFORE INSERT ON account_notification_items BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;");
  try {
    await assert.rejects(claim());
    await assert.rejects(repo.markClaimVerified("existing", "manual", now, "admin"));
  } finally { await db.exec("DROP TRIGGER account_outbox_failure;"); }
  assert.equal((await db.prepare("SELECT status FROM circle_claims WHERE id = 'existing'").first()).status, "pending");
  assert.equal(await db.prepare("SELECT id FROM circle_claims WHERE id = 'claim'").first(), null);
  await claim();
  await db.exec("CREATE TRIGGER account_outbox_failure BEFORE INSERT ON account_notification_items BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;");
  try { await assert.rejects(update()); } finally { await db.exec("DROP TRIGGER account_outbox_failure;"); }
  assert.equal(await repo.getOverride("sample", "claim"), null);
});

test("own content changes aggregate by event and circle; no-op, visibility and takedown rules", async () => {
  await claim(); await claim("other", "verified", "other-event"); await tick(); sent = [];
  await update(); await update();
  assert.equal((await items("kind = 'circle.updated'")).length, 1);
  await update({ pen: "更新", catalogImages: [{ url: "https://images.test/one.png", previewUrl: "https://images.test/one-small.png", width: 100, height: 100 }] });
  await repo.setPostEventHidden(owner, "sample", "claim", true, now);
  await repo.setPostEventHidden(owner, "sample", "claim", true, now);
  await update({ pen: "另一場" }, "other", "other-event");
  await tick(); assert.equal(sent.length, 0);
  now = nextNotificationSlot("daily", now); await tick();
  assert.equal(sent.length, 1); assert.match(sent[0].subject, /2 個社團/);
  assert.match(sent[0].text, /品書/); assert.match(sent[0].text, /公開設定/); assert.doesNotMatch(sent[0].text, /另一場/);
  await repo.takedownOverride({ eventId: "sample", circleId: "claim", reason: "private", by: "admin", now });
  await repo.takedownOverride({ eventId: "sample", circleId: "claim", reason: "private", by: "admin", now });
  await tick(); assert.equal(sent.length, 2); assert.doesNotMatch(sent[1].text, /private/);
  await update({ pen: "更新", catalogImages: [{ url: "https://images.test/one.png", previewUrl: "https://images.test/one-small.png", width: 100, height: 100 }] });
  assert.match((await items("kind = 'circle.updated' AND state = 'pending'"))[0].detail, /恢復公開/);
});

test("object key order is not a content change; array order still is", async () => {
  await claim();
  const link = { url: "https://circle.example.test", label: "網站", kind: "website", provider: "website" };
  await update({ pen: "作者", links: [link], referencedWorks: ["A", "B"] });
  await update({ referencedWorks: ["A", "B"], links: [{ provider: "website", kind: "website", label: "網站", url: "https://circle.example.test" }], pen: "作者" });
  assert.equal((await items("kind = 'circle.updated'")).length, 1);
  await update({ pen: "作者", links: [link], referencedWorks: ["B", "A"] });
  assert.equal((await items("kind = 'circle.updated'")).length, 2);
});

test("creator's direct Owner grant emits once and outbox failure rolls back the entire new workspace", async () => {
  const admin = await repo.upsertAccount(ADMIN, now);
  const input = id => ({ id, tentativeName: "自建活動", ownerEmail: ADMIN, createdByAccountId: admin,
    draftJson: JSON.stringify(createEmptyOrganizerEventDraft("自建活動")), now,
    ownerGrant: { accountId: admin, audit: { at: now, actorAccountId: admin, actorRole: "admin",
      action: "organizer_event.owner_granted_on_create", subjectType: "organizer_event", subjectId: id } } });
  assert.equal((await repo.createOrganizerCandidate(input("self-owned"))).ok, true);
  assert.equal((await repo.createOrganizerCandidate(input("self-owned"))).ok, false);
  assert.equal((await items("kind = 'member.granted'")).length, 1);
  await tick(); assert.equal(sent[0].to, ADMIN);
  await db.exec("CREATE TRIGGER account_outbox_failure BEFORE INSERT ON account_notification_items BEGIN SELECT RAISE(ABORT, 'outbox failed'); END;");
  try { await assert.rejects(repo.createOrganizerCandidate(input("rollback-owned"))); }
  finally { await db.exec("DROP TRIGGER account_outbox_failure;"); }
  assert.equal(await db.prepare("SELECT id FROM organizer_event_candidates WHERE id = 'rollback-owned'").first(), null);
  assert.equal(await db.prepare("SELECT id FROM organizer_event_grants WHERE candidate_id = 'rollback-owned'").first(), null);
});

test("off cancels digest retries; reopening starts with new events and required mail remains enabled", async () => {
  await claim(); await tick(); sent = []; await update();
  now = nextNotificationSlot("daily", now);
  await tick(async () => { throw new MailDeliveryError("mailgun_500"); });
  await save({ cadence: "off" });
  await update({ pen: "disabled" });
  assert.equal(await count("account_notification_batches", "state = 'pending'"), 0);
  await repo.setClaimStatus("claim", "revoked", now, "admin", "verified"); await tick(); assert.equal(sent.length, 1);
  await claim("new-claim"); await tick(); sent = [];
  now += 1; await save({ cadence: "hourly" }); await update({ pen: "new" }, "new-claim");
  now = nextNotificationSlot("hourly", now); await tick(); assert.equal(sent.length, 1);
  await tick(); assert.equal(sent.length, 1);
});

test("concurrent leases, frozen retry membership and necessary mail priority", async () => {
  await claim(); await Promise.all([tick(), tick()]); assert.equal(sent.length, 1);
  await update(); now = nextNotificationSlot("daily", now);
  await tick(async () => { throw new MailDeliveryError("mailgun_429"); });
  await update({ pen: "later" });
  await claim("required"); await tick(); assert.equal(sent.length, 2);
  now += 60000; await tick(); assert.equal(sent.length, 3);
  assert.equal(await count("account_notification_items", "kind = 'circle.updated' AND batch_id IS NULL"), 1);
  await claim("abandoned");
  const due = (await repo.listDueAccountNotifications(now))[0];
  const abandoned = await repo.claimAccountNotificationBatch(due.account_id, due.lane, now);
  await tick(); assert.equal(sent.length, 3);
  now += 120001; await tick(); assert.equal(sent.length, 4);
  assert.equal(await repo.readAccountNotificationBatch(abandoned, now), null);
});

test("temporary, permanent, unknown delivery and 48 hour retry termination are explicit", async () => {
  await claim();
  await tick(async () => { throw new Error("private provider body"); });
  let batch = await db.prepare("SELECT * FROM account_notification_batches").first();
  assert.equal(batch.error_code, "delivery_unknown"); assert.equal(batch.retry_at, now + 60000);
  now += 48 * 3600000; await tick(); assert.equal(sent.length, 0);
  assert.equal((await db.prepare("SELECT state FROM account_notification_batches").first()).state, "failed");
  for (const code of ["mailgun_400", "Missing Mailgun configuration.", "preview_recipient_denied"]) {
    await claim(code); await tick(async () => { throw new MailDeliveryError(code); });
  }
  assert.equal(await count("account_notification_batches", "state = 'failed'"), 4);
  assert.ok((await items()).every(item => item.state === "failed"));
});

test("application result reaches applicant without a grant and approval is one combined result", async () => {
  const admin = await repo.upsertAccount(ADMIN, now);
  const review = (id, decision) => repo.reviewOrganizerApplication({ id, decision, reason: "private note", reviewerAccountId: admin, sessionId: ADMIN, now, ipHash: null });
  await submit("no"); await review("no", "rejected"); await review("no", "rejected");
  await submit("yes"); await review("yes", "approved");
  assert.deepEqual((await items()).map(i => i.kind).sort(), ["application.approved", "application.rejected"]);
  await tick(); assert.equal(sent.length, 2);
  assert.ok(sent.some(m => /application=no/.test(m.text)));
  assert.ok(sent.every(m => !m.text.includes("private note")));
});

test("grant acceptance, role changes, self revocation and invitation-only cancellation", async () => {
  const admin = await candidate();
  const editor = await repo.upsertAccount("editor@example.test", now);
  await repo.manageOrganizerCollaborator({ role: "editor", candidateId: "candidate", email: "editor@example.test", action: "invite", actorAccountId: owner, now });
  const before = (await items()).length;
  await repo.manageOrganizerCollaborator({ role: "editor", candidateId: "candidate", email: "editor@example.test", action: "resend", actorAccountId: owner, now });
  assert.equal((await items()).length, before);
  await Promise.all([repo.acceptOrganizerInvitations({ accountId: editor, email: "editor@example.test", now }), repo.acceptOrganizerInvitations({ accountId: editor, email: "editor@example.test", now })]);
  assert.equal((await items("kind = 'member.granted'")).length, 3, "initial owner plus editor and existing owner");
  await repo.manageOrganizerOwner({ candidateId: "candidate", email: "editor@example.test", action: "invite", actorAccountId: admin, now });
  await repo.acceptOrganizerInvitations({ accountId: editor, email: "editor@example.test", now });
  assert.equal((await items("kind = 'member.granted'")).length, 5);
  const result = await repo.manageOrganizerOwner({ candidateId: "candidate", email: "editor@example.test", action: "revoke", actorAccountId: editor, now });
  assert.equal(result.ok, true);
  assert.equal((await items("kind = 'member.revoked'")).length, 2);
  await tick();
  const own = sent.filter(mail => mail.to === "editor@example.test");
  assert.equal(own.length, 1, "lost grant cancels old grants, but own revocation remains");
  assert.match(own[0].subject, /曾被移除/); assert.doesNotMatch(own[0].text, /candidate=/);
  await repo.manageOrganizerCollaborator({ role: "editor", candidateId: "candidate", email: "pending@example.test", action: "invite", actorAccountId: owner, now });
  await repo.manageOrganizerCollaborator({ role: "editor", candidateId: "candidate", email: "pending@example.test", action: "revoke", actorAccountId: owner, now });
  assert.equal((await items("kind = 'member.revoked'")).length, 2);
});

test("review results and actual published gate; latest result cancels obsolete progress", async () => {
  const { admin, publication } = await submitted();
  const input = { candidateId: "candidate", expectedVersion: 1, decision: "approve", actorAccountId: admin, publication, now };
  assert.equal((await repo.reviewOrganizerCandidate(input)).ok, true); await repo.reviewOrganizerCandidate(input);
  assert.equal((await items("kind = 'review.approved'")).length, 1);
  const lease = await repo.claimOrganizerPublicationLease({ jobId: publication.jobId, now, ttlMs: 60000 });
  const job = await repo.getOrganizerPublicationJob(publication.jobId);
  assert.equal(await repo.updateOrganizerPublicationJob({ jobId: job.id, leaseToken: lease.token, expectedStep: job.step, nextStep: "completed", status: "published", now }), false);
  assert.equal(await repo.updateOrganizerPublicationJob({ jobId: job.id, leaseToken: lease.token, expectedStep: job.step, nextStep: "verifying_production", status: "publishing", now }), true);
  assert.equal(await repo.updateOrganizerPublicationJob({ jobId: job.id, leaseToken: lease.token, expectedStep: "verifying_production", nextStep: "completed", status: "published", productionVerified: true, now }), true);
  await tick();
  assert.equal(sent.filter(m => m.subject.includes("審核通過")).length, 0);
  assert.equal(sent.filter(m => m.subject.includes("已公開")).length, 1);
  assert.match(sent.find(m => m.subject.includes("已公開")).text, /\/events\/candidate\//);
});

test("failed and changes-requested transitions reach current owners only", async () => {
  const { admin, publication } = await submitted();
  await repo.reviewOrganizerCandidate({ candidateId: "candidate", expectedVersion: 1, decision: "approve", actorAccountId: admin, publication, now });
  const lease = await repo.claimOrganizerPublicationLease({ jobId: publication.jobId, now, ttlMs: 60000 });
  const job = await repo.getOrganizerPublicationJob(publication.jobId);
  const input = { jobId: job.id, leaseToken: lease.token, expectedStep: job.step, nextStep: job.step, status: "failed", failureCode: "test", error: "private error", now };
  assert.equal(await repo.updateOrganizerPublicationJob(input), true); assert.equal(await repo.updateOrganizerPublicationJob(input), false);
  assert.equal((await items("kind = 'publication.failed'")).length, 1);
  const second = await submitted("second");
  await repo.reviewOrganizerCandidate({ candidateId: "second", expectedVersion: 1, decision: "changes_requested", actorAccountId: second.admin, note: "private", now });
  await tick();
  assert.ok(sent.some(m => m.subject.includes("需要修正")));
  assert.ok(sent.some(m => m.subject.includes("發布未完成")));
  assert.ok(sent.every(m => m.to === "owner@example.test" && !m.text.includes("private")));
});

test("removed relationships, disabled accounts, deletion and retention remove deliverability", async () => {
  await claim(); await update();
  await repo.setClaimStatus("claim", "revoked", now, "admin", "verified");
  now = nextNotificationSlot("daily", now); await tick();
  assert.equal(sent.length, 1); assert.equal(await count("account_notification_items", "kind = 'circle.updated' AND state = 'cancelled'"), 1);
  await claim("disabled"); await repo.disableAccount("owner@example.test", now); await tick(); assert.equal(sent.length, 1);
  const rows = await items(); assert.ok(rows.every(i => i.state !== "pending"));
  const purge = await purgeExpiredRecords(db, now + 31 * 86400000);
  assert.ok(purge.deleted.account_notification_items > 0); assert.equal((await items()).length, 0);
});

test("Admin toggle changes warm producer and delivery; reopening skips old events and preserves personal preferences", async () => {
  const adminCookie = `${SESSION_COOKIE}=${ADMIN}.${await hmacSign("secret", ADMIN)}`;
  async function toggle(enabled) {
    const current = await repo.getSiteSettings();
    const response = await handlers.adminUpdateSiteSettings(new Request("https://map.kotoban.top/api/admin/site-settings", {
      method: "PUT", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: current.updatedAt,
        settings: { organizerApplicationMode: current.organizerApplicationMode, organizerAllowedEmails: current.organizerAllowedEmails,
          accountNotificationsEnabled: enabled, adminReviewNotificationsEnabled: current.adminReviewNotificationsEnabled, publicationEnabled: current.publicationEnabled,
          contactUrl: current.contactUrl, claimReviewNotice: current.claimReviewNotice } }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
  }
  // The existing instance, writer and notification batches must all observe each new setting.
  await claim();
  const preferences = await prefs();
  now += 100; await toggle(false);
  await claim("during-pause"); await tick();
  assert.equal(await count("account_notification_items"), 1);
  assert.equal(sent.length, 0);
  now += 100; await toggle(true);
  assert.equal((await repo.getSiteSettings()).accountNotificationsSince, now);
  assert.deepEqual(await prefs(), preferences);
  await tick();
  assert.equal(sent.length, 0);
  assert.equal(await count("account_notification_items", "state = 'cancelled'"), 1);
  now += 2;
  await claim("sink");
  await tick(mail => sendPortalMail({ PREVIEW_MAIL_SINK: "d1", PREVIEW_TEST_RECIPIENTS: "owner@example.test" }, mail, async m => { sent.push(m); }));
  assert.equal(sent.length, 1);
  await claim("denied"); await tick(mail => sendPortalMail({ PREVIEW_MAIL_SINK: "d1" }, mail, async () => { throw new Error("must not store"); }));
  assert.equal(await count("account_notification_batches", "error_code = 'preview_recipient_denied' AND state = 'failed'"), 1);
});

test("letter HTML escapes names, text links match and login destinations use a strict allowlist", async () => {
  await claim(); const item = (await items())[0];
  const letter = accountNotificationLetter("https://map.kotoban.top", [{ ...item, name: '<ScRiPt>"&' }]);
  assert.doesNotMatch(letter.html, /<script\b/i); assert.match(letter.text, /\/circle\?event=sample&circle=claim/);
  const parameters = notificationParameters({ candidate: "right", application: "request", section: "review", notifications: "1", redirect: "https://evil.test", login: "secret", event: "wrong" }, "organizer");
  assert.equal(parameters.toString(), "candidate=right&application=request&section=review&notifications=1");
  assert.equal(notificationParameters({ candidate: "//evil.test", section: "javascript:alert(1)" }, "organizer").toString(), "");
  assert.throws(() => accountNotificationLetter("https://evil.test/path", [item]));
});

test("changing frequency fences an in-flight digest without losing its frozen items", async () => {
  await claim(); await tick(); sent = []; await update();
  now = nextNotificationSlot("daily", now);
  const old = await repo.claimAccountNotificationBatch(owner, "digest", now);
  assert.ok(old);
  await save({ cadence: "hourly" });
  assert.equal(await repo.readAccountNotificationBatch(old, now), null);
  await repo.finishAccountNotificationBatch(old, "cancelled", now);
  assert.equal(await count("account_notification_items", "kind = 'circle.updated' AND state = 'pending'"), 1);
  now = nextNotificationSlot("hourly", now); await tick();
  assert.equal(sent.length, 1);
});

test("scheduled account delivery is independent of publication and admin digests; production logs are minimal", async t => {
  now = Date.now() - 1000;
  await claim();
  const logs = [];
  t.mock.method(console, "log", value => logs.push(value));
  t.mock.method(console, "error", value => logs.push(value));
  const failingPublicationDB = { prepare(sql) {
    if (/^(SELECT|UPDATE)[\s\S]*organizer_publication_jobs/.test(sql.trim())) throw new Error("publication unavailable");
    return db.prepare(sql);
  }, batch: statements => db.batch(statements) };
  await notificationWorker.scheduled({}, { DB: failingPublicationDB, ORGANIZER_PUBLICATION_MODE: "fake", PREVIEW_MAIL_SINK: "d1",
    NOTIFICATION_ORIGIN: "https://map.kotoban.top", PREVIEW_TEST_RECIPIENTS: "owner@example.test" });
  assert.equal(await count("account_notification_batches", "state = 'accepted'"), 1);
  assert.match((await repo.latestPreviewMail("owner@example.test")).subject, /認領通過/);
  assert.doesNotMatch(logs.join(""), /owner@example|同名社團|publication unavailable/);
  assert.match(logs.join(""), /publication.tick_failed/);
});

test("account deletion removes preferences, queued items and leased batches permanently", async () => {
  await claim(); await save({ cadence: "hourly" });
  const due = (await repo.listDueAccountNotifications(now))[0];
  const batch = await repo.claimAccountNotificationBatch(due.account_id, due.lane, now);
  assert.ok(batch);
  await repo.beginAccountDeletion({ accountId: owner, email: "owner@example.test", now });
  await repo.deleteAccount({ accountId: owner, email: "owner@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "old-digest", now });
  for (const table of ["account_notification_preferences", "account_notification_items", "account_notification_batches"]) assert.equal(await count(table), 0);
  assert.equal(await repo.readAccountNotificationBatch(batch, now), null);
  await tick(); assert.equal(sent.length, 0);
});

