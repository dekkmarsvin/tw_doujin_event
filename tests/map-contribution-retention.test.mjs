import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { purgeExpiredRecords, RETENTION_WINDOWS, MAP_RETENTION_BATCH_SIZE } = await environment.runner.import("/db/retention-purge.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "map-contribution-retention-test" },
}));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_786_500_000_000;
let accountId;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
  accountId = await repository.upsertAccount("mapper@example.test", NOW - 200 * DAY);
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW - 200 * DAY });
});

async function draft(id, at) {
  await repository.createMapDraft({
    id, eventId: "ff47", periodKey: id, venueSpaceId: "hall", ownerAccountId: accountId,
    contentJson: JSON.stringify({ id }), now: at,
  });
}

async function raw(id, draftId, at) {
  await repository.addMapDraftFile({
    id, draftId, eventId: "ff47", revision: 1, objectKey: `map-contributions/ff47/${draftId}/${id}.png`,
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
    sha256: id.padEnd(64, "a").slice(0, 64), mime: "image/png", sizeBytes: 10,
    width: 1, height: 1, pageCount: null, uploadedBy: accountId, now: at,
  });
}

const submitDraft = (input) => repository.submitMapDraft({ eventId: "ff47", ...input });

/** `at` matters: a comment refreshes the draft's activity, so seeding one at
 * "now" would pull an otherwise-abandoned draft back out of the purge window. */
const comment = (draftId, body, targetKind, targetRef, at) => repository.addMapDraftComment({
  draftId, eventId: "ff47", authorAccountId: accountId, authorRole: "map_contributor",
  targetKind, targetRef, body, now: at,
});

const commentCount = async (draftId) =>
  (await database.prepare("SELECT COUNT(*) AS total FROM map_draft_comments WHERE draft_id = ?1").bind(draftId).first()).total;

test("retention removes abandoned content, preserves submitted work, and is idempotent", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  const oldDecision = NOW - RETENTION_WINDOWS.mapDecisionRaw - DAY;
  await draft("never-submitted", inactive);
  await raw("raw-never", "never-submitted", inactive);

  await draft("changes", inactive - 2);
  await raw("raw-changes", "changes", inactive - 2);
  await submitDraft({ draftId: "changes", ownerAccountId: accountId, expectedRevision: 1, now: inactive - 1 });
  await repository.transitionMapDraft({
    draftId: "changes", expectedRevision: 1, toStatus: "changes_requested",
    actorAccountId: "admin-1", actorRole: "admin", note: "fix", now: inactive,
  });

  await draft("submitted", inactive - 2);
  await submitDraft({ draftId: "submitted", ownerAccountId: accountId, expectedRevision: 1, now: inactive });

  await draft("approved", oldDecision - 2);
  await raw("raw-approved", "approved", oldDecision - 2);
  await submitDraft({ draftId: "approved", ownerAccountId: accountId, expectedRevision: 1, now: oldDecision - 1 });
  await repository.approveMapDraft({
    draftId: "approved", expectedRevision: 1, actorAccountId: "admin-1", now: oldDecision - 2,
  });
  await repository.createMapDraft({
    id: "replacement", eventId: "ff47", periodKey: "approved", venueSpaceId: "hall", ownerAccountId: accountId,
    contentJson: JSON.stringify({ id: "replacement" }), now: oldDecision - 1,
  });
  await raw("raw-replacement", "replacement", oldDecision - 1);
  await submitDraft({ draftId: "replacement", ownerAccountId: accountId, expectedRevision: 1, now: oldDecision - 1 });
  await repository.approveMapDraft({
    draftId: "replacement", expectedRevision: 1, replacementDraftId: "approved", actorAccountId: "admin-1", now: oldDecision,
  });
  assert.equal((await repository.getMapDraft("approved")).status, "withdrawn");

  // Discussion on a draft that is about to be deleted, and on one about to be
  // anonymized: the two retention actions treat it differently.
  await comment("never-submitted", "整份草稿的位置都要重畫。", null, null, inactive);
  await comment("changes", "B 排第 7 格位置錯了。", "slot", "B07", inactive);

  const deletedKeys = [];
  const store = { delete: async (keys) => deletedKeys.push(...(Array.isArray(keys) ? keys : [keys])) };
  const first = await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, store);
  assert.equal(first.deleted.map_drafts, 1);
  assert.equal(first.deleted.map_draft_revisions, 2);
  assert.equal(first.deleted.map_raw_objects, 4);
  assert.equal(first.anonymized.map_drafts, 1);
  assert.equal(await repository.getMapDraft("never-submitted"), null);
  assert.equal((await repository.getMapDraft("submitted")).status, "submitted");

  const changes = await database.prepare("SELECT owner_account_id, status FROM map_drafts WHERE id = 'changes'").first();
  assert.deepEqual(changes, { owner_account_id: "[shredded]", status: "changes_requested" });
  assert.equal((await database.prepare("SELECT actor_account_id FROM map_draft_reviews WHERE draft_id = 'changes'").first()).actor_account_id, null);
  assert.equal(await commentCount("never-submitted"), 0, "a deleted draft takes its discussion with it");
  const anonymized = await database.prepare("SELECT author_account_id, target_kind, target_ref, body FROM map_draft_comments WHERE draft_id = 'changes'").first();
  assert.deepEqual(anonymized, { author_account_id: null, target_kind: "slot", target_ref: "B07", body: "B 排第 7 格位置錯了。" },
    "anonymizing drops the author the way it drops a review's, and keeps what was asked for");
  const withdrawn = await repository.getMapDraftFile("raw-approved");
  assert.equal(withdrawn.object_key, null);
  assert.equal(withdrawn.review_result, "approved_official_source");
  assert.equal((await repository.listStaleSubmittedMapDrafts(NOW - 30 * DAY)).some(({ id }) => id === "submitted"), true);
  assert.equal(new Set(deletedKeys).size, 4);

  const second = await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, store);
  assert.equal(second.deleted.map_drafts, 0);
  assert.equal(second.deleted.map_draft_revisions, 0);
  assert.equal(second.deleted.map_raw_objects, 0);
  const actions = await database.prepare("SELECT action, subject_id FROM audit_log WHERE action LIKE 'map_draft.%' ORDER BY action, subject_id").all();
  assert.deepEqual(actions.results, [
    { action: "map_draft.content_purged", subject_id: "changes" },
    { action: "map_draft.purged", subject_id: "never-submitted" },
    { action: "map_draft.raw_purged", subject_id: "approved" },
    { action: "map_draft.raw_purged", subject_id: "replacement" },
  ]);
});

