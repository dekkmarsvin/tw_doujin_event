import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const builder = await runner.import("/app/publication-artifacts.ts");
const { prepareOrganizerImport, parseOrganizerCsv } = await runner.import("/app/organizer-import.ts");
const { withOrganizerImportedAreaIds } = await runner.import("/app/organizer-event.ts");
const catalog = await runner.import("/app/organizer-reference-catalog.ts");
const { validateStagedEventArtifacts } = await runner.import("/app/staged-event-data.ts");
const { publishApprovedSnapshot } = await runner.import("/app/event-data-publisher.ts");
after(() => vite.close());
const hash = (text) => createHash("sha256").update(text).digest("hex");
const source = (snapshot) => { const snapshotJson = JSON.stringify(snapshot); return { snapshotJson, approvalHash: hash(snapshotJson) }; };
const now = Date.parse("2026-09-14T10:00:00.000Z");
const mapLayout = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout;

/** Publish into an in-memory event data bucket, starting from an empty
 * identity registry, and read back what readers get, checked the way the build
 * checks staged events. */
async function publishForReaders(approved) {
  let tag = 0;
  const store = new Map();
  const write = (key, text) => store.set(key, { text, etag: `e${++tag}` });
  write("index.json", JSON.stringify({ schema: "event-index/1", registry: "r0", events: [] }));
  write("registry/r0/allocations.json", JSON.stringify({ schema: "circle-id-allocations/1", nextSequence: 1, allocations: [] }));
  write("registry/r0/evidence.json", JSON.stringify({ schema: "circle-identity-evidence/1", entries: [] }));
  const bucket = {
    async get(key) { const object = store.get(key); return object ? { text: async () => object.text, etag: object.etag } : null; },
    async put(key, value, options = {}) {
      if (options.onlyIf && store.get(key)?.etag !== options.onlyIf.etagMatches) return null;
      write(key, value);
      return {};
    },
  };
  await publishApprovedSnapshot(bucket, { ...approved, candidateId: "candidate-next", candidateVersion: 8 }, () => now);
  const { version, files } = JSON.parse(store.get("index.json").text).events.find((entry) => entry.eventId === "next-event");
  // Readers only get files the index lists; anything else is a 404.
  const read = (file) => {
    assert.ok(files.includes(file), `${file} is not listed for readers`);
    return JSON.parse(store.get(`events/next-event/${version}/${file}`).text);
  };
  // One map is `map.json`; an event scoped by day or space lists its maps in a manifest.
  const manifest = files.includes("map-manifest.json") ? read("map-manifest.json") : null;
  validateStagedEventArtifacts(read("event.json"), read("reference-records.json"), read("circles.json"),
    manifest ? { manifest, maps: new Map(manifest.maps.map((map) => [map.path, read(map.path)])) } : read("map.json"), "next-event");
  read.files = files;
  return read;
}

