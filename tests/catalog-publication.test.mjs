import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createCatalogPublication } = await environment.runner.import("/app/catalog-publication.ts");
const records = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());
beforeEach(() => records.resetCircleCatalog());

const baseA = JSON.parse(await readFile(new URL("../public/data/events/ff47/circles.json", import.meta.url), "utf8"));
baseA.eventId = "event-a";
const baseB = structuredClone(baseA);
baseB.eventId = "event-b";
const overlay = (eventId, saleInfo = "overlay") => ({
  schema: "circle-overrides/1", eventId, generatedAt: "2026-08-14", revision: 1,
  overrides: [{ circleId: baseA.templates[0].id, updatedAt: "2026-08-14T00:00:00.000Z", fields: { saleInfo } }],
});
const resource = (payload, cacheControl = null, etag = null) => ({ payload, cacheControl, etag });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("base publishes before the optional overlay and cache metadata stays event-scoped", async () => {
  const overlayDeferred = deferred();
  const publication = createCatalogPublication({
    loadBase: async () => resource(baseA, "public, max-age=300, must-revalidate", '"base-a"'),
    loadOverlay: async () => overlayDeferred.promise,
  });
  const loading = publication.load("event-a");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const baseState = publication.getSnapshot("event-a");
  assert.equal(baseState.status, "ready");
  assert.equal(baseState.overlayStatus, "loading");
  assert.notEqual(baseState.catalog.circles[0].saleInfo, "overlay");

  overlayDeferred.resolve(resource(overlay("event-a"), "public, max-age=60, must-revalidate", '"overlay-a"'));
  await loading;
  assert.equal(publication.getSnapshot("event-a").overlayStatus, "applied");
  assert.equal(publication.getSnapshot("event-a").catalog.circlesById.get(baseA.templates[0].id).saleInfo, "overlay");
  assert.deepEqual(publication.getCacheMetadata("event-a"), {
    base: { cacheControl: "public, max-age=300, must-revalidate", etag: '"base-a"' },
    overlay: { cacheControl: "public, max-age=60, must-revalidate", etag: '"overlay-a"' },
  });
});

test("two events have independent state, listeners and one in-flight load each", async () => {
  const calls = [];
  const publication = createCatalogPublication({
    loadBase: async (eventId) => { calls.push(`base:${eventId}`); return resource(eventId === "event-a" ? baseA : baseB); },
    loadOverlay: async (eventId) => { calls.push(`overlay:${eventId}`); return resource(overlay(eventId, eventId)); },
  });
  let notificationsA = 0;
  let notificationsB = 0;
  const stopA = publication.subscribe("event-a", () => { notificationsA += 1; });
  const stopB = publication.subscribe("event-b", () => { notificationsB += 1; });
  await Promise.all([publication.load("event-a"), publication.load("event-a"), publication.load("event-b")]);
  stopA(); stopB();

  assert.deepEqual(calls.sort(), ["base:event-a", "base:event-b", "overlay:event-a", "overlay:event-b"]);
  assert.equal(publication.getSnapshot("event-a").eventId, "event-a");
  assert.equal(publication.getSnapshot("event-b").eventId, "event-b");
  assert.equal(publication.getSnapshot("event-a").catalog.circlesById.get(baseA.templates[0].id).saleInfo, "event-a");
  assert.equal(publication.getSnapshot("event-b").catalog.circlesById.get(baseB.templates[0].id).saleInfo, "event-b");
  assert.ok(notificationsA > 0 && notificationsB > 0);
});

test("overlay failure or identity mismatch keeps the complete reviewed base", async () => {
  for (const loadOverlay of [
    async () => { throw new Error("offline"); },
    async () => resource(overlay("event-b")),
  ]) {
    records.resetCircleCatalog();
    const publication = createCatalogPublication({ loadBase: async () => resource(baseA), loadOverlay });
    await publication.load("event-a");
    const state = publication.getSnapshot("event-a");
    assert.equal(state.status, "ready");
    assert.equal(state.overlayStatus, "unavailable");
    assert.equal(state.catalog.circles.length, baseA.templates.length);
  }
});

test("base identity mismatch fails closed while a later retry can recover", async () => {
  let correct = false;
  const publication = createCatalogPublication({
    loadBase: async () => resource(correct ? baseA : baseB),
    loadOverlay: async () => resource(overlay("event-a")),
  });
  await publication.load("event-a");
  assert.equal(publication.getSnapshot("event-a").status, "error");
  correct = true;
  await publication.retry("event-a");
  assert.equal(publication.getSnapshot("event-a").status, "ready");
  assert.equal(publication.getSnapshot("event-a").overlayStatus, "applied");
});
