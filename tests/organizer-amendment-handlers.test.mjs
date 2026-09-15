import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture } from "./support/organizer-amendment-fixture.mjs";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const { createIdentityRepository } = await runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers, SESSION_COOKIE } = await runner.import("/app/circle-portal-handlers.ts");
const { hmacSign } = await runner.import("/app/portal-crypto.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "amendment-handlers" } }));
const db = await mf.getD1Database("DB");
const repo = createIdentityRepository(db, { bootstrapAdmins: ["admin@example.test"] });
const data = await amendmentFixture(runner);
const secret = "test-session-secret";
const origin = "https://organizer.example";
let handlers, owner, editor, admin, stranger, ownerId, loadCount, loadHook;
const request = (method, body, cookie) => new Request(`${origin}/api/organizer/events/source/amendments`, {
  method, headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
before(() => repo.ensureTables());
after(async () => { await mf.dispose(); await vite.close(); });
async function actor(name) {
  const id = await repo.upsertAccount(`${name}@example.test`, data.now);
  const sessionId = crypto.randomUUID();
  await repo.createSession(id, data.now, data.now + 86_400_000, sessionId);
  return { id, cookie: `${SESSION_COOKIE}=${sessionId}.${await hmacSign(secret, sessionId)}` };
}
beforeEach(async () => {
  await repo.clearPreviewData();
  const ownerActor = await actor("owner"); owner = ownerActor.cookie; ownerId = ownerActor.id;
  const editorActor = await actor("editor"); editor = editorActor.cookie;
  const adminActor = await actor("admin"); admin = adminActor.cookie;
  await repo.addAdmin("admin@example.test", "bootstrap", data.now);
  stranger = (await actor("stranger")).cookie;
  await repo.createOrganizerCandidate({ id: "source", tentativeName: "測試活動", ownerEmail: "owner@example.test", createdByAccountId: adminActor.id, draftJson: JSON.stringify(data.baseline.draft), now: data.now });
  await db.prepare("UPDATE organizer_event_candidates SET event_id = 'event-alpha', event_id_locked_at = ?1, status = 'published', published_version = 1, published_at = ?1 WHERE id = 'source'").bind(data.now).run();
  for (const [person, role] of [[ownerActor, "owner"], [editorActor, "editor"]]) await db.prepare(`INSERT INTO organizer_event_grants
    (id,candidate_id,account_id,role,granted_by,granted_at) VALUES (?1,'source',?2,?3,?4,?5)`)
    .bind(crypto.randomUUID(), person.id, role, adminActor.id, data.now).run();
  await db.prepare(`INSERT INTO organizer_submission_snapshots (id,candidate_id,candidate_version,snapshot_json,sha256,created_by,created_at)
    VALUES ('published-snapshot','source',1,?1,?2,?3,?4)`).bind(data.source.snapshotJson, data.source.approvalHash, ownerId, data.now).run();
  await db.prepare(`INSERT INTO organizer_publication_jobs (id,candidate_id,candidate_version,snapshot_id,approval_hash,status,step,data_merge_sha,main_merge_sha,created_at,updated_at)
    VALUES ('published-job','source',1,'published-snapshot',?1,'published','completed',?2,?3,?4,?4)`)
    .bind(data.source.approvalHash, data.source.dataCommit, data.source.mainCommit, data.now).run();
  loadCount = 0; loadHook = async () => {};
  handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true,
    turnstileSitekey: () => "test-sitekey", projectCircle: async () => null,
    dispatchOrganizerPublication: async () => { throw new Error("AMEND must not publish in this slice"); },
    loadPublishedAmendmentBaseline: async (source) => { loadCount++; assert.deepEqual(source, data.source); await loadHook(); return structuredClone(data.baseline); },
    config: { eventId: "event-alpha", origin, sessionSecret: secret, hashPepper: "test-pepper", adminEmails: ["admin@example.test"],
      dataUpdatedAt: data.baseline.event.dataUpdatedAt, eventEndsAt: data.baseline.event.eventEndsAt, now: () => data.now, organizerPublicationMode: "github" } });
});
async function create() {
  const response = await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 1 }, owner), "source");
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).candidateId;
}

test("baseline reads follow authorization; callers cannot supply baseline content or use a stale source", async () => {
  for (const [cookie, status] of [[null, 401], [editor, 403], [stranger, 404]]) {
    assert.equal((await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 1 }, cookie), "source")).status, status);
  }
  assert.equal((await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 1, baseline: {} }, owner), "source")).status, 400);
  assert.equal((await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 2 }, owner), "source")).status, 409);
  assert.equal(loadCount, 0);
  await create();
  assert.equal(loadCount, 1);
});

