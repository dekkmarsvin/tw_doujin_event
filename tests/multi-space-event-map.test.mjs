import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const { parseEventMapManifest } = await environment.runner.import("/app/event-map-manifest.ts");
const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
const { loadStaticEventMapResource } = await environment.runner.import("/app/static-event-map-client.ts");
after(() => vite.close());

const event = JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url), "utf8"));
const references = JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url), "utf8"));
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
  assert.equal((await read(1)).artifactKey, (await read(2)).artifactKey);
  scoped = true;
  assert.notEqual((await read(1)).artifactKey, (await read(2)).artifactKey);
});

test("an unavailable manifest cannot silently become a shared map", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return new Response(null, { status: 503 }); });
  await assert.rejects(loadStaticEventMapResource("sample", { periodKey: "1", venueSpaceId: "sample-hall" }), /503/);
  assert.equal(calls.length, 1);
});