async function sample({ days = 1 } = {}) {
  const organizer = catalog.createOrganizerReference({ name: "測試主辦", sourceUrl: "https://organizer.example/" }, now);
  const categories = catalog.createCategoryReference({ name: "官方分類", sourceUrl: "https://organizer.example/categories", categories: [{ label: "原創" }] }, organizer.id, now);
  const draft = {
    schema: "organizer-event-draft/1", event: { id: "next-event", name: "下一場活動", days: Array.from({ length: days }, (_, i) => ({ id: String(i + 1), label: `第 ${i + 1} 日`, date: `2026-11-0${i + 7}` })) },
    venue: { assignments: [{ venueId: "taipei-expo-park-zhengyan-hall", venueSpaceId: "zhengyan-exhibition-area", areaIds: ["A", "B"], mapTemplate: "SAMPLE", areaMode: "imported" }] },
    officialSource: { label: "主辦提供名單", url: "https://organizer.example/event" },
    references: { organizerAssignments: [{ organizerId: organizer.id, role: "lead" }], categoryCatalog: { id: categories.id, organizerId: organizer.id, revision: "1" } },
  };
  const references = (await catalog.resolveOrganizerReferences(draft, [organizer, categories, ...catalog.initialVenueReferences()])).snapshot;
  const rows = draft.event.days.flatMap((day) => ["S01", "S02"].map((code, i) => ({ sourceRow: i + 2, dayId: day.id, venueSpaceId: "zhengyan-exhibition-area", areaId: i === 0 ? "A" : "B", codes: [code], circleName: "同名社團", stableKey: null, identityGroup: null })));
  return { schema: "organizer-submission-snapshot/3", candidateId: "candidate-next", candidateVersion: 8, eventId: "next-event", draft,
    contentUpdatedAt: new Date(now).toISOString(), references, import: { source: { sourceDescription: "主辦提供" }, rows },
    maps: draft.event.days.map((day) => ({ id: `map-${day.id}`, periodKey: day.id, venueSpaceId: "zhengyan-exhibition-area", mapRevision: 3, content: { schema: "map-contribution-draft/1", layout: structuredClone(mapLayout) } })) };
}
test("new approvals publish the same cross-day grouping reviewed at import without changing placements", async () => {
  const snapshot = await sample({ days: 2 });
  snapshot.schema = "organizer-submission-snapshot/5";
  const approved = source(snapshot);
  const artifacts = await builder.buildApprovedPublicationArtifacts(approved);
  assert.equal(artifacts.grouping.groups.length, 1);
  assert.equal(artifacts.grouping.groups[0].linkage.kind, "manual-organizer-evidence");
  assert.equal(artifacts.grouping.groups[0].linkage.reference, snapshot.draft.officialSource.url);
  assert.deepEqual(artifacts.grouping.groups[0].sources, ["1:S01", "1:S02", "2:S01", "2:S02"]);
  const catalog = (await publishForReaders(approved))("circles.json");
  assert.equal(catalog.circles.length, 1);
  assert.equal(catalog.placements.length, 4);
  assert.deepEqual(catalog.placements.map(p => [p.day, p.boothCode]), [["1", "S01"], ["1", "S02"], ["2", "S01"], ["2", "S02"]]);
  // Approval version is part of the evidence: past approvals are not regrouped.
  snapshot.schema = "organizer-submission-snapshot/3";
  assert.equal((await builder.buildApprovedPublicationArtifacts(source(snapshot))).grouping.groups.length, 4);
});

test("an approved snapshot produces the same files every time and publishes files readers can load", async () => {
  const snapshot = await sample();
  const approved = source(snapshot);
  assert.deepEqual(await builder.buildApprovedPublicationArtifacts(approved), await builder.buildApprovedPublicationArtifacts(approved));
  const read = await publishForReaders(approved);
  assert.equal(read("circles.json").circles.length, 2, "same names are not linkage");
  assert.deepEqual(read("circles.json").placements.map(({ area }) => area), ["A", "B"]);
  const event = read("event.json");
  assert.equal(event.eventEndsAt, "2026-11-07T23:59:59+08:00");
  assert.equal(event.dataUpdatedAt, snapshot.contentUpdatedAt);
});

test("aliases publish only when the organizer set them", async () => {
  const original = await sample();
  const plain = await builder.buildApprovedPublicationArtifacts(source(original));
  assert.equal(Object.hasOwn(plain.event, "aliases"), false);
  const snapshot = structuredClone(original);
  snapshot.draft.event.aliases = ["NE", "下一場"];
  const artifacts = await builder.buildApprovedPublicationArtifacts(source(snapshot));
  assert.deepEqual(Object.keys(artifacts.event).slice(0, 5), ["schema", "id", "name", "aliases", "dateRangeLabel"]);
  assert.deepEqual(artifacts.event.aliases, ["NE", "下一場"]);
  assert.deepEqual({ ...artifacts.event, aliases: undefined }, { ...plain.event, aliases: undefined });
});

test("imported area labels and drawn regions survive approval and publication", async () => {
  const snapshot = await sample();
  snapshot.draft.venue.assignments[0].areaLabels = { A: "版攤活動", B: "巴哈市集" };
  snapshot.maps[0].content.layout.areaRegions = [
    { id: "region-a", areaId: "A", color: "mint", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] },
  ];
  const artifacts = await builder.buildApprovedPublicationArtifacts(source(snapshot));
  assert.equal(artifacts.event.areas.find((area) => area.id === "A").label, "版攤活動");
  assert.equal(artifacts.event.areas.find((area) => area.id === "B").label, "巴哈市集");
  const publishedMap = JSON.parse(artifacts.files.find((file) => file.path.endsWith("/map.json")).text);
  assert.deepEqual(publishedMap.layout.areaRegions, snapshot.maps[0].content.layout.areaRegions);
});