test("declarations save and reload impact without exposing the registry or changing published data", async () => {
  const id = await create();
  for (const cookie of [owner, admin]) {
    const listed = await (await handlers.listOrganizerCandidates(request("GET", undefined, cookie))).json();
    assert.equal(listed.events.find((event) => event.id === id).operation, "AMEND");
    assert.equal(listed.events.find((event) => event.id === "source").operation, "CREATE");
  }
  const detail = await (await handlers.getOrganizerCandidate(request("GET", undefined, owner), id)).json();
  assert.equal(detail.event.operation, "AMEND");
  assert.equal(detail.publicationAvailable, false);
  const response = await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 1,
    changes: [{ kind: "released", sources: ["1:S02"], circleName: "新社" }] }, editor), id);
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json();
  assert.equal(saved.version, 2);
  assert.equal(saved.impact[0].before[0].circleId, "c-000002");
  assert.equal(saved.impact[0].after[0].circleId, "c-000003");
  const loaded = await handlers.getOrganizerAmendment(request("GET", undefined, owner), id);
  assert.equal(loaded.status, 200);
  const text = await loaded.text();
  assert.ok(!text.includes('"allocations"') && !text.includes('"evidence"') && !text.includes('"approvalHash"'));
  assert.deepEqual(JSON.parse(text).impact, saved.impact);
  assert.equal((await repo.getOrganizerCandidate("source")).status, "published");
  assert.equal((await repo.getOrganizerCandidate("source")).current_version, 1);
  assert.equal((await handlers.getOrganizerAmendment(request("GET", undefined, stranger), id)).status, 404);
});

test("invalid declarations, stale versions and ordinary import/edit paths cannot bypass explicit changes", async () => {
  const id = await create();
  for (const [body, status] of [
    [{ expectedVersion: 1, changes: [{ kind: "withdrawn", sources: ["1:missing"] }] }, 422],
    [{ expectedVersion: 1, changes: [], baseline: {} }, 400],
    [{ expectedVersion: 2, changes: [] }, 409],
  ]) assert.equal((await handlers.saveOrganizerAmendment(request("PUT", body, owner), id)).status, status);
  assert.equal((await handlers.updateOrganizerCandidate(request("PUT", { expectedVersion: 1, draft: data.baseline.draft }, owner), id)).status, 409);
  assert.equal((await handlers.putOrganizerImport(request("PUT", {}, owner), id)).status, 409);
  assert.equal((await handlers.submitOrganizerCandidate(request("POST", { expectedVersion: 1 }, owner), id)).status, 503);
  assert.equal((await handlers.adminReviewOrganizerCandidate(request("POST", { expectedVersion: 1, decision: "approve" }, admin), id)).status, 503);
  assert.equal((await repo.getOrganizerCandidate(id)).current_version, 1);
  assert.equal((await repo.getOrganizerAmendment(id)).changes_json, "[]");
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  assert.equal(await repo.getOrganizerSubmissionSnapshot(id, 1), null);
});

test("revocation while loading published evidence prevents candidate creation and leaves no orphan copies", async () => {
  loadHook = async () => db.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = 'source' AND account_id = ?2").bind(data.now, ownerId).run();
  const response = await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 1 }, owner), "source");
  assert.equal(response.status, 409);
  assert.equal(loadCount, 1);
  for (const table of ["organizer_amendments", "organizer_amendment_changes", "organizer_import_sources", "map_drafts"]) {
    assert.equal((await db.prepare(`SELECT count(*) AS count FROM ${table}`).first()).count, 0);
  }
});

test("removing an Admin during the remote baseline read prevents creating amendment copies", async () => {
  await repo.addAdmin("backup@example.test", "admin@example.test", data.now);
  loadHook = async () => assert.equal(await repo.removeAdmin("admin@example.test"), "removed");
  const response = await handlers.createOrganizerAmendment(request("POST", { expectedVersion: 1 }, admin), "source");
  assert.equal(response.status, 409);
  assert.equal(loadCount, 1);
  for (const table of ["organizer_amendments", "organizer_amendment_changes", "organizer_import_sources", "map_drafts"]) {
    assert.equal((await db.prepare(`SELECT count(*) AS count FROM ${table}`).first()).count, 0);
  }
});

test("a concurrent save cannot pair old declarations with a newer writable version in GET", async () => {
  const id = await create();
  const winner = [{ kind: "released", sources: ["1:S02"], circleName: "新社" }];
  const original = repo.getOrganizerAmendment;
  repo.getOrganizerAmendment = async (candidateId) => {
    const stored = await original(candidateId);
    repo.getOrganizerAmendment = original;
    assert.equal((await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 1, changes: winner }, editor), id)).status, 200);
    return stored;
  };
  let loaded;
  try { loaded = await (await handlers.getOrganizerAmendment(request("GET", undefined, owner), id)).json(); }
  finally { repo.getOrganizerAmendment = original; }
  assert.equal(loaded.version, 1);
  assert.deepEqual(loaded.changes, []);
  assert.equal((await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: loaded.version, changes: loaded.changes }, owner), id)).status, 409);
  const latest = await (await handlers.getOrganizerAmendment(request("GET", undefined, owner), id)).json();
  assert.equal(latest.version, 2);
  assert.deepEqual(latest.changes, winner);
});

test("map-only edits advance the returned candidate version while retaining the last declarations", async () => {
  const id = await create();
  const [map] = await repo.listOrganizerMapDrafts(id);
  assert.deepEqual(await repo.saveOrganizerMapDraft({ candidateId: id, draftId: map.id, actorAccountId: ownerId,
    expectedVersion: 1, expectedMapRevision: 1, contentJson: JSON.stringify(data.baseline.maps[0].content), now: data.now + 1 }),
  { ok: true, version: 2, mapRevision: 2 });
  const loaded = await (await handlers.getOrganizerAmendment(request("GET", undefined, owner), id)).json();
  assert.equal(loaded.version, 2);
  assert.deepEqual(loaded.changes, []);
  assert.equal((await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 2, changes: [] }, owner), id)).status, 200);
});
