import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createCatalogPublication, subscribeOverlayResume } = await environment.runner.import("/app/catalog-publication.ts");
const records = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());
beforeEach(() => records.resetCircleCatalog());

const baseA = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
baseA.eventId = "event-a";
const baseB = structuredClone(baseA);
baseB.eventId = "event-b";
const overlay = (eventId, saleInfo = "overlay") => ({
  schema: "circle-overrides/1", eventId, generatedAt: "2026-08-14", revision: 1,
  overrides: [{ circleId: baseA.circles[0].id, updatedAt: "2026-08-14T00:00:00.000Z", fields: { saleInfo } }],
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
  assert.equal(publication.getSnapshot("event-a").catalog.circlesById.get(baseA.circles[0].id).saleInfo, "overlay");
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
  assert.equal(publication.getSnapshot("event-a").catalog.circlesById.get(baseA.circles[0].id).saleInfo, "event-a");
  assert.equal(publication.getSnapshot("event-b").catalog.circlesById.get(baseB.circles[0].id).saleInfo, "event-b");
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
    assert.equal(state.catalog.circles.length, baseA.circles.length);
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

test("resume refresh loads only overlays, shares per-event in-flight work and applies a clear", async () => {
  const calls = [];
  let next;
  const notice = { kind: "important", text: "活動取消", updatedAt: "2026-10-24T00:00:00.000Z" };
  const publication = createCatalogPublication({
    loadBase: async eventId => { calls.push(`base:${eventId}`); return resource(eventId === "event-a" ? baseA : baseB); },
    loadOverlay: async eventId => { calls.push(`overlay:${eventId}`); return next ? next.promise : resource({ ...overlay(eventId), notice }); },
  });
  await publication.refreshOverlay("event-a");
  assert.deepEqual(calls, [], "resume cannot start a base load");
  next = deferred();
  const loading = publication.load("event-a");
  assert.equal(publication.refreshOverlay("event-a"), loading);
  next.resolve(resource({ ...overlay("event-a"), notice }));
  await loading;
  next = undefined;
  await publication.load("event-b");
  assert.deepEqual(publication.getSnapshot("event-a").overrides.notice, notice);
  calls.length = 0;
  next = deferred();
  const refreshA = publication.refreshOverlay("event-a");
  assert.equal(publication.refreshOverlay("event-a"), refreshA);
  assert.equal(publication.load("event-a"), refreshA);
  const nextA = next;
  next = deferred();
  const refreshB = publication.refreshOverlay("event-b");
  assert.notEqual(refreshB, refreshA);
  // Resolve each event separately so their publication identities remain valid.
  nextA.resolve(resource(overlay("event-a", "updated supplement")));
  next.resolve(resource(overlay("event-b", "event-b updated supplement")));
  await Promise.all([refreshA, refreshB]);
  assert.deepEqual(calls.sort(), ["overlay:event-a", "overlay:event-b"]);
  assert.equal(Object.hasOwn(publication.getSnapshot("event-a").overrides, "notice"), false);
  assert.equal(publication.getSnapshot("event-a").catalog.circlesById.get(baseA.circles[0].id).saleInfo, "updated supplement");
  assert.equal(publication.getSnapshot("event-b").catalog.circlesById.get(baseB.circles[0].id).saleInfo, "event-b updated supplement");
});

test("failed refresh preserves the existing snapshot and metadata", async () => {
  let fail = false;
  const publication = createCatalogPublication({
    loadBase: async () => resource(baseA),
    loadOverlay: async () => { if (fail) throw new Error("offline"); return resource(overlay("event-a"), "max-age=60", '"old"'); },
  });
  await publication.load("event-a");
  const snapshot = publication.getSnapshot("event-a");
  const metadata = publication.getCacheMetadata("event-a");
  fail = true;
  await publication.refreshOverlay("event-a");
  assert.equal(publication.getSnapshot("event-a"), snapshot);
  assert.equal(publication.getCacheMetadata("event-a"), metadata);
});

test("resume subscribes only to visible and online events and unsubscribes both", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const document = new EventTarget();
  const window = new EventTarget();
  document.visibilityState = "hidden";
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  try {
    let calls = 0;
    const stop = subscribeOverlayResume(() => { calls += 1; });
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls, 0);
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    assert.equal(calls, 2);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    assert.equal(calls, 2);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else delete globalThis.document;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
  }
});
