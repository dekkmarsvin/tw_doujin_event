import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { LOGIN_RATE_LIMIT_WINDOW_MS, RETENTION_WINDOWS, purgeExpiredRecords } = await environment.runner.import("/db/retention-purge.ts");
const { OVERRIDE_RETENTION_PURGE_AFTER_MS } = await environment.runner.import("/app/circle-overrides.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  // UNTOUCHED is never handed to the repository: it stands in for a database
  // no Function has reached yet, which is what preview looks like on day one.
  d1Databases: { DB: "retention-test", UNTOUCHED: "retention-untouched" },
}));
const database = await miniflare.getD1Database("DB");
const untouched = await miniflare.getD1Database("UNTOUCHED");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_786_500_000_000;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
});

const countIn = async (table) => {
  const row = await database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first();
  return row.total;
};

test("deletes login tokens older than the retention window", async () => {
  await repository.createLoginToken({ tokenHash: "old", email: "a@example.test", now: NOW - 25 * HOUR, expiresAt: NOW - 25 * HOUR + 900_000, ipHash: "ip" });
  await repository.createLoginToken({ tokenHash: "fresh", email: "a@example.test", now: NOW - 2 * HOUR, expiresAt: NOW - 2 * HOUR + 900_000, ipHash: "ip" });

  const summary = await purgeExpiredRecords(database, NOW);

  assert.equal(summary.deleted.login_tokens, 1);
  const remaining = await database.prepare("SELECT token_hash FROM login_tokens").all();
  assert.deepEqual(remaining.results.map((row) => row.token_hash), ["fresh"]);
});

test("leaves the rate limiter's counting window intact", async () => {
  // A consumed token still holds a slot: five requests in an hour is five
  // rows, whether or not the links were clicked. Purging on use would hand the
  // sender a fresh quota, which is why retention is measured from created_at.
  for (let index = 0; index < 5; index += 1) {
    await repository.createLoginToken({ tokenHash: `t${index}`, email: "b@example.test", now: NOW - 30 * 60 * 1000, expiresAt: NOW, ipHash: "ip-b" });
  }
  await repository.consumeLoginToken("t0", NOW - 29 * 60 * 1000);

  await purgeExpiredRecords(database, NOW);

  assert.equal(await repository.countLoginTokensSince("email", "b@example.test", NOW - LOGIN_RATE_LIMIT_WINDOW_MS), 5);
  assert.equal(await repository.countLoginTokensSince("request_ip_hash", "ip-b", NOW - LOGIN_RATE_LIMIT_WINDOW_MS), 5);
});

test("refuses a retention window shorter than the rate-limit window", async () => {
  await assert.rejects(
    () => purgeExpiredRecords(database, NOW, { ...RETENTION_WINDOWS, loginTokens: 30 * 60 * 1000 }),
    /rate-limit window/,
  );
});

test("deletes sessions past expiry or revocation, keeps live ones", async () => {
  const account = await repository.upsertAccount("c@example.test", NOW - 40 * DAY);
  await repository.createSession(account, NOW - 40 * DAY, NOW - 10 * DAY, "long-expired");
  await repository.createSession(account, NOW - 31 * DAY, NOW - 1 * DAY, "recently-expired");
  await repository.createSession(account, NOW - 20 * DAY, NOW + 10 * DAY, "revoked-long-ago");
  await repository.createSession(account, NOW - 1 * DAY, NOW + 29 * DAY, "live");
  await repository.revokeSession("revoked-long-ago", NOW - 8 * DAY);

  const summary = await purgeExpiredRecords(database, NOW);

  assert.equal(summary.deleted.sessions, 2);
  const remaining = await database.prepare("SELECT id FROM sessions ORDER BY id").all();
  assert.deepEqual(remaining.results.map((row) => row.id), ["live", "recently-expired"]);
});

test("deletes preview mail older than a week", async () => {
  await repository.storePreviewMail({ email: "d@example.test", subject: "old", text: "link", now: NOW - 8 * DAY });
  await repository.storePreviewMail({ email: "d@example.test", subject: "recent", text: "link", now: NOW - 6 * DAY });

  const summary = await purgeExpiredRecords(database, NOW);

  assert.equal(summary.deleted.preview_mail_sink, 1);
  assert.equal(await countIn("preview_mail_sink"), 1);
});