test("retention fails before deleting D1 metadata when private storage is unavailable", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  await draft("private", inactive);
  await raw("raw-private", "private", inactive);
  await assert.rejects(() => purgeExpiredRecords(database, NOW, RETENTION_WINDOWS), /Private map evidence bucket/);
  assert.equal((await repository.getMapDraft("private")).status, "draft");
  assert.notEqual((await repository.getMapDraftFile("raw-private")).object_key, null);
  assert.equal((await database.prepare("SELECT retention_action FROM map_drafts WHERE id = 'private'").first()).retention_action, null,
    "a missing binding must fail before claiming and locking the draft");
  const deleted = [];
  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, { delete: async (keys) => deleted.push(...(Array.isArray(keys) ? keys : [keys])) });
  assert.equal(await repository.getMapDraft("private"), null, "a retry resumes the claimed cleanup");
  assert.deepEqual(deleted, ["map-contributions/ff47/private/raw-private.png"]);
});

test("R2 failures resume the same bounded claims without expanding the locked set", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  for (let index = 0; index < MAP_RETENTION_BATCH_SIZE + 1; index += 1) {
    const id = `retry-${index}`;
    await draft(id, inactive - index);
    await raw(`raw-${id}`, id, inactive - index);
  }
  const unavailable = { delete: async () => { throw new Error("R2 unavailable"); } };
  await assert.rejects(() => purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, unavailable), /R2 unavailable/);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_drafts WHERE retention_action IS NOT NULL").first()).total, MAP_RETENTION_BATCH_SIZE);
  await assert.rejects(() => purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, unavailable), /R2 unavailable/);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_drafts WHERE retention_action IS NOT NULL").first()).total, MAP_RETENTION_BATCH_SIZE,
    "a retry must not claim another batch while prior work is blocked");

  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, { delete: async () => {} });
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_drafts WHERE id LIKE 'retry-%'").first()).total, 1);
  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, { delete: async () => {} });
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_drafts WHERE id LIKE 'retry-%'").first()).total, 0);
});

test("account deletion does not exempt requested changes from the 180-day cleanup", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  await draft("deleted-owner-changes", inactive - 2);
  await raw("raw-deleted-owner", "deleted-owner-changes", inactive - 2);
  await submitDraft({ draftId: "deleted-owner-changes", ownerAccountId: accountId, expectedRevision: 1, now: inactive - 1 });
  await repository.transitionMapDraft({
    draftId: "deleted-owner-changes", expectedRevision: 1, toStatus: "changes_requested",
    actorAccountId: "admin-1", actorRole: "admin", now: inactive,
  });
  await repository.beginAccountDeletion({ accountId, email: "mapper@example.test", now: inactive + 1 });
  await repository.deleteAccount({
    accountId, email: "mapper@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now: inactive + 1,
  });
  assert.equal((await database.prepare("SELECT owner_account_id FROM map_drafts WHERE id = 'deleted-owner-changes'").first()).owner_account_id, "[shredded]");
  const deleted = [];
  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, { delete: async (keys) => deleted.push(...(Array.isArray(keys) ? keys : [keys])) });
  assert.deepEqual(deleted, ["map-contributions/ff47/deleted-owner-changes/raw-deleted-owner.png"]);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_draft_revisions WHERE draft_id = 'deleted-owner-changes'").first()).total, 0);
  assert.equal((await database.prepare("SELECT retention_action FROM map_drafts WHERE id = 'deleted-owner-changes'").first()).retention_action, null);
});

