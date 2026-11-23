import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { purgeExpiredRecords, RETENTION_WINDOWS } = await environment.runner.import("/db/retention-purge.ts");

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
  accountId = await repository.upsertAccount("organizer@example.test", NOW - 200 * DAY);
});

test("purging a candidate map takes the layout plan it was traced from with it", async () => {
  const inactive = NOW - RETENTION_WINDOWS.mapDraftInactivity - DAY;
  await database.prepare(
    `INSERT INTO map_drafts (id, event_id, period_key, venue_space_id, owner_account_id, status, current_revision, created_at, updated_at, last_activity_at, candidate_id)
     VALUES ('candidate-map', 'ff47', '1', 'hall', ?1, 'draft', 1, ?2, ?2, ?2, 'candidate-a')`,
  ).bind(accountId, inactive).run();
  await assert.rejects(() => purgeExpiredRecords(database, NOW, RETENTION_WINDOWS), /Private map evidence bucket/,
    "a plan that cannot be proven gone must not let the row go first");

  const deleted = [];
  await purgeExpiredRecords(database, NOW, RETENTION_WINDOWS, undefined, {
    delete: async (keys) => deleted.push(...(Array.isArray(keys) ? keys : [keys])),
  });
  assert.deepEqual(deleted, ["organizer-map-backgrounds/candidate-a/candidate-map"]);
  assert.equal(await database.prepare("SELECT id FROM map_drafts WHERE id = 'candidate-map'").first(), null);
});