test("clears audit IP hashes after 90 days without deleting the audit rows", async () => {
  await repository.writeAudit({ at: NOW - 91 * DAY, actorRole: "system", action: "old", subjectType: "test", subjectId: "old", ipHash: "old-ip" });
  await repository.writeAudit({ at: NOW - 89 * DAY, actorRole: "system", action: "fresh", subjectType: "test", subjectId: "fresh", ipHash: "fresh-ip" });

  const summary = await purgeExpiredRecords(database, NOW);

  assert.equal(summary.anonymized.audit_ip_hashes, 1);
  const rows = await database.prepare(`SELECT action, ip_hash FROM audit_log WHERE action IN ('old', 'fresh') ORDER BY action`).all();
  assert.deepEqual(rows.results, [
    { action: "fresh", ip_hash: "fresh-ip" },
    { action: "old", ip_hash: null },
  ]);
});

test("records every run in the audit log, including the empty ones", async () => {
  await purgeExpiredRecords(database, NOW);

  const entry = await database.prepare("SELECT actor_role, action, subject_type, subject_id, detail_json, at FROM audit_log").first();
  assert.equal(entry.action, "retention.purged");
  assert.equal(entry.actor_role, "system");
  assert.equal(entry.subject_type, "retention");
  assert.equal(entry.at, NOW);
  assert.deepEqual(JSON.parse(entry.detail_json).deleted, {
    login_tokens: 0,
    sessions: 0,
    preview_mail_sink: 0,
    circle_overrides: 0,
    map_drafts: 0,
    map_draft_revisions: 0,
    map_raw_objects: 0,
  });
});

/** The event ended long enough ago that a `purge` row written then is now due. */
const EVENT_ENDED_AT = NOW - OVERRIDE_RETENTION_PURGE_AFTER_MS - DAY;
const DATA_UPDATED_AT = "2026-08-13T00:00:00.000Z";

async function writeOverride(circleId, { choice, expiresAt }) {
  // Publication needs an owner, so the fixture carries one: content that no
  // account holds is withheld from the document regardless of its deadline.
  const accountId = await repository.upsertAccount(`${circleId}@example.com`, NOW - DAY);
  await repository.createClaim({
    id: `claim-${circleId}`, accountId, eventId: "ff47", circleId,
    circleNameKey: circleId, circleNameAtClaim: circleId, sourceRowAtClaim: 1,
    status: "verified", method: "admin", targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null,
    evidenceUrl: null, evidenceNote: null, now: NOW - DAY,
  });
  await repository.putOverride({
    eventId: "ff47", circleId, fieldsJson: JSON.stringify({ saleInfo: `${circleId} 的販售資訊` }),
    updatedBy: accountId, now: NOW - DAY,
    ...(choice ? { retention: { choice, expiresAt } } : {}),
  });
}

test("deletes the rows whose own deadline has passed, and only those", async () => {
  await writeOverride("ff47-due", { choice: "purge", expiresAt: EVENT_ENDED_AT + OVERRIDE_RETENTION_PURGE_AFTER_MS });
  await writeOverride("ff47-not-yet", { choice: "purge", expiresAt: NOW + DAY });
  await writeOverride("ff47-keeps", { choice: "keep", expiresAt: null });
  await writeOverride("ff47-unanswered", {});

  const summary = await purgeExpiredRecords(database, NOW);

  assert.equal(summary.deleted.circle_overrides, 1);
  const remaining = await database.prepare("SELECT circle_id FROM circle_overrides ORDER BY circle_id").all();
  assert.deepEqual(
    remaining.results.map((row) => row.circle_id),
    ["ff47-keeps", "ff47-not-yet", "ff47-unanswered"],
    "a row that never answered must not be treated as having chosen deletion",
  );

  // Deleted, not flagged: nothing of the row survives to be un-deleted later.
  const columns = await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides WHERE circle_id = ?1").bind("ff47-due").first();
  assert.equal(columns.total, 0);
});

