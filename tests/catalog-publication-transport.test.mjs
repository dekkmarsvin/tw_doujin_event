import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, afterEach } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { loadStaticCircleCatalog } = await environment.runner.import("/app/static-circle-catalog-client.ts");
const { loadStaticCircleOverrides } = await environment.runner.import("/app/static-circle-overrides-client.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
after(() => vite.close());

const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
const overrides = { schema: "circle-overrides/1", eventId: "sample", generatedAt: "2026-08-14", revision: 1, overrides: [] };

test("production HTTP adapters validate event identity and expose response cache metadata", async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const isOverlay = String(url).endsWith("overrides.json");
    return new Response(JSON.stringify(isOverlay ? overrides : catalog), {
      headers: {
        "content-type": "application/json",
        "cache-control": isOverlay ? "public, max-age=60, must-revalidate" : "public, max-age=300, must-revalidate",
        etag: isOverlay ? '"overlay-1"' : '"base-1"',
      },
    });
  };
  const base = await loadStaticCircleCatalog("sample");
  const overlay = await loadStaticCircleOverrides("sample");
  assert.deepEqual(requests, ["/data/events/sample/circles.json", "/data/events/sample/overrides.json"]);
  assert.equal(base.cacheControl, "public, max-age=300, must-revalidate");
  assert.equal(overlay.cacheControl, "public, max-age=60, must-revalidate");
  assert.equal(overlay.etag, '"overlay-1"');
});

test("production HTTP adapters reject valid payloads from a different event", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("overrides.json")
    ? { ...overrides, eventId: "other" }
    : { ...catalog, eventId: "other" }), { headers: { "content-type": "application/json" } });
  await assert.rejects(loadStaticCircleCatalog("sample"), /不是要求的 sample/);
  await assert.rejects(loadStaticCircleOverrides("sample"), /不是要求的 sample/);
});
