import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const { createIdentityRepository } = await vite.environments.ssr.runner.import("/db/identity-repository.ts");
const { IDENTITY_TABLES } = await vite.environments.ssr.runner.import("/db/identity-runtime-schema.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
  script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "amendment-candidates", LEGACY: "amendment-legacy" } }));
const db = await mf.getD1Database("DB");
const repository = createIdentityRepository(db);
after(async () => { await mf.dispose(); await vite.close(); });
before(() => repository.ensureTables());
const now = 1789440000000;
const hash = "a".repeat(64);
const commit = "b".repeat(40);
const draftJson = JSON.stringify({ schema: "organizer-event-draft/1", event: { id: "event-alpha", name: "活動", days: [] }, venue: { assignments: [] }, officialSource: { label: "官方", url: "https://organizer.invalid" } });
const rows = [{ sourceRow: 1, dayId: "1", venueSpaceId: "hall", areaId: "A", codes: ["A01", "A02"], circleName: "甲社", stableKey: null, identityGroup: null }];
const owner = { accountId: "owner", role: "owner", admin: false, now };
const editor = { accountId: "editor", role: "editor", admin: false, now };
const admin = { accountId: "admin", role: "admin", admin: true, now };
const createInput = (extra = {}) => ({ id: "amendment", sourceCandidateId: "source", sourceVersion: 1,
  sourceJobId: "published-job", sourceSnapshotId: "published-snapshot", sourceApprovalHash: hash, sourceMainCommit: commit,
  eventId: "event-alpha", draftJson, baselineJson: '{"fixed":"baseline"}', baselineSha256: hash,
  rows, maps: [{ periodKey: "1", venueSpaceId: "hall", content: { schema: "map-contribution-draft/1", layout: { copied: true } } }], actor: owner, ...extra });
const saveInput = (extra = {}) => ({ candidateId: "amendment", expectedVersion: 1, baselineSha256: hash,
  changesJson: '[{"kind":"released","sources":["1:A01","1:A02"],"circleName":"乙社"}]', changesSha256: "c".repeat(64),
  rows: [{ ...rows[0], circleName: "乙社" }], actor: owner, ...extra });
