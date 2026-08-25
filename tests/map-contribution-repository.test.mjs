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

const createDraft = (id, ownerAccountId = contributorId) => repository.createMapDraft({
  id,
  eventId: "ff47",
  periodKey: "day-1",
  venueSpaceId: "zhengyan-exhibition-area",
  ownerAccountId,
  contentJson: JSON.stringify({ markers: [] }),
  now: NOW,
});

test("only an active grant can create, revise or submit a private draft", async () => {
  assert.equal(await createDraft("draft-before-grant"), false);
  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW }), "granted");
  assert.equal(await repository.hasActiveMapContributor(contributorId), true);
  assert.equal(await createDraft("draft-a"), true);

  assert.equal(await repository.writeMapDraftRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1,
    contentJson: JSON.stringify({ markers: ["A01"] }), now: NOW + 1,
  }), 2);
  assert.equal(await repository.writeMapDraftRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1,
    contentJson: JSON.stringify({ markers: ["stale"] }), now: NOW + 2,
  }), null);

  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "revoke", by: "admin@example.test", now: NOW + 3 }), "revoked");
  assert.equal(await repository.hasActiveMapContributor(contributorId), false);
  assert.equal(await repository.writeMapDraftRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2,
    contentJson: JSON.stringify({ markers: ["blocked"] }), now: NOW + 4,
  }), null);
  assert.equal(await repository.submitMapDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 5 }), false);

  assert.equal(await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW + 6 }), "granted");
  assert.equal(await repository.submitMapDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 7 }), true);
  const draft = await repository.getMapDraft("draft-a");
  assert.equal(draft.status, "submitted");
  assert.equal(draft.current_revision, 2);
  assert.deepEqual(JSON.parse(draft.content_json), { markers: ["A01"] });
});

test("parallel drafts coexist but one scope cannot have two approved revisions", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  assert.equal(await createDraft("draft-a"), true);
  assert.equal(await createDraft("draft-b"), true);
  assert.equal(await repository.submitMapDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 }), true);
  assert.equal(await repository.submitMapDraft({ draftId: "draft-b", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 2 }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "approved", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 3,
  }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "exported", actorAccountId: null, actorRole: "system", now: NOW + 4,
  }), true);
  await assert.rejects(() => repository.transitionMapDraft({
    draftId: "draft-b", expectedRevision: 1, toStatus: "approved", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 5,
  }), /UNIQUE|unique/i);
  assert.equal((await repository.getMapDraft("draft-b")).status, "submitted", "the failed approval batch must roll back");
});

test("the state machine allows requested changes and forbids rejected export", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  await repository.submitMapDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "changes_requested", actorAccountId: "admin-1", actorRole: "admin", note: "move A01", now: NOW + 2,
  }), true);
  assert.equal(await repository.writeMapDraftRevision({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, contentJson: JSON.stringify({ markers: ["A01"] }), now: NOW + 3,
  }), 2);
  assert.equal(await repository.submitMapDraft({ draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 2, now: NOW + 4 }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 2, toStatus: "rejected", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 5,
  }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 2, toStatus: "exported", actorAccountId: null, actorRole: "system", now: NOW + 6,
  }), false);
});

test("same-millisecond retries do not append duplicate state transitions", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  assert.equal(await repository.submitMapDraft({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1,
  }), true);
  assert.equal(await repository.submitMapDraft({
    draftId: "draft-a", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1,
  }), false);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "approved", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 2,
  }), true);
  assert.equal(await repository.transitionMapDraft({
    draftId: "draft-a", expectedRevision: 1, toStatus: "approved", actorAccountId: "admin-1", actorRole: "admin", now: NOW + 2,
  }), false);
  const reviews = await database.prepare("SELECT from_status, to_status FROM map_draft_reviews WHERE draft_id = 'draft-a' ORDER BY at").all();
  assert.deepEqual(reviews.results, [
    { from_status: "draft", to_status: "submitted" },
    { from_status: "submitted", to_status: "approved" },
  ]);
});

test("raw metadata is bound to the current private revision", async () => {
  await repository.manageMapContributor({ email: "mapper@example.test", action: "grant", by: "admin@example.test", now: NOW });
  await createDraft("draft-a");
  assert.equal(await repository.addMapDraftFile({
    id: "file-a", draftId: "draft-a", revision: 1, objectKey: "private/ff47/draft-a/file-a.png",
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
    id: "private-file", draftId: "draft-private", revision: 1, objectKey: "private/ff47/draft-private/raw.png",
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
    sha256: "b".repeat(64), mime: "image/png", sizeBytes: 12, width: 1, height: 1,
    pageCount: null, uploadedBy: contributorId, now: NOW,
  });
  await repository.submitMapDraft({ draftId: "draft-reviewed", ownerAccountId: contributorId, expectedRevision: 1, now: NOW + 1 });
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
