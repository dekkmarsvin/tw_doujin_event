import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "map-contribution-repository-test" },
}));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const NOW = 1_786_500_000_000;
let contributorId;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
  contributorId = await repository.upsertAccount("mapper@example.test", NOW);
});

const createDraft = (id, ownerAccountId = contributorId, periodKey = "day-1") => repository.createMapDraft({
  id,
  eventId: "ff47",
  periodKey,
  venueSpaceId: "zhengyan-exhibition-area",
  ownerAccountId,
  contentJson: JSON.stringify({ markers: [] }),
  now: NOW,
});

const addEvidence = (draftId, revision = 1) => repository.addMapDraftFile({
  id: `file-${draftId}-r${revision}`, draftId, eventId: "ff47", revision,
  objectKey: `map-contributions/ff47/${draftId}/source.png`,
  sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
  sha256: "a".repeat(64), mime: "image/png", sizeBytes: 10,
  width: 1, height: 1, pageCount: null, uploadedBy: contributorId, now: NOW,
});

const writeRevision = (input) => repository.writeMapDraftRevision({ eventId: "ff47", ...input });
const submitDraft = (input) => repository.submitMapDraft({ eventId: "ff47", ...input });

test("only an active grant can create, revise or submit a private draft", async () => {
  assert.equal(await createDraft("draft-before-grant"), false);
  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW }), "granted");
  assert.equal(await repository.hasActiveMapContributor(contributorId), true);
  assert.equal(await createDraft("draft-a"), true);

  assert.equal(await writeRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1,
    contentJson: JSON.stringify({ markers: ["A01"] }), now: NOW + 1,
  }), 2);
  assert.equal(await writeRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1,
    contentJson: JSON.stringify({ markers: ["stale"] }), now: NOW + 2,
  }), null);

  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "revoke", by: "admin@example.test", now: NOW + 3 }), "revoked");
  assert.equal(await repository.hasActiveMapContributor(contributorId), false);
  assert.equal(await writeRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2,
    contentJson: JSON.stringify({ markers: ["blocked"] }), now: NOW + 4,
  }), null);
  assert.equal(await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 5 }), false);

  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW + 6 }), "granted");
  assert.equal(await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 7 }), true);
  const draft = await repository.getMapDraft("draft-a");
  assert.equal(draft.status, "submitted");
  assert.equal(draft.current_revision, 2);
  assert.deepEqual(JSON.parse(draft.content_json), { markers: ["A01"] });
});

test("parallel drafts coexist but a second approval requires explicit replacement", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  assert.equal(await createDraft("draft-a"), true);
  assert.equal(await createDraft("draft-b"), true);
  await addEvidence("draft-a");
  await addEvidence("draft-b");
  assert.equal(await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 }), true);
  assert.equal(await submitDraft({ draftId: "draft-b", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 2 }), true);
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 3,
  }), { ok: true, replacedDraftId: null });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-b", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 5,
  }), { ok: false, reason: "replacement_required", activeDraftId: "draft-a" });
  assert.equal((await repository.getMapDraft("draft-b")).status, "submitted");
});

test("legacy alias normalization fails closed when two active rows already conflict", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("legacy-active", contributorId, "day-1");
  await createDraft("canonical-active", contributorId, "1");
  await addEvidence("legacy-active");
  await addEvidence("canonical-active");
  await submitDraft({ draftId: "legacy-active", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  await submitDraft({ draftId: "canonical-active", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 2 });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "legacy-active", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 3,
  }), { ok: true, replacedDraftId: null });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "canonical-active", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 4,
  }), { ok: true, replacedDraftId: null });

  assert.equal(await repository.normalizeMapDraftPeriodAliases({
    eventId: "ff47", venueSpaceId: "zhengyan-exhibition-area",
    periodKey: "1", periodAliases: ["1", "day-1"],
  }), false);
  assert.equal((await repository.getMapDraft("legacy-active")).period_key, "day-1", "failed normalization rolls back");
  assert.equal((await repository.getMapDraft("canonical-active")).period_key, "1");
});

