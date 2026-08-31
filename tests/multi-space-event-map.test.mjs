import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const { parseEventMapManifest } = await environment.runner.import("/app/event-map-manifest.ts");
const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
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
