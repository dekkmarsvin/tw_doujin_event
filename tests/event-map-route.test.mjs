import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createEventMapRepository } = await environment.runner.import("/db/event-map-repository.ts");
const { createEventMapHandlers } = await environment.runner.import("/app/event-map-route-handlers.ts");
const miniflare = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "event-map-test" },
});
const database = await miniflare.getD1Database("DB");
const repository = createEventMapRepository(database);
const handlers = createEventMapHandlers(repository);
after(async () => { await miniflare.dispose(); await vite.close(); });

const layout = {
  version: 2,
  template: "test-hall",
  width: 100,
  height: 80,
  floor: { x: 0, y: 0, width: 100, height: 80 },
  rows: [{ label: "Z", orientation: "horizontal", confidence: 1, slots: [{ code: "Z01", rect: { x: 10, y: 10, width: 8, height: 6 } }] }],
  pillars: [],
  accessPoints: [],
  landmarks: [],
};

function context(eventId) {
  return { params: Promise.resolve({ eventId }) };
}

function putRequest(sourceName) {
  return new Request("http://localhost/api/events/test-event/map", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName, confidence: .95, layout }) });
}

test("PUT persists a map for a later GET and increments revision on replacement", async () => {
  const firstPut = await handlers.PUT(putRequest("first.png"), context("test-event"));
  assert.equal(firstPut.status, 200);
  assert.equal((await firstPut.json()).map.revision, 1);

  const laterGet = await handlers.GET(new Request("http://localhost/api/events/test-event/map"), context("test-event"));
  assert.equal(laterGet.status, 200);
  const firstStored = (await laterGet.json()).map;
  assert.equal(firstStored.sourceName, "first.png");
  assert.equal(firstStored.layout.rows[0].slots[0].code, "Z01");
  assert.equal(laterGet.headers.get("cache-control"), "no-store");

  const secondPut = await handlers.PUT(putRequest("second.png"), context("test-event"));
  assert.equal(secondPut.status, 200);
  assert.equal((await secondPut.json()).map.revision, 2);
  assert.equal((await repository.getEventMap("test-event")).sourceName, "second.png");
});

test("route rejects invalid event ids and unpublishable payloads before writing", async () => {
  const badId = await handlers.GET(new Request("http://localhost/api/events/bad!/map"), context("bad!"));
  assert.equal(badId.status, 400);
  const lowConfidence = new Request("http://localhost/api/events/test-event/map", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: "bad.png", confidence: .4, layout }) });
  assert.equal((await handlers.PUT(lowConfidence, context("test-event"))).status, 400);
  assert.equal((await handlers.PUT(putRequest("incomplete-ff47.png"), context("ff47"))).status, 400);
});