test("replacement approval is explicit and records withdrawal before the new approval", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await createDraft("draft-b");
  await addEvidence("draft-a");
  await addEvidence("draft-b");
  await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  await submitDraft({ draftId: "draft-b", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 2 });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 3,
  }), { ok: true, replacedDraftId: null });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-b", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 4,
  }), { ok: false, reason: "replacement_required", activeDraftId: "draft-a" });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-b", expectedRevision: 1, replacementDraftId: "draft-a",
    actorAccountId: "admin-1", note: "new official revision", now: NOW + 5,
  }), { ok: true, replacedDraftId: "draft-a" });
  assert.equal((await repository.getMapDraft("draft-a")).status, "withdrawn");
  assert.equal((await repository.getMapDraft("draft-b")).status, "approved");
  const reviews = await database.prepare(
    "SELECT draft_id, from_status, to_status FROM map_draft_reviews WHERE at = ?1 ORDER BY to_status",
  ).bind(NOW + 5).all();
  assert.deepEqual(reviews.results, [
    { draft_id: "draft-b", from_status: "submitted", to_status: "approved" },
    { draft_id: "draft-a", from_status: "approved", to_status: "withdrawn" },
  ]);
});

test("candidate export atomically records the immutable payload and is idempotent", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await addEvidence("draft-a");
  await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  await repository.approveMapDraft({ draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 2 });
  const input = {
    draftId: "draft-a", expectedRevision: 1, targetPath: "map.json",
    candidateJson: '{"eventId":"ff47"}\n', diffJson: '{"addedBoothCodes":[]}',
    candidateSha256: "c".repeat(64), actorAccountId: "admin-1", now: NOW + 3,
  };
  const first = await repository.exportMapDraft(input);
  assert.equal(first.target_path, "map.json");
  assert.equal(first.candidate_sha256, "c".repeat(64));
  assert.equal((await repository.getMapDraft("draft-a")).status, "exported");
  const retry = await repository.exportMapDraft({ ...input, now: NOW + 4 });
  assert.equal(retry.id, first.id);
  const counts = await database.prepare(
    "SELECT (SELECT COUNT(*) FROM map_draft_exports) AS exports, (SELECT COUNT(*) FROM map_draft_reviews WHERE to_status = 'exported') AS reviews",
  ).first();
  assert.deepEqual(counts, { exports: 1, reviews: 1 });
});

test("the state machine allows requested changes and forbids rejected export", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "changes_requested", actorAccountId: "admin-1", actorRole: "admin", note: "move A01", now: NOW + 2,
  }), true);
  assert.equal(await writeRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, contentJson: JSON.stringify({ markers: ["A01"] }), now: NOW + 3,
  }), 2);
  assert.equal(await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 4 }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 2, toStatus: "rejected", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 5,
  }), true);
  assert.equal(await repository.exportMapDraft({
    draftId: "draft-a", expectedRevision: 2, targetPath: "map.json",
    candidateJson: "{}", diffJson: "{}", candidateSha256: "d".repeat(64),
    actorAccountId: "admin-1", now: NOW + 6,
  }), null);
});

test("same-millisecond retries do not append duplicate state transitions", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await addEvidence("draft-a");
  assert.equal(await submitDraft({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1,
  }), true);
  assert.equal(await submitDraft({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1,
  }), false);
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 2,
  }), { ok: true, replacedDraftId: null });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 2,
  }), { ok: false, reason: "conflict" });
  const reviews = await database.prepare("SELECT from_status, to_status FROM map_draft_reviews WHERE draft_id = 'draft-a' ORDER BY at").all();
  assert.deepEqual(reviews.results, [
    { from_status: "draft", to_status: "submitted" },
    { from_status: "submitted", to_status: "approved" },
  ]);
});

