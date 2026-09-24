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
const { hmacSign, sha256Hex } = await runner.import("/app/portal-crypto.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "amendment-handlers" } }));
const db = await mf.getD1Database("DB");
const repo = createIdentityRepository(db, { bootstrapAdmins: ["admin@example.test"] });
const data = await amendmentFixture(runner);
const secret = "test-session-secret";
const origin = "https://organizer.example";
let handlers, owner, editor, admin, stranger, ownerId, loadCount, loadHook, dispatched, dispatchHook, auditRecoveryHook;
const backgroundObjects = new Map();
const backgroundReads = [];
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
  for (const row of data.referenceRecords) await db.prepare(`INSERT OR REPLACE INTO organizer_reference_records
    (path,kind,reference_id,organizer_id,revision,display_name,public_reference_json,source_captured_at,created_by)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(row.path,row.kind,row.id,row.organizerId,row.revision,row.displayName,row.publicReferenceJson,row.sourceCapturedAt,adminActor.id).run();
  loadCount = 0; loadHook = async () => {}; dispatched = []; dispatchHook = async () => {};
  auditRecoveryHook = async () => ({ restorationPullNumber: 9, restorationMergeSha: "9".repeat(40), sourceCandidateId: "source" });
  backgroundObjects.clear(); backgroundReads.length = 0;
  handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    auditPublicationRecovery: (input) => auditRecoveryHook(input),
    githubRemoteAuditor: async () => { throw Error("A publication with remote checkpoints cannot reach the reopen audit"); },
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true,
    turnstileSitekey: () => "test-sitekey", projectCircle: async () => null,
    mapContributionStore: {
      async get(key) { backgroundReads.push(key); const object = backgroundObjects.get(key); return object ? { body: new Response(object.bytes).body, contentType: object.contentType } : null; },
      async put(key, bytes, contentType) { backgroundObjects.set(key,{ bytes: new Uint8Array(bytes), contentType }); },
      async delete(key) { backgroundObjects.delete(key); },
    },
    dispatchOrganizerPublication: async (jobId) => { dispatched.push(jobId); await dispatchHook(jobId); },
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
  assert.equal(detail.publicationAvailable, true);
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
  assert.equal((await handlers.adminReviewOrganizerCandidate(request("POST", { expectedVersion: 1, decision: "approve" }, admin), id)).status, 409);
  assert.equal((await repo.getOrganizerCandidate(id)).current_version, 1);
  assert.equal((await repo.getOrganizerAmendment(id)).changes_json, "[]");
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  assert.equal(await repo.getOrganizerSubmissionSnapshot(id, 1), null);
});

test("settings declarations are whole-state, kept only when they change something, and limited to the allow-list", async () => {
  const id = await create();
  const put = (version, settings, changes = []) => handlers.saveOrganizerAmendment(request("PUT",
    { expectedVersion: version, changes, ...(settings === undefined ? {} : { settings }) }, owner), id);
  const saved = await put(1, { name: " 測試活動 改名 ", aliases: ["TA"], days: [{ id: "1", date: "2026-11-14" }] });
  assert.equal(saved.status, 200, await saved.clone().text());
  const body = await saved.json();
  const declared = { name: "測試活動 改名", aliases: ["TA"], days: [{ id: "1", date: "2026-11-14" }] };
  assert.deepEqual(body.settings, declared);
  assert.deepEqual(body.settingsImpact.map((row) => [row.field, row.before, row.after]),
    [["name", "測試活動", "測試活動 改名"], ["aliases", [], ["TA"]], ["day", "2026-11-07", "2026-11-14"]]);
  assert.equal((await repo.getOrganizerAmendment(id)).settings_json, JSON.stringify(declared));
  const loaded = await (await handlers.getOrganizerAmendment(request("GET", undefined, editor), id)).json();
  assert.deepEqual(loaded.settings, declared);
  assert.deepEqual(loaded.settingsImpact, body.settingsImpact);
  assert.equal(loaded.baseline.event.name, "測試活動", "the baseline stays the published event");
  const preview = await (await handlers.previewOrganizerCandidate(request("POST", {}, owner), id)).json();
  assert.equal(preview.preview.event.name, "測試活動 改名");
  assert.equal(preview.preview.event.days[0].date, "2026-11-14");
  for (const settings of [{ mapTemplate: "OTHER" }, { days: [{ id: "2", date: "2026-11-08" }] }, { days: [{ id: "1", date: "2026/11/14" }] },
    { aliases: ["測試活動"] }, { name: "" }, "name"]) {
    const response = await put(2, settings);
    assert.equal(response.status, 422, JSON.stringify(settings));
    assert.ok((await response.json()).error);
  }
  const oversized = await put(2, { name: "名".repeat(400_000) });
  assert.equal(oversized.status, 413, "the corrected draft is held to the size a draft save accepts");
  assert.equal((await repo.getOrganizerAmendment(id)).settings_json, JSON.stringify(declared), "a rejected save keeps the last declaration");
  assert.equal((await put(2, { name: "測試活動", days: [{ id: "1", date: "2026-11-07" }] })).status, 200);
  assert.equal((await repo.getOrganizerAmendment(id)).settings_json, null, "restating published values declares nothing");
  assert.equal((await put(3, { name: "再改名" })).status, 200);
  assert.equal((await put(4, undefined)).status, 200);
  assert.equal((await repo.getOrganizerAmendment(id)).settings_json, null, "an omitted settings key clears the declaration");
  const draft = structuredClone(data.baseline.draft); draft.event.name = "直接改草稿";
  assert.equal((await handlers.updateOrganizerCandidate(request("PUT", { expectedVersion: 5, draft }, owner), id)).status, 409);
  assert.equal((await repo.getOrganizerCandidate(id)).current_draft_json, JSON.stringify(data.baseline.draft));
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

const submit = (id, version = 2, cookie = owner) => handlers.submitOrganizerCandidate(request("POST", { expectedVersion: version }, cookie), id);
const review = (id, version = 2, cookie = admin, decision = "approve") => handlers.adminReviewOrganizerCandidate(request("POST", { expectedVersion: version, decision }, cookie), id);
async function changed() {
  const id = await create();
  const result = await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 1,
    changes: [{ kind: "released", sources: ["1:S02"], circleName: "確認接手社" }] }, owner), id);
  assert.equal(result.status, 200, await result.clone().text());
  return id;
}

async function failedAfterDataMerge() {
  const id = await changed();
  assert.equal((await submit(id)).status, 200);
  assert.equal((await review(id)).status, 200);
  const job = await repo.getLatestOrganizerPublicationJob(id);
  await db.prepare("UPDATE organizer_event_candidates SET status='failed' WHERE id=?1").bind(id).run();
  await db.prepare(`UPDATE organizer_publication_jobs SET status='failed',step='merging_main',failure_code='snapshot_mismatch',
    error='old worker omitted settings',retryable=1,data_pr_number=6,data_head_sha=?2,data_merge_sha=?3,
    main_pr_number=375,main_head_sha=?4,remote_write_intent_at=?5 WHERE id=?1`)
    .bind(job.id,"6".repeat(40),"7".repeat(40),"8".repeat(40),data.now).run();
  return { id, job: await repo.getOrganizerPublicationJob(job.id), snapshot: await repo.getOrganizerSubmissionSnapshot(id,2) };
}
const abandon = (id, cookie = admin, extra = {}) => handlers.abandonOrganizerAmendment(request("POST", {
  expectedVersion: 2, restorationPullNumber: 9, reason: "舊版產檔錯誤，未公開資料已還原", ...extra,
}, cookie), id);

test("restored amendment retires atomically, keeps failure/snapshot/intent and permits a fresh approval only", async () => {
  const { id, job, snapshot } = await failedAfterDataMerge();
  const original = await repo.getOrganizerCandidate("source");
  const before = await repo.getOrganizerAmendment(id);
  const detail = await (await handlers.getOrganizerCandidate(request("GET",undefined,admin),id)).json();
  assert.equal(detail.recoveryAvailable,true);
  const response = await abandon(id);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).sourceCandidateId,"source");
  assert.equal((await repo.getOrganizerCandidate(id)).status,"abandoned");
  assert.equal((await repo.getOrganizerCandidate(id)).current_version,2);
  assert.deepEqual(await repo.getOrganizerPublicationJob(job.id),{...job,retryable:0});
  assert.deepEqual(await repo.getOrganizerSubmissionSnapshot(id,2),snapshot);
  assert.deepEqual(await repo.getOrganizerAmendment(id),before);
  assert.deepEqual(await repo.getOrganizerCandidate("source"),original);
  assert.equal((await repo.retryOrganizerPublicationJob({jobId:job.id,now:data.now})).ok,false);
  const {createOrganizerPublicationExecutor}=await runner.import('/app/organizer-publication.ts');
  assert.equal(await createOrganizerPublicationExecutor(repo,{eventExists(){throw Error('stale');},run(){throw Error('stale');}},()=>data.now)(job.id),'skipped');
  assert.equal((await abandon(id)).status,409);
  assert.equal((await handlers.saveOrganizerAmendment(request("PUT",{expectedVersion:2,changes:[]},owner),id)).status,409);
  const audits=await db.prepare("SELECT detail_json FROM audit_log WHERE action='organizer.amendment.abandoned' AND subject_id=?1").bind(id).all();
  assert.equal(audits.results.length,1);
  assert.equal(JSON.parse(audits.results[0].detail_json).restorationPullNumber,9);
  const next=await changed();
  assert.notEqual(next,id);
  assert.equal(await repo.getLatestOrganizerPublicationJob(next),null);
  assert.equal((await review(next)).status,409,"old approval cannot authorize a new candidate");
  assert.equal((await submit(next)).status,200);
  assert.equal((await review(next)).status,200);
  const nextJob=await repo.getLatestOrganizerPublicationJob(next);
  assert.notEqual(nextJob.id,job.id);
  assert.notEqual(nextJob.snapshot_id,job.snapshot_id);
  assert.notEqual(nextJob.approval_hash,job.approval_hash);
});

test("concurrent recovery requests perform one remote audit and one retirement", async () => {
  const { id } = await failedAfterDataMerge();
  let audited = 0;
  auditRecoveryHook = async () => { audited++; return { restorationPullNumber: 9 }; };
  const responses = await Promise.all([abandon(id), abandon(id)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(audited, 1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM organizer_event_reviews WHERE candidate_id=?1 AND to_status='abandoned'").bind(id).first()).n, 1);
});

test("recovery authorizes Admin before any audit, rejects wrong input and does not change original reopen", async () => {
  const {id}=await failedAfterDataMerge();
  let audits=0; auditRecoveryHook=async()=>{audits++;throw Error('must not audit');};
  for(const [cookie,status] of [[null,401],[owner,403],[editor,403],[stranger,404]]) assert.equal((await abandon(id,cookie)).status,status);
  for(const extra of [{expectedVersion:1},{reason:""},{restorationPullNumber:0},{restorationPullNumber:1.5},{repository:"foreign"}]) {
    assert.ok([400,409].includes((await abandon(id,admin,extra)).status));
  }
  assert.equal((await handlers.reopenOrganizerCandidate(request("POST",{expectedVersion:2,reason:"不可清空"},admin),id)).status,409);
  assert.equal(audits,0);
});

test("unknown remote state, changed public baseline, and already merged main keep the amendment locked", async () => {
  const {id,job}=await failedAfterDataMerge();
  auditRecoveryHook=async()=>{throw Error('GitHub 403 / incomplete lookup');};
  assert.equal((await abandon(id)).status,409);
  assert.equal((await repo.getOrganizerCandidate(id)).status,'failed');
  loadHook=async()=>{throw Error('public pin changed');};
  assert.equal((await abandon(id)).status,409);
  loadHook=async()=>{};
  await db.prepare("UPDATE organizer_publication_jobs SET main_merge_sha=?1 WHERE id=?2").bind('a'.repeat(40),job.id).run();
  assert.equal((await abandon(id)).status,409);
  assert.equal((await handlers.createOrganizerAmendment(request('POST',{expectedVersion:1},owner),'source')).status,409);
});

for(const [name,change] of [
  ['expired lease',()=>db.prepare("UPDATE organizer_publication_lease SET expires_at=0").run()],
  ['revoked Admin',()=>db.prepare("DELETE FROM admins WHERE email='admin@example.test'").run()],
  ['changed checkpoint',()=>db.prepare("UPDATE organizer_publication_jobs SET data_head_sha=?1 WHERE status='failed'").bind('f'.repeat(40)).run()],
  ['changed candidate version',()=>db.prepare("UPDATE organizer_event_candidates SET current_version=3 WHERE status='failed'").run()],
]) test(`recovery CAS refuses ${name} during remote audit without writing retirement evidence`,async()=>{
  const {id}=await failedAfterDataMerge();
  auditRecoveryHook=async()=>{await change();return {restorationPullNumber:9};};
  assert.equal((await abandon(id)).status,409);
  assert.equal((await repo.getOrganizerCandidate(id)).status,'failed');
  assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='organizer.amendment.abandoned'").first()).n,0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM organizer_event_reviews WHERE to_status='abandoned'").first()).n,0);
});

test("retirement audit failure rolls back status, lock release and retryability together",async()=>{
  const {id,job}=await failedAfterDataMerge();
  await db.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_log WHEN NEW.action='organizer.amendment.abandoned' BEGIN SELECT RAISE(ABORT,'injected recovery audit failure'); END;");
  try {
    assert.equal((await abandon(id)).status,409);
    assert.equal((await repo.getOrganizerCandidate(id)).status,'failed');
    assert.deepEqual(await repo.getOrganizerPublicationJob(job.id),job);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM organizer_event_reviews WHERE to_status='abandoned'").first()).n,0);
    assert.equal((await handlers.createOrganizerAmendment(request('POST',{expectedVersion:1},owner),'source')).status,409);
  } finally {await db.exec("DROP TRIGGER fail_recovery_audit");}
});
test("AMEND validation, preview, immutable submission and unique approval use the shared publication job", async () => {
  const id = await changed();
  const before = await repo.getOrganizerCandidate("source");
  const validation = await handlers.validateOrganizerCandidate(request("POST", {}, owner), id);
  assert.equal((await validation.json()).ok, true);
  const preview = await (await handlers.previewOrganizerCandidate(request("POST", {}, owner), id)).json();
  assert.deepEqual(preview.preview.placements.map((row) => [row.boothCode, row.circleName]), [["S01", "甲社"], ["S02", "確認接手社"]]);
  assert.equal(preview.preview.maps.length, 1);
  assert.equal((await submit(id, 2, editor)).status, 403);
  assert.equal((await submit(id, 1)).status, 409);
  const response = await submit(id);
  assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await repo.getOrganizerSubmissionSnapshot(id, 2);
  const content = JSON.parse(snapshot.snapshot_json);
  const stored = await repo.getOrganizerAmendment(id);
  assert.equal(content.schema, "organizer-submission-snapshot/4");
  assert.equal(content.operation, "AMEND");
  assert.equal(content.amendment.baselineJson, stored.baseline_json);
  assert.equal(content.amendment.baselineSha256, stored.baseline_sha256);
  assert.deepEqual(content.amendment.changes, JSON.parse(stored.changes_json));
  assert.equal(await sha256Hex(snapshot.snapshot_json), snapshot.sha256);
  assert.equal((await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 2, changes: [] }, owner), id)).status, 409);
  assert.equal((await review(id, 2, owner)).status, 403);
  assert.equal((await review(id, 1)).status, 409);
  dispatchHook = async () => { throw new Error("Controlled local dispatch outage"); };
  const approval = await review(id);
  assert.equal(approval.status, 200, await approval.clone().text());
  const job = await repo.getLatestOrganizerPublicationJob(id);
  assert.equal(job.status, "failed"); assert.equal(job.failure_code, "dispatch_failed"); assert.equal(job.retryable, 1);
  assert.equal(job.snapshot_id, snapshot.id); assert.equal(job.approval_hash, snapshot.sha256);
  assert.equal((await review(id)).status, 200);
  assert.deepEqual(dispatched, [job.id], "duplicate approval must not dispatch again");
  dispatchHook = async () => {};
  assert.equal((await handlers.adminRetryOrganizerPublication(request("POST", {}, editor), job.id)).status, 403);
  const retried = await handlers.adminRetryOrganizerPublication(request("POST", {}, owner), job.id);
  assert.equal(retried.status, 200, await retried.clone().text());
  const same = await repo.getLatestOrganizerPublicationJob(id);
  assert.equal(same.id, job.id); assert.equal(same.snapshot_id, snapshot.id); assert.equal(same.approval_hash, snapshot.sha256);
  assert.equal(same.status, "queued"); assert.equal(same.step, job.step);
  assert.deepEqual(await repo.getOrganizerSubmissionSnapshot(id, 2), snapshot);
  assert.deepEqual(await repo.getOrganizerCandidate("source"), before);
});

test("AMEND rejects invalid map coverage before storing a submission", async () => {
  const id = await create();
  const saved = await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 1,
    changes: [{ kind: "moved", moves: [{ source: "1:S02", to: { dayId: "1", code: "S03", areaId: "B" } }] }] }, owner), id);
  assert.equal(saved.status, 200, await saved.clone().text());
  const response = await submit(id);
  assert.equal(response.status, 422, await response.clone().text());
  assert.equal(await repo.getOrganizerSubmissionSnapshot(id, 2), null);
});

test("AMEND approval rejects a self-consistent hash for snapshot content that diverges from saved declarations", async () => {
  const id = await changed(); assert.equal((await submit(id)).status, 200);
  const snapshot = await repo.getOrganizerSubmissionSnapshot(id, 2);
  const content = JSON.parse(snapshot.snapshot_json);
  content.amendment.changes[0].circleName = "未送審社";
  content.import.rows[1].circleName = "未送審社";
  const text = JSON.stringify(content);
  await db.prepare("UPDATE organizer_submission_snapshots SET snapshot_json=?1,sha256=?2 WHERE id=?3")
    .bind(text,await sha256Hex(text),snapshot.id).run();
  const response = await review(id);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "snapshot_mismatch");
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  assert.equal((await repo.getOrganizerCandidate(id)).status, "submitted");
});

test("a settings-only correction is submitted and approved, and its settings cannot be swapped after submission", async () => {
  const id = await create();
  const settings = { name: "測試活動 改名", days: [{ id: "1", date: "2026-11-14" }] };
  assert.equal((await handlers.saveOrganizerAmendment(request("PUT", { expectedVersion: 1, changes: [], settings }, owner), id)).status, 200);
  const response = await submit(id);
  assert.equal(response.status, 200, await response.clone().text());
  const snapshot = await repo.getOrganizerSubmissionSnapshot(id, 2);
  const content = JSON.parse(snapshot.snapshot_json);
  assert.deepEqual(content.amendment.settings, settings);
  assert.deepEqual(content.draft, data.baseline.draft, "the submitted draft is still the published one");
  content.amendment.settings.name = "未送審名稱";
  const text = JSON.stringify(content);
  await db.prepare("UPDATE organizer_submission_snapshots SET snapshot_json=?1,sha256=?2 WHERE id=?3").bind(text, await sha256Hex(text), snapshot.id).run();
  const swapped = await review(id);
  assert.equal(swapped.status, 409); assert.equal((await swapped.json()).code, "snapshot_mismatch");
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  await db.prepare("UPDATE organizer_submission_snapshots SET snapshot_json=?1,sha256=?2 WHERE id=?3").bind(snapshot.snapshot_json, snapshot.sha256, snapshot.id).run();
  const approval = await review(id);
  assert.equal(approval.status, 200, await approval.clone().text());
  assert.equal((await repo.getLatestOrganizerPublicationJob(id)).snapshot_id, snapshot.id);
});

test("Owner revocation between validation and snapshot commit prevents submission", async (t) => {
  const id = await changed();
  const original = repo.storeOrganizerSubmissionSnapshot;
  t.after(() => { repo.storeOrganizerSubmissionSnapshot = original; });
  repo.storeOrganizerSubmissionSnapshot = async (input) => {
    await db.prepare("UPDATE organizer_event_grants SET revoked_at=?1 WHERE candidate_id=?2 AND account_id=?3").bind(data.now,id,ownerId).run();
    return original(input);
  };
  assert.equal((await submit(id)).status, 409);
  assert.equal(await repo.getOrganizerSubmissionSnapshot(id, 2), null);
  assert.equal((await repo.getOrganizerCandidate(id)).status, "draft");
});

test("Admin revocation after request authentication prevents approval and every dependent write", async (t) => {
  const id = await changed(); assert.equal((await submit(id)).status, 200);
  const original = repo.reviewOrganizerCandidate;
  t.after(() => { repo.reviewOrganizerCandidate = original; });
  repo.reviewOrganizerCandidate = async (input) => {
    await db.prepare("DELETE FROM admins WHERE email='admin@example.test'").run();
    return original(input);
  };
  assert.equal((await review(id)).status, 409);
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM organizer_event_reviews WHERE candidate_id=?1").bind(id).first()).count, 0);
  assert.equal((await repo.getOrganizerCandidate(id)).status, "submitted");
});


test("Admin revocation at the review transaction boundary leaves no review, job or candidate transition", async () => {
  const id = await changed(); assert.equal((await submit(id)).status, 200);
  const snapshot = await repo.getOrganizerSubmissionSnapshot(id,2);
  let armed = false, intercepted = false;
  const guarded = createIdentityRepository({ prepare: db.prepare.bind(db), exec: db.exec.bind(db), batch: async (statements) => {
    if (armed) {
      armed = false; intercepted = true;
      await db.prepare("DELETE FROM admins WHERE email='admin@example.test'").run();
    }
    return db.batch(statements);
  } });
  await guarded.ensureTables(); armed = true;
  const actor = await db.prepare("SELECT id FROM accounts WHERE email='admin@example.test'").first();
  const response = await guarded.reviewOrganizerCandidate({ candidateId:id, expectedVersion:2, decision:"approve", actorAccountId:actor.id,
    publication:{ jobId:"revoked-review", snapshotId:snapshot.id, approvalHash:snapshot.sha256 }, now:data.now });
  assert.equal(intercepted,true); assert.equal(response.ok,false);
  assert.equal((await repo.getOrganizerCandidate(id)).status, "submitted");
  assert.equal(await repo.getLatestOrganizerPublicationJob(id), null);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM organizer_event_reviews WHERE candidate_id=?1").bind(id).first()).count,0);
});

test("Owner revocation at snapshot INSERT cannot leave an unauthorized immutable snapshot", async () => {
  const id = await changed();
  let intercepted = false;
  const wrap = (statement, sql) => new Proxy(statement, { get(target,key) {
    if (key === "bind") return (...values) => wrap(target.bind(...values),sql);
    if (key === "run" && sql.includes("INSERT INTO organizer_submission_snapshots")) return async () => {
      intercepted = true;
      await db.prepare("UPDATE organizer_event_grants SET revoked_at=?1 WHERE candidate_id=?2 AND account_id=?3").bind(data.now,id,ownerId).run();
      return target.run();
    };
    return typeof target[key] === "function" ? target[key].bind(target) : target[key];
  } });
  const guarded = createIdentityRepository({ prepare: (sql) => wrap(db.prepare(sql),sql), batch: db.batch.bind(db), exec: db.exec.bind(db) });
  await guarded.ensureTables();
  const response = await guarded.storeOrganizerSubmissionSnapshot({ candidateId:id,candidateVersion:2,actorAccountId:ownerId,
    snapshotJson:"{}",sha256:await sha256Hex("{}"),now:data.now });
  assert.equal(intercepted,true); assert.equal(response.ok,false);
  assert.equal(await repo.getOrganizerSubmissionSnapshot(id,2),null);
  assert.equal((await repo.getOrganizerCandidate(id)).status,"draft");
});


const originalPlan = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function sourceBackground() {
  const map = data.baseline.maps[0];
  await db.prepare(`INSERT INTO map_drafts (id,event_id,candidate_id,period_key,venue_space_id,owner_account_id,status,current_revision,created_at,updated_at,last_activity_at)
    VALUES (?1,'event-alpha','source',?2,?3,?4,'draft',1,?5,?5,?5)`).bind(map.id,map.periodKey,map.venueSpaceId,ownerId,data.now).run();
  await db.prepare("INSERT INTO map_draft_revisions (id,draft_id,revision,content_json,created_by,created_at) VALUES ('source-map-revision',?1,1,?2,?3,?4)")
    .bind(map.id,JSON.stringify(map.content),ownerId,data.now).run();
  const key = `organizer-map-backgrounds/source/${map.id}`;
  backgroundObjects.set(key,{ bytes:originalPlan,contentType:"image/png" });
  return key;
}
const background = (id,map,cookie = owner) => handlers.getOrganizerMapBackground(request("GET",undefined,cookie),id,map);

test("an existing amendment inherits the private source plan; replacement changes only its own plan without revising content", async () => {
  const id = await create(); // The fix also works for candidates made before source inheritance was implemented.
  const [map] = await repo.listOrganizerMapDrafts(id);
  const key = await sourceBackground();
  const before = await repo.getOrganizerCandidate(id);
  const mapBefore = await repo.getOrganizerMapDraft(id,map.id);
  // A new collaborator inherits the source aid through their authorized amendment,
  // even when they are not a collaborator on the old published candidate.
  await db.prepare("UPDATE organizer_event_grants SET revoked_at=?1 WHERE candidate_id='source' AND account_id=?2").bind(data.now,ownerId).run();
  const read = await background(id,map.id);
  assert.equal(read.status,200);
  assert.equal(read.headers.get("cache-control"),"private, no-store");
  assert.equal(read.headers.get("x-content-type-options"),"nosniff");
  assert.equal(read.headers.get("content-type"),"image/png");
  assert.deepEqual(Buffer.from(await read.arrayBuffer()),originalPlan);
  assert.deepEqual([...backgroundObjects.keys()],[key],"GET must not copy bytes or extend source retention");
  const form = new FormData();
  const replacement = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==","base64");
  form.append("file",new File([replacement],"replacement.webp",{type:"image/webp"}));
  const upload = await handlers.putOrganizerMapBackground(new Request(`${origin}/api/organizer/events/${id}/maps/${map.id}/background`,{
    method:"PUT",headers:{origin,cookie:owner},body:form }),id,map.id);
  assert.equal(upload.status,200,await upload.clone().text());
  backgroundReads.length = 0;
  const own = await background(id,map.id);
  assert.equal(own.headers.get("content-type"),"image/webp");
  assert.deepEqual(Buffer.from(await own.arrayBuffer()),replacement);
  assert.deepEqual(backgroundReads,[`organizer-map-backgrounds/${id}/${map.id}`]);
  assert.deepEqual(backgroundObjects.get(key).bytes,originalPlan);
  assert.deepEqual(await repo.getOrganizerCandidate(id),before);
  assert.deepEqual(await repo.getOrganizerMapDraft(id,map.id),mapBefore);
});

test("background inheritance cannot use unauthorized candidates, another map scope or removed source data", async () => {
  const id = await create(); const [map] = await repo.listOrganizerMapDrafts(id); const key = await sourceBackground();
  for (const [cookie,status] of [[null,401],[stranger,404]]) assert.equal((await background(id,map.id,cookie)).status,status);
  assert.equal((await background(id,data.baseline.maps[0].id)).status,404,"a source map id is not a child map id");
  assert.equal(backgroundReads.length,0,"authorization and map binding precede every bucket read");
  await db.prepare("UPDATE map_drafts SET venue_space_id='another-hall' WHERE id=?1").bind(data.baseline.maps[0].id).run();
  assert.equal((await background(id,map.id)).status,404);
  assert.ok(!backgroundReads.includes(key),"a source outside the child's approved scope is not read");
  await db.prepare("UPDATE map_drafts SET venue_space_id=?1 WHERE id=?2").bind(map.venue_space_id,data.baseline.maps[0].id).run();
  backgroundObjects.get(key).contentType = "text/html";
  assert.equal((await background(id,map.id)).status,404,"inherited objects retain the image MIME allowlist");
  backgroundObjects.delete(key);
  assert.equal((await background(id,map.id)).status,404,"retention-deleted source bytes are not recreated");
});

test("successive amendments follow published same-scope sources and reject cyclic lineage", async () => {
  const key = await sourceBackground();
  const first = await create(); const [firstMap] = await repo.listOrganizerMapDrafts(first);
  // Isolated historical fixture, not a claim of publication through the UI.
  await db.prepare("UPDATE organizer_event_candidates SET status='published',published_version=1,published_at=?1 WHERE id=?2").bind(data.now,first).run();
  const second = await create(); const [secondMap] = await repo.listOrganizerMapDrafts(second);
  const baseline = structuredClone(data.baseline);
  baseline.source.candidateId = first;
  baseline.maps[0].id = firstMap.id;
  const text = JSON.stringify(baseline);
  await db.prepare("UPDATE organizer_amendments SET source_candidate_id=?1,baseline_json=?2,baseline_sha256=?3 WHERE candidate_id=?4")
    .bind(first,text,await sha256Hex(text),second).run();
  const result = await background(second,secondMap.id);
  assert.equal(result.status,200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),originalPlan);
  assert.deepEqual(backgroundReads,[`organizer-map-backgrounds/${second}/${secondMap.id}`,`organizer-map-backgrounds/${first}/${firstMap.id}`,key]);
  const cycle = structuredClone(baseline); cycle.source.candidateId = second; cycle.maps[0].id = secondMap.id;
  const cycleText = JSON.stringify(cycle);
  await db.prepare("UPDATE organizer_amendments SET source_candidate_id=?1,baseline_json=?2,baseline_sha256=?3 WHERE candidate_id=?4")
    .bind(second,cycleText,await sha256Hex(cycleText),first).run();
  assert.equal((await background(second,secondMap.id)).status,404);
});