test("deleting an account unnames its comments and takes the unsubmitted draft's thread with it", async () => {
  await draft("still-a-draft", NOW - DAY);
  await comment("still-a-draft", "這格代碼可能打錯。", "slot", "A01", NOW - DAY);

  await draft("under-review", NOW - 3 * DAY);
  await submitDraft({ draftId: "under-review", ownerAccountId: accountId, expectedRevision: 1, now: NOW - 2 * DAY });
  await comment("under-review", "A 排整排往右偏了一格。", "slot", "A05", NOW - DAY);

  await repository.beginAccountDeletion({ accountId, email: "mapper@example.test", now: NOW });
  await repository.deleteAccount({
    accountId, email: "mapper@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now: NOW,
  });

  assert.equal(await commentCount("still-a-draft"), 0, "an unsubmitted draft is deleted outright, thread included");
  const kept = await database.prepare("SELECT author_account_id, target_kind, target_ref, body FROM map_draft_comments WHERE draft_id = 'under-review'").first();
  assert.deepEqual(kept, { author_account_id: null, target_kind: "slot", target_ref: "A05", body: "A 排整排往右偏了一格。" },
    "a submitted draft keeps the request, with nobody named against it");
});

test("a comment is stamped with the revision it was written about and never moves", async () => {
  await draft("moving", NOW - 4 * DAY);
  const id = await comment("moving", "第一版就有問題。", null, null, NOW - 4 * DAY);
  assert.ok(id);
  await repository.writeMapDraftRevision({
    draftId: "moving", eventId: "ff47", ownerAccountId: accountId, expectedRevision: 1,
    contentJson: JSON.stringify({ id: "moving", pass: 2 }), now: NOW - 3 * DAY,
  });
  const later = await comment("moving", "第二版已修好。", null, null, NOW - 2 * DAY);
  assert.ok(later);

  const thread = await repository.listMapDraftComments("moving");
  assert.deepEqual(thread.map(({ revision, body }) => ({ revision, body })), [
    { revision: 1, body: "第一版就有問題。" },
    { revision: 2, body: "第二版已修好。" },
  ], "the first comment stays about revision 1 after the draft moves on");
  assert.equal(Object.hasOwn(thread[0], "author_account_id"), false, "readers see a role, never an account");
});

function countedDatabase(inner) {
  let calls = 0;
  const wrap = (statement) => ({
    native: statement,
    bind(...values) { return wrap(statement.bind(...values)); },
    async run() { calls += 1; return statement.run(); },
    async all() { calls += 1; return statement.all(); },
    async first() { calls += 1; return statement.first(); },
  });
  return {
    database: {
      prepare(sql) { return wrap(inner.prepare(sql)); },
      async batch(statements) { calls += 1; return inner.batch(statements.map(({ native }) => native)); },
    },
    calls: () => calls,
  };
}

test("retention stays within the Workers Free D1 invocation budget", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  await database.prepare(
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 11)
     INSERT INTO map_drafts (id, event_id, period_key, venue_space_id, owner_account_id, status, current_revision, created_at, updated_at, last_activity_at)
     SELECT 'bulk-' || printf('%03d', n), 'ff47', 'day-1', 'hall', ?1, 'draft', 1, ?2, ?2, ?2 FROM seq`,
  ).bind(accountId, inactive).run();
  await database.prepare(
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 11)
     INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
     SELECT 'bulk-rev-' || printf('%03d', n), 'bulk-' || printf('%03d', n), 1, '{}', ?1, ?2 FROM seq`,
  ).bind(accountId, inactive).run();
  const counted = countedDatabase(database);
  const first = await purgeExpiredRecords(counted.database, NOW, RETENTION_WINDOWS, undefined, { delete: async () => {} });
  assert.equal(first.deleted.map_drafts, MAP_RETENTION_BATCH_SIZE);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_drafts WHERE id LIKE 'bulk-%'").first()).total, 11 - MAP_RETENTION_BATCH_SIZE);
  assert.ok(counted.calls() <= 50, `expected at most 50 D1 calls, saw ${counted.calls()}`);
});