test("CSV area names publish with generated identities in placements and map regions", async () => {
  const snapshot = await sample();
  const prepared = prepareOrganizerImport({
    rows: parseOrganizerCsv("攤位,社團,展區\nS01,甲社,原創插畫／手作\nS02,乙社,社群交流-互動\n"), headerRow: 1,
    mapping: { day: { fixed: "1" }, venueSpace: { fixed: "zhengyan-exhibition-area" }, area: { column: 2 }, boothCode: { column: 0 }, circleName: { column: 1 } },
    areaAssignments: snapshot.draft.venue.assignments, areaGeneration: snapshot.candidateVersion,
  });
  snapshot.draft = withOrganizerImportedAreaIds(snapshot.draft, prepared.rows, prepared.areaLabels);
  snapshot.import.rows = prepared.rows;
  snapshot.maps[0].content.layout.areaRegions = [
    { id: "region-auto", areaId: prepared.rows[0].areaId, color: "mint", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] },
  ];
  const artifacts = await builder.buildApprovedPublicationArtifacts(source(snapshot));
  assert.deepEqual(artifacts.event.areas.map(area => [area.id, area.label]), [
    [prepared.rows[0].areaId, "原創插畫/手作"], [prepared.rows[1].areaId, "社群交流-互動"],
  ]);
  assert.deepEqual(artifacts.official.days[0].booths.map(row => row.areaId), prepared.rows.map(row => row.areaId));
  const publishedMap = JSON.parse(artifacts.files.find(file => file.path.endsWith("/map.json")).text);
  assert.deepEqual(publishedMap.layout.areaRegions, snapshot.maps[0].content.layout.areaRegions);
});

test("scoped maps retain every day and explicit stable-key linkage without name guessing", async () => {
  const snapshot = await sample({ days: 2 });
  for (const row of snapshot.import.rows.filter((row) => row.codes[0] === "S01")) { row.stableKey = "circle-1"; row.identityGroup = "stable:circle-1"; }
  const read = await publishForReaders(source(snapshot));
  assert.ok(!read.files.includes("map.json"), "a scoped event has no single map");
  assert.equal(read("map-manifest.json").maps.length, 2);
  assert.equal(read("circles.json").circles.length, 3, "S01 is one circle across both days by its stable key");
  assert.equal(read("event.json").eventEndsAt, "2026-11-08T23:59:59+08:00");
});

test("legacy and altered approvals and missing maps fail before anything is written", async () => {
  const snapshot = await sample();
  const approved = source(snapshot);
  await assert.rejects(builder.buildApprovedPublicationArtifacts({ ...approved, approvalHash: "0".repeat(64) }), /hash/);
  for (const schema of ["organizer-submission-snapshot/1", "organizer-submission-snapshot/2"]) await assert.rejects(builder.buildApprovedPublicationArtifacts(source({ ...snapshot, schema })), /歷史 snapshot/);
  await assert.rejects(builder.buildApprovedPublicationArtifacts(source({ ...snapshot, maps: [] })), /地圖/);
});

test("accepted HTTPS URL schemes normalize consistently without altering approved bytes", async () => {
  const snapshot = await sample();
  snapshot.draft.officialSource.url = "HTTPS://Organizer.Example/event";
  snapshot.import.rows[0].stableKey = "stable-1";
  snapshot.import.rows[0].identityGroup = "stable:stable-1";
  const approved = source(snapshot);
  const before = structuredClone(approved);
  const artifacts = await builder.buildApprovedPublicationArtifacts(approved);
  assert.equal(artifacts.event.officialData.eventUrl, "https://organizer.example/event");
  assert.equal(artifacts.event.officialData.boothListUrls["1"], "https://organizer.example/event");
  assert.equal(artifacts.official.days[0].url, "https://organizer.example/event");
  assert.equal(artifacts.grouping.groups[0].linkage.reference, "https://organizer.example/event");
  assert.equal(artifacts.files.find((file) => file.path.endsWith("/NOTICE")).text, "主辦提供名單\nhttps://organizer.example/event\n");
  assert.deepEqual(approved, before);
  assert.equal(JSON.parse(approved.snapshotJson).draft.officialSource.url, "HTTPS://Organizer.Example/event");
});