test("deletes published and abandoned draft thumbnail bytes before removing an expired override", async () => {
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-hosted", fieldsJson: JSON.stringify({ saleInfo: "內容" }),
    updatedBy: "account-1", now: NOW - DAY,
    retention: { choice: "purge", expiresAt: NOW - 1 },
    hostedThumbnailKey: "events/ff47/circles/ff47-hosted/hash.webp",
  });
  const calls = [];
  const listPrefixes = [];
  const objectKeys = [
    "events/ff47/circles/ff47-hosted/hash.webp",
    "events/ff47/circles/ff47-hosted/draft.png",
    "events/ff47/circles/another/keep.png",
  ];
  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, {
    list: async ({ prefix } = {}) => {
      listPrefixes.push(prefix);
      return {
        objects: objectKeys.filter((key) => !prefix || key.startsWith(prefix)).map((key) => ({ key })),
        truncated: false,
      };
    },
    delete: async (keys) => {
      calls.push(keys);
      const row = await database.prepare("SELECT circle_id FROM circle_overrides WHERE circle_id = 'ff47-hosted'").first();
      assert.ok(row, "R2 bytes are deleted while the row still makes the operation retryable");
    },
  });
  assert.deepEqual(calls, [[
    "events/ff47/circles/ff47-hosted/hash.webp",
    "events/ff47/circles/ff47-hosted/draft.png",
  ]]);
  assert.deepEqual(listPrefixes, ["events/ff47/circles/"], "R2 is listed once per due event, not once per circle");
  assert.equal(await database.prepare("SELECT circle_id FROM circle_overrides WHERE circle_id = 'ff47-hosted'").first(), null);
});

test("the published document loses the purged circle and gets a new revision", async () => {
  await writeOverride("ff47-due", { choice: "purge", expiresAt: NOW - DAY });
  await writeOverride("ff47-keeps", { choice: "keep", expiresAt: null });
  const before = await repository.rebuildOverridesDoc("ff47", DATA_UPDATED_AT, NOW - HOUR, "during");
  assert.deepEqual(JSON.parse(before.json).overrides.map((override) => override.circleId).sort(), ["ff47-due", "ff47-keeps"]);

  await purgeExpiredRecords(database, NOW);

  const after = await repository.getOverridesDoc("ff47");
  const document = JSON.parse(after.json);
  assert.deepEqual(document.overrides.map((override) => override.circleId), ["ff47-keeps"]);
  assert.doesNotMatch(after.json, /ff47-due/, "the deleted content must not survive inside the published document");
  // The revision is in the ETag; without a bump caches keep serving what was
  // deleted. The phase and generatedAt stay as the last rebuild left them.
  assert.equal(document.revision, before.revision + 1);
  assert.equal(document.generatedAt, DATA_UPDATED_AT);
  assert.equal(after.phase, before.phase);
});

test("a purge records that it happened without recording what it deleted", async () => {
  await writeOverride("ff47-due", { choice: "purge", expiresAt: NOW - DAY });

  await purgeExpiredRecords(database, NOW);

  const entry = await database.prepare("SELECT actor_role, subject_type, subject_id, detail_json FROM audit_log WHERE action = 'override.purged'").first();
  assert.equal(entry.actor_role, "system");
  assert.equal(entry.subject_type, "override");
  assert.equal(entry.subject_id, "ff47-due");
  assert.deepEqual(JSON.parse(entry.detail_json), { eventId: "ff47" });
  assert.doesNotMatch(entry.detail_json, /販售資訊/, "the audit trail keeps the deletion, never the deleted content");

  const summary = await database.prepare("SELECT detail_json FROM audit_log WHERE action = 'retention.purged'").first();
  assert.equal(JSON.parse(summary.detail_json).deleted.circle_overrides, 1);
});

test("never creates a table it does not find", async () => {
  const summary = await purgeExpiredRecords(untouched, NOW);

  assert.deepEqual(summary.deleted, {
    login_tokens: 0,
    sessions: 0,
    preview_mail_sink: 0,
    circle_overrides: 0,
    map_drafts: 0,
    map_draft_revisions: 0,
    map_raw_objects: 0,
  });
  assert.deepEqual(summary.skipped.sort(), [
    "audit_log",
    "circle_overrides",
    "login_tokens",
    "map_draft_files",
    "map_draft_reviews",
    "map_draft_revisions",
    "map_drafts",
    "overrides_doc",
    "preview_mail_sink",
    "sessions",
  ]);
  const tables = await untouched.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  assert.deepEqual(tables.results, [], "the purge must not be able to create the database it purges");
});
