import assert from "node:assert/strict";
import test, { after } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer } from "vite";
import { organizerRepositoryFixtureScript, resetOrganizerRepositoryFixture } from "./support/organizer-repository-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
after(() => vite.close());
const { createIdentityRepository } = await vite.environments.ssr.runner.import("/db/identity-repository.ts");
const { IDENTITY_TABLES } = await vite.environments.ssr.runner.import("/db/identity-runtime-schema.ts");
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
  script: await organizerRepositoryFixtureScript(),
  d1Databases: { DB: "fixture-worker", BASELINE: "fixture-node" },
}));
after(() => runtime.dispose());
const actualDb = await runtime.getD1Database("DB");
const baselineDb = await runtime.getD1Database("BASELINE");
const baseline = createIdentityRepository(baselineDb);
const actual = createIdentityRepository(actualDb);

// The old hook is the reference. Account UUIDs differ between isolated DBs;
// preserve their role relationships while comparing all other stored values.
async function nodeFixture(now) {
  await baseline.ensureTables();
  await baseline.clearPreviewData();
  const adminId = await baseline.upsertAccount("admin@example.test", now);
  await baseline.addAdmin("admin@example.test", "bootstrap", now);
  const ownerId = await baseline.upsertAccount("owner@example.test", now);
  const editorId = await baseline.upsertAccount("editor@example.test", now);
  return { adminId, ownerId, editorId };
}

async function snapshot(db, accounts) {
  assert.equal(new Set(Object.values(accounts)).size, 3);
  for (const id of Object.values(accounts)) assert.equal(typeof id, "string");
  const roles = new Map(Object.entries(accounts).map(([role, id]) => [id, role]));
  const tables = await db.batch(IDENTITY_TABLES.map(({ name }) => db.prepare(`SELECT * FROM ${name}`)));
  return Object.fromEntries(IDENTITY_TABLES.map(({ name }, index) => [name, tables[index].results
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, roles.get(value) ?? value])))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}

test("worker fixture matches the old hook and clears previous-case state while retaining admins", async () => {
  const now = 1_788_000_000_000;
  const first = await resetOrganizerRepositoryFixture(runtime, now);
  const expected = await nodeFixture(now);
  assert.deepEqual(await snapshot(actualDb, first), await snapshot(baselineDb, expected));

  for (const [repo, db, ids] of [[actual, actualDb, first], [baseline, baselineDb, expected]]) {
    await repo.addAdmin("retained@example.test", "fixture", now);
    await repo.createOrganizerCandidate({ id: "leftover", tentativeName: "Previous case", ownerEmail: "owner@example.test",
      createdByAccountId: ids.adminId, draftJson: "{}", now });
    await repo.upsertAccount("leftover@example.test", now);
    await db.batch([
      db.prepare("UPDATE organizer_venues SET name = name || ' changed'"),
      db.prepare("DELETE FROM organizer_reference_records"),
    ]);
  }
  const next = await resetOrganizerRepositoryFixture(runtime, now + 1000);
  const nextExpected = await nodeFixture(now + 1000);
  const resetState = await snapshot(actualDb, next);
  assert.deepEqual(resetState, await snapshot(baselineDb, nextExpected));
  assert.notEqual(next.adminId, first.adminId, "accounts must be recreated for each case");
  assert.deepEqual(resetState.organizer_event_candidates, []);
  assert.deepEqual(resetState.audit_log, []);
  assert.equal(resetState.accounts.length, 3);
  assert.ok(resetState.admins.some((row) => row.email === "retained@example.test"));
  assert.ok(resetState.organizer_reference_records.length > 0, "the reference catalog must be reseeded");
});

test("fixture setup failures reject before a test can use stale account IDs", async () => {
  // Omit the DB binding to exercise a real worker-side setup error.
  const broken = new Miniflare(convertV4MiniflareOptions({ modules: true, script: await organizerRepositoryFixtureScript() }));
  try {
    await assert.rejects(resetOrganizerRepositoryFixture(broken, 1_788_000_000_000), /Organizer fixture reset failed \(500\)/);
  } finally { await broken.dispose(); }
});