test("approval fails closed when a legacy submitted revision has no evidence", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await submitDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "draft-a", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 2,
  }), { ok: false, reason: "missing_evidence" });
  assert.equal((await repository.getMapDraft("draft-a")).status, "submitted");
});

test("raw metadata is bound to the current private revision", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  assert.equal(await repository.addMapDraftFile({
    id: "file-a", draftId: "draft-a", eventId: "ff47", revision: 1, objectKey: "private/ff47/draft-a/file-a.png",
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
    sha256: "a".repeat(64), mime: "image/png", sizeBytes: 123, width: 100, height: 200,
    pageCount: null, uploadedBy: contributorId, now: NOW,
  }), true);
  const file = await repository.getMapDraftFile("file-a");
  assert.equal(file.object_key, "private/ff47/draft-a/file-a.png");
  assert.equal(file.owner_account_id, contributorId);
  assert.equal(await repository.markMapDraftRawDeleted("file-a", NOW + 1), true);
  assert.equal((await repository.getMapDraftFile("file-a")).object_key, null);
});

test("account deletion removes never-submitted drafts and anonymizes reviewed actors", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-private");
  await createDraft("draft-reviewed");
  await repository.addMapDraftFile({
    id: "private-file", draftId: "draft-private", eventId: "ff47", revision: 1, objectKey: "private/ff47/draft-private/raw.png",
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
    sha256: "b".repeat(64), mime: "image/png", sizeBytes: 12, width: 1, height: 1,
    pageCount: null, uploadedBy: contributorId, now: NOW,
  });
  await submitDraft({ draftId: "draft-reviewed", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  assert.deepEqual(await repository.listUnsubmittedMapDraftObjectKeysForAccount(contributorId), ["private/ff47/draft-private/raw.png"]);

  assert.equal(await repository.beginAccountDeletion({
    accountId: contributorId, email: "mapper@example.test", now: NOW + 2,
  }), true);
  assert.equal(await repository.deleteAccount({
    accountId: contributorId, email: "mapper@example.test", emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now: NOW + 2,
  }), true);
  assert.equal(await repository.getMapDraft("draft-private"), null);
  const reviewed = await repository.getMapDraft("draft-reviewed");
  assert.equal(reviewed.owner_account_id, "[shredded]");
  const review = await database.prepare("SELECT actor_account_id FROM map_draft_reviews WHERE draft_id = 'draft-reviewed'").first();
  assert.equal(review.actor_account_id, null);
});

test("deleting a former admin shreds their email from contributor grant history", async () => {
  const formerAdminId = await repository.upsertAccount("former-admin@example.test", NOW);
  await repository.upsertAccount("second-mapper@example.test", NOW);
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "former-admin@example.test", now: NOW });
  await repository.manageMapContributor({ email: "mapper@example.test", action: "revoke", by: "former-admin@example.test", now: NOW + 1 });
  await repository.manageMapContributor({ email: "second-mapper@example.test", action: "grant", by: "former-admin@example.test", now: NOW });
  await repository.manageMapContributor({ email: "second-mapper@example.test", action: "suspend", by: "former-admin@example.test", now: NOW + 1 });
  await repository.beginAccountDeletion({ accountId: formerAdminId, email: "former-admin@example.test", now: NOW + 2 });
  await repository.deleteAccount({
    accountId: formerAdminId, email: "former-admin@example.test",
    emailAuditDigest: "digest", legacyEmailAuditDigest: "legacy", now: NOW + 2,
  });
  const grants = await database.prepare(
    "SELECT granted_by, revoked_by, suspended_by FROM map_contributor_grants ORDER BY revoked_by IS NULL",
  ).all();
  assert.deepEqual(grants.results, [
    { granted_by: "[shredded]", revoked_by: "[shredded]", suspended_by: null },
    { granted_by: "[shredded]", revoked_by: null, suspended_by: "[shredded]" },
  ]);
});