// #397: a source needs an address, not a name. One left unnamed is published
// under the same name an approved application gives it.
test("an unnamed official source is published as the event's official source", async () => {
  const snapshot = await sample();
  snapshot.draft.officialSource.label = "";
  const artifacts = await builder.buildApprovedPublicationArtifacts(source(snapshot));
  assert.equal(artifacts.files.find((file) => file.path.endsWith("/NOTICE")).text, "活動官方來源\nhttps://organizer.example/event\n");
});

test("service points and space marks in an approved map survive publication and staging into the reader's map", async () => {
  const snapshot = await sample();
  const servicePoints = [
    { id: "toilet", kind: "toilet", x: 20, y: 20 },
    { id: "desk", kind: "information", x: 60, y: 20, label: "大會服務台" },
    { id: "tickets", kind: "ticket-office", x: 20, y: 80 },
    { id: "changing", kind: "changing-room", x: 60, y: 80, label: "簡易更衣室" },
  ];
  const spaceMarks = [
    { id: "empty-table", kind: "reserved", rect: { x: 80, y: 35, width: 20, height: 30 } },
    { id: "cancelled-table", kind: "cancelled", rect: { x: 100, y: 35, width: 20, height: 30 } },
  ];
  snapshot.maps[0].content.layout.servicePoints = servicePoints;
  snapshot.maps[0].content.layout.spaceMarks = spaceMarks;
  const notes = [{ id: "times", text: "社團入場 9:30–10:30\n一般入場 10:30–15:30", rect: { x: 10, y: 0, width: 180, height: 25 } }];
  const paths = [{ id: "direction", points: [{ x: 10, y: 85 }, { x: 100, y: 85 }, { x: 100, y: 70 }] }];
  snapshot.maps[0].content.layout.notes = notes;
  snapshot.maps[0].content.layout.paths = paths;
  const shapePoints = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 90 }, { x: 10, y: 90 }];
  const shape = { x: 10, y: 10, width: 80, height: 80, points: shapePoints };
  snapshot.maps[0].content.layout.floor = structuredClone(shape);
  snapshot.maps[0].content.layout.landmarks = ["enterprise", "stage", "other"].map(kind => ({ id: kind, kind, label: kind, rect: structuredClone(shape) }));
  snapshot.maps[0].content.layout.rows[0].labelSide = "left";
  snapshot.maps[0].content.layout.accessPoints = [{ id: "side", kind: "both", direction: "east", x: 5, y: 50, label: "側門" }];
  const approved = source(snapshot);
  const map = (await publishForReaders(approved))("map.json");
  assert.deepEqual(map.layout.servicePoints, servicePoints);
  assert.deepEqual(map.layout.spaceMarks, spaceMarks);
  assert.deepEqual(map.layout.notes, notes);
  assert.deepEqual(map.layout.paths, paths);
  assert.deepEqual(map.layout.floor, shape);
  assert.equal(map.layout.landmarks.length, 3);
  for (const landmark of map.layout.landmarks) assert.deepEqual(landmark.rect, shape);
  assert.equal(map.layout.rows[0].labelSide, "left");
  assert.equal(map.layout.accessPoints[0].kind, "both");
});

test("a space mark cannot replace an imported booth required for publication", async () => {
  for (const kind of ["reserved", "cancelled"]) {
    const snapshot = await sample();
    const layout = snapshot.maps[0].content.layout;
    const requiredSlot = layout.rows[0].slots.find((slot) => slot.code === "S02");
    layout.rows[0].slots = layout.rows[0].slots.filter((slot) => slot.code !== "S02");
    layout.spaceMarks = [{ id: "replacement", kind, rect: structuredClone(requiredSlot.rect) }];
    await assert.rejects(builder.buildApprovedPublicationArtifacts(source(snapshot)), /缺少本活動日的 1 個主辦攤位代碼/);
  }
});

test("a saved annotation over a booth still blocks approved publication", async () => {
  for (const kind of ["note", "path"]) {
    const snapshot = await sample(), layout = snapshot.maps[0].content.layout;
    if (kind === "note") layout.notes = [{ id: "time", text: "社團入場 9:30–10:30", rect: { ...layout.rows[0].slots[0].rect } }];
    else layout.paths = [{ id: "direction", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }];
    await assert.rejects(builder.buildApprovedPublicationArtifacts(source(snapshot)), /S01/);
  }
});
