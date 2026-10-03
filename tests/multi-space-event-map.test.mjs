import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const event = JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url), "utf8"));
const references = JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url), "utf8"));
const multiEvent = { ...event, id: "multi-sample", venueAssignments: [
  { venueId: "sample-venue", venueSpaceId: "sample-hall", areaIds: ["north"] },
  { venueId: "sample-venue", venueSpaceId: "sample-south", areaIds: ["south"] },
] };
const multiReferences = [...references, { ...references.find(({ schema }) => schema === "venue-space/1"), id: "sample-south", name: "南館" }];
const injectedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__PUBLISHED_EVENTS__");
Object.defineProperty(globalThis, "__PUBLISHED_EVENTS__", { configurable: true, value: [
  { definition: event, references }, { definition: multiEvent, references: multiReferences },
] });
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const { parseEventMapManifest } = await environment.runner.import("/app/event-map-manifest.ts");
const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
const { loadStaticEventMapResource } = await environment.runner.import("/app/static-event-map-client.ts");
if (injectedDescriptor) Object.defineProperty(globalThis, "__PUBLISHED_EVENTS__", injectedDescriptor);
else delete globalThis.__PUBLISHED_EVENTS__;
after(() => vite.close());

const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
const map = JSON.parse(await readFile(new URL("../fixtures/events/sample/map.json", import.meta.url), "utf8"));

test("map manifest rejects traversal, path drift and duplicate scopes", () => {
  const valid = { schema: "event-map-manifest/1", eventId: "sample", maps: [
    { periodKey: "1", venueSpaceId: "hall-a", path: "maps/1/hall-a.json" },
  ] };
  assert.deepEqual(parseEventMapManifest(valid, "sample"), valid);
  assert.throws(() => parseEventMapManifest({ ...valid, maps: [{ ...valid.maps[0], periodKey: ".." }] }), /unsafe path/);
  assert.throws(() => parseEventMapManifest({ ...valid, maps: [{ ...valid.maps[0], path: "map.json" }] }), /must be maps\/1\/hall-a.json/);
  assert.throws(() => parseEventMapManifest({ ...valid, maps: [valid.maps[0], valid.maps[0]] }), /duplicate scope/);
});

test("staging requires exact day by venue-space coverage for a multi-space event", () => {
  const multiEvent = structuredClone(event);
  multiEvent.venueAssignments = [
    { venueId: "sample-venue", venueSpaceId: "sample-hall", areaIds: ["north"] },
    { venueId: "sample-venue", venueSpaceId: "sample-south", areaIds: ["south"] },
  ];
  const multiReferences = structuredClone(references);
  multiReferences.push({
    ...structuredClone(multiReferences.find(({ schema }) => schema === "venue-space/1")),
    id: "sample-south",
    name: "南館",
  });
  const entries = [1, 2].flatMap((periodKey) => ["sample-hall", "sample-south"].map((venueSpaceId) => ({
    periodKey: String(periodKey), venueSpaceId, path: `maps/${periodKey}/${venueSpaceId}.json`,
  })));
  const manifest = { schema: "event-map-manifest/1", eventId: "sample", maps: entries };
  const maps = new Map(entries.map(({ path }) => [path, map]));
  const validated = validateStagedEventArtifacts(multiEvent, multiReferences, catalog, { manifest, maps }, "sample");
  assert.equal(validated.maps.length, 4);

  const incomplete = { ...manifest, maps: entries.slice(0, -1) };
  assert.throws(() => validateStagedEventArtifacts(multiEvent, multiReferences, catalog, { manifest: incomplete, maps }, "sample"), /cover every event day/);
});

test("shared fallback retains one artifact identity across dates; scoped paths stay distinct", async (t) => {
  let scoped = false;
  const entries = [1, 2].map((day) => ({ periodKey: String(day), venueSpaceId: "sample-hall", path: `maps/${day}/sample-hall.json` }));
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("map-manifest.json")) return scoped
      ? Response.json({ schema: "event-map-manifest/1", eventId: "sample", maps: entries })
      : new Response(null, { status: 404 });
    return Response.json(map);
  });
  const read = (day) => loadStaticEventMapResource("sample", { periodKey: String(day), venueSpaceId: "sample-hall" });
  assert.deepEqual(await read(1), { map, artifactKey: "sample/map.json" });
  assert.equal((await read(1)).artifactKey, (await read(2)).artifactKey);
  scoped = true;
  assert.deepEqual(await read(1), { map, artifactKey: "sample/maps/1/sample-hall.json" });
  assert.notEqual((await read(1)).artifactKey, (await read(2)).artifactKey);
});

test("a single-venue manifest network failure loads the cached shared map", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.endsWith("map-manifest.json")) throw new TypeError("Offline manifest");
    return Response.json(map);
  });
  assert.deepEqual(await loadStaticEventMapResource("sample", { periodKey: "1", venueSpaceId: "sample-hall" }), {
    map, artifactKey: "sample/map.json",
  });
  assert.deepEqual(calls, ["/data/events/sample/map-manifest.json", "/data/events/sample/map.json"]);
});

test("a single-venue manifest error response also tries the shared map", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => url.endsWith("map-manifest.json") ? Response.error() : Response.json(map));
  assert.deepEqual(await loadStaticEventMapResource("sample", { periodKey: "1", venueSpaceId: "sample-hall" }), {
    map, artifactKey: "sample/map.json",
  });
});

test("a multi-venue manifest network failure preserves the error without reading a shared map", async (t) => {
  const failure = new TypeError("Offline manifest");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.endsWith("map-manifest.json")) throw failure;
    return Response.json({ ...map, eventId: "multi-sample" });
  });
  await assert.rejects(loadStaticEventMapResource("multi-sample", { periodKey: "1", venueSpaceId: "sample-hall" }), (error) => error === failure);
  assert.deepEqual(calls, ["/data/events/multi-sample/map-manifest.json"]);
});

test("a multi-venue manifest error response cannot select a shared map", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return url.endsWith("map-manifest.json") ? Response.error() : Response.json({ ...map, eventId: "multi-sample" });
  });
  await assert.rejects(loadStaticEventMapResource("multi-sample", { periodKey: "1", venueSpaceId: "sample-hall" }), /Failed to fetch map manifest/);
  assert.deepEqual(calls, ["/data/events/multi-sample/map-manifest.json"]);
});

test("failed shared-map fallback preserves the original manifest network error", async (t) => {
  const failure = new TypeError("Offline manifest");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    throw url.endsWith("map-manifest.json") ? failure : new TypeError("Offline map");
  });
  await assert.rejects(loadStaticEventMapResource("sample", { periodKey: "1", venueSpaceId: "sample-hall" }), (error) => error === failure);
  assert.deepEqual(calls, ["/data/events/sample/map-manifest.json", "/data/events/sample/map.json"]);
});

test("a manifest HTTP failure cannot silently become a shared map", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return new Response(null, { status: 503 }); });
  await assert.rejects(loadStaticEventMapResource("sample", { periodKey: "1", venueSpaceId: "sample-hall" }), /503/);
  assert.equal(calls.length, 1);
});