beforeEach(async () => {
  await repository.clearPreviewData();
  await db.prepare("INSERT INTO accounts (id,email,created_at) VALUES ('admin','admin@example.test',?1)").bind(now).run();
  await repository.addAdmin("admin@example.test", "bootstrap", now);
  await repository.createOrganizerCandidate({ id: "source", tentativeName: "活動", ownerEmail: "owner@example.test", createdByAccountId: "admin", draftJson, now });
  await db.prepare("UPDATE organizer_event_candidates SET event_id = 'event-alpha', event_id_locked_at = ?1, status = 'published', published_version = 1, published_at = ?1 WHERE id = 'source'").bind(now).run();
  for (const actor of [owner, editor]) await db.prepare(`INSERT INTO organizer_event_grants (id,candidate_id,account_id,role,granted_by,granted_at)
    VALUES (?1,'source',?2,?3,'admin',?4)`).bind(crypto.randomUUID(), actor.accountId, actor.role, now).run();
  await db.prepare(`INSERT INTO organizer_submission_snapshots (id,candidate_id,candidate_version,snapshot_json,sha256,created_by,created_at)
    VALUES ('published-snapshot','source',1,'{}',?1,'owner',?2)`).bind(hash, now).run();
  await db.prepare(`INSERT INTO organizer_publication_jobs (id,candidate_id,candidate_version,snapshot_id,approval_hash,status,step,main_merge_sha,created_at,updated_at)
    VALUES ('published-job','source',1,'published-snapshot',?1,'published','completed',?2,?3,?3)`).bind(hash, commit, now).run();
});
const count = async (table, where = "1=1") => (await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`).first()).count;

test("Owner creates a separate amendment with copied map, import and grants; published source remains immutable", async () => {
  const before = await repository.getOrganizerCandidate("source");
  assert.deepEqual(await repository.createOrganizerAmendment(createInput()), { ok: true, candidateId: "amendment", version: 1 });
  const candidate = await repository.getOrganizerCandidate("amendment");
  assert.equal(candidate.publication_operation, "AMEND");
  assert.equal(candidate.status, "draft");
  assert.equal(candidate.event_id, "event-alpha");
  assert.equal(candidate.event_id_locked_at, now);
  assert.deepEqual(await repository.getOrganizerCandidate("source"), before);
  assert.equal(await repository.organizerRole("amendment", "owner"), "owner");
  assert.equal(await repository.organizerRole("amendment", "editor"), "editor");
  const amendment = await repository.getOrganizerAmendment("amendment");
  assert.equal(amendment.baseline_json, createInput().baselineJson);
  assert.equal(amendment.changes_json, "[]");
  assert.equal(amendment.changes_version, 1);
  assert.deepEqual((await repository.getOrganizerImport("amendment")).rows[0].codes, ["A01", "A02"]);
  assert.equal((await repository.listOrganizerMapDrafts("amendment")).length, 1);
  assert.equal(await count("audit_log", "action = 'organizer.amendment.create'"), 1);
});

test("Editor cannot create; Admin may create without granting themselves event ownership", async () => {
  assert.deepEqual(await repository.createOrganizerAmendment(createInput({ actor: editor })), { ok: false });
  assert.equal(await count("organizer_amendments"), 0);
  assert.equal(await count("map_drafts"), 0);
  assert.equal(await count("organizer_import_sources"), 0);
  assert.equal(await count("audit_log"), 0);
  assert.equal((await repository.createOrganizerAmendment(createInput({ actor: admin }))).ok, true);
  assert.equal(await repository.organizerRole("amendment", "admin"), null);
  assert.equal(await repository.organizerRole("amendment", "owner"), "owner");
});

test("stale source, approval mismatch and revoked Owner cannot create partial candidates", async () => {
  for (const extra of [{ sourceVersion: 2 }, { sourceApprovalHash: "d".repeat(64) }, { sourceMainCommit: "e".repeat(40) }, { eventId: "another-event" }]) {
    assert.deepEqual(await repository.createOrganizerAmendment(createInput(extra)), { ok: false });
  }
  await db.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = 'source' AND account_id = 'owner'").bind(now).run();
  assert.deepEqual(await repository.createOrganizerAmendment(createInput()), { ok: false });
  assert.equal(await count("organizer_event_candidates"), 1);
  assert.equal(await count("organizer_amendments"), 0);
  assert.equal(await count("organizer_amendment_changes"), 0);
});

test("Admin revocation is rechecked inside both mutation batches without partial copies or saves", async () => {
  await repository.addAdmin("backup@example.test", "admin@example.test", now);
  assert.equal(await repository.removeAdmin("admin@example.test"), "removed");
  assert.deepEqual(await repository.createOrganizerAmendment(createInput({ actor: admin })), { ok: false });
  for (const table of ["organizer_amendments", "organizer_amendment_changes", "organizer_import_sources", "map_drafts", "audit_log"]) {
    assert.equal(await count(table), 0);
  }
  assert.equal((await repository.createOrganizerAmendment(createInput())).ok, true);
  const before = await repository.getOrganizerImport("amendment");
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput({ actor: admin })), { ok: false });
  assert.deepEqual(await repository.getOrganizerImport("amendment"), before);
  assert.equal((await repository.getOrganizerCandidate("amendment")).current_version, 1);
  assert.equal(await count("organizer_amendment_changes"), 1);
  assert.equal(await count("audit_log", "action = 'organizer.amendment.save'"), 0);
  await repository.addAdmin("admin@example.test", "backup@example.test", now);
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput({ actor: admin })), { ok: true, version: 2 });
});

test("concurrent creations keep one active amendment without weakening CREATE collisions", async () => {
  const results = await Promise.all([repository.createOrganizerAmendment(createInput()), repository.createOrganizerAmendment(createInput({ id: "second" }))]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(await count("organizer_amendments"), 1);
  assert.equal(await count("organizer_event_candidates"), 2);
  await assert.rejects(db.prepare(`INSERT INTO organizer_event_candidates
    (id,tentative_name,event_id,current_draft_json,created_by,created_at,updated_at,last_updated_by,last_updated_role)
    VALUES ('duplicate','Duplicate','event-alpha','{}','admin',1,1,'admin','admin')`).run(), /UNIQUE/);
});

test("declaration save atomically versions changes and derived import while preserving baseline and original candidate", async () => {
  await repository.createOrganizerAmendment(createInput());
  const before = await repository.getOrganizerCandidate("source");
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput({ actor: editor })), { ok: true, version: 2 });
  const amendment = await repository.getOrganizerAmendment("amendment");
  assert.equal(amendment.baseline_json, createInput().baselineJson);
  assert.equal(amendment.baseline_sha256, hash);
  assert.equal(amendment.changes_json, saveInput().changesJson);
  assert.equal(amendment.changes_version, 2);
  assert.equal(await count("organizer_amendment_changes"), 2);
  assert.equal((await repository.getOrganizerImport("amendment")).rows[0].circle_name, "乙社");
  assert.equal((await repository.getOrganizerCandidate("amendment")).current_version, 2);
  assert.deepEqual(await repository.getOrganizerCandidate("source"), before);
});

test("same-version concurrent saves at the same millisecond cannot replace the winner's import or append false history", async () => {
  await repository.createOrganizerAmendment(createInput());
  const results = await Promise.all([repository.saveOrganizerAmendment(saveInput()), repository.saveOrganizerAmendment(saveInput({ changesJson: '[]', rows }))]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const amendment = await repository.getOrganizerAmendment("amendment");
  const expectedName = amendment.changes_json === "[]" ? "甲社" : "乙社";
  assert.equal((await repository.getOrganizerImport("amendment")).rows[0].circle_name, expectedName);
  assert.equal(await count("organizer_import_sources", "replaced_at IS NULL"), 1);
  assert.equal(await count("organizer_amendment_changes"), 2);
  assert.equal(await count("audit_log", "action = 'organizer.amendment.save'"), 1);
});

test("stale baseline, revoked editor and locked state refuse saves without retiring the current import", async () => {
  await repository.createOrganizerAmendment(createInput());
  const before = await repository.getOrganizerImport("amendment");
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput({ baselineSha256: "z".repeat(64) })), { ok: false });
  await db.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = 'amendment' AND account_id = 'editor'").bind(now).run();
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput({ actor: editor })), { ok: false });
  await db.prepare("UPDATE organizer_event_candidates SET status = 'submitted' WHERE id = 'amendment'").run();
  assert.deepEqual(await repository.saveOrganizerAmendment(saveInput()), { ok: false });
  assert.deepEqual(await repository.getOrganizerImport("amendment"), before);
  assert.equal(await count("organizer_amendment_changes"), 1);
  assert.equal(await count("audit_log", "action = 'organizer.amendment.save'"), 0);
});

test("the legacy event unique index upgrades atomically and old CREATE IF NOT EXISTS cannot restore it", async () => {
  const legacy = await mf.getD1Database("LEGACY");
  const oldColumns = IDENTITY_TABLES.find((table) => table.name === "organizer_event_candidates").columns.filter((column) => !column.startsWith("publication_operation "));
  await legacy.prepare(`CREATE TABLE organizer_event_candidates (${oldColumns.join(",")})`).run();
  const oldIndex = "CREATE UNIQUE INDEX IF NOT EXISTS organizer_candidates_event_id_idx ON organizer_event_candidates (event_id) WHERE event_id IS NOT NULL";
  await legacy.prepare(oldIndex).run();
  await legacy.prepare(`INSERT INTO organizer_event_candidates (id,tentative_name,event_id,current_draft_json,created_by,created_at,updated_at,last_updated_by,last_updated_role)
    VALUES ('old','Old','event-alpha','{}','admin',1,1,'admin','admin')`).run();
  await createIdentityRepository(legacy).ensureTables();
  await createIdentityRepository(legacy).ensureTables();
  assert.equal((await legacy.prepare("SELECT publication_operation FROM organizer_event_candidates WHERE id='old'").first()).publication_operation, "CREATE");
  await legacy.prepare(oldIndex).run();
  assert.match((await legacy.prepare("SELECT sql FROM sqlite_master WHERE name='organizer_candidates_event_id_idx'").first()).sql, /publication_operation/);
  const insert = (id, operation) => legacy.prepare(`INSERT INTO organizer_event_candidates
    (id,tentative_name,event_id,current_draft_json,created_by,created_at,updated_at,last_updated_by,last_updated_role,publication_operation)
    VALUES (?1,'New','event-alpha','{}','admin',1,1,'admin','admin',?2)`).bind(id, operation).run();
  await assert.rejects(insert("new-create", "CREATE"), /UNIQUE/);
  await insert("new-amend", "AMEND");
  await assert.rejects(insert("duplicate-amend", "AMEND"), /UNIQUE/);
});

test("ordinary candidate saves, imports and approval cannot bypass the amendment-only path", async () => {
  await repository.createOrganizerAmendment(createInput());
  assert.equal((await repository.saveOrganizerCandidate({ candidateId: "amendment", actorAccountId: "owner", expectedVersion: 1, eventId: "event-alpha", draftJson, now })).ok, false);
  assert.equal((await repository.replaceOrganizerImport({ candidateId: "amendment", actorAccountId: "owner", expectedVersion: 1, source: {}, rows, now })).ok, false);
  assert.equal((await repository.submitOrganizerCandidate({ candidateId: "amendment", actorAccountId: "owner", expectedVersion: 1, now })).ok, false);
  assert.equal((await repository.reviewOrganizerCandidate({ candidateId: "amendment", actorAccountId: "admin", expectedVersion: 1, decision: "approve", now })).ok, false);
  assert.equal((await repository.getOrganizerCandidate("amendment")).current_version, 1);
  assert.equal((await repository.getOrganizerAmendment("amendment")).changes_json, "[]");
});
