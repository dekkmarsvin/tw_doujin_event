import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture, hash } from "./support/organizer-amendment-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const { publishApprovedSnapshot, createR2AmendmentBaselineLoader } = await runner.import("/app/event-data-publisher.ts");
const api = await runner.import("/app/organizer-amendment-baseline.ts");
after(() => vite.close());

/** An R2 bucket with ETags and `onlyIf`, the two behaviours publication relies on. */
function bucket(objects = {}) {
  let tag = 0;
  const store = new Map(Object.entries(objects).map(([key, value]) => [key, { text: JSON.stringify(value), etag: `e${++tag}` }]));
  return {
    store,
    read: (key) => JSON.parse(store.get(key).text),
    async get(key) { const object = store.get(key); return object ? { text: async () => object.text, etag: object.etag } : null; },
    async put(key, value, options = {}) {
      if (options.onlyIf && store.get(key)?.etag !== options.onlyIf.etagMatches) return null;
      store.set(key, { text: value, etag: `e${++tag}` });
      return {};
    },
  };
}
const emptyRegistry = { "registry/r0/allocations.json": { schema: "circle-id-allocations/1", nextSequence: 1, allocations: [] },
  "registry/r0/evidence.json": { schema: "circle-identity-evidence/1", entries: [] } };
const seeded = () => bucket({ "index.json": { schema: "event-index/1", registry: "r0", events: [] }, ...emptyRegistry });
let clock = Date.parse("2026-11-22T00:00:00Z");
const tick = () => (clock += 1000);

function layout(codes) {
  return { version: 2, template: "SAMPLE", width: 600, height: 100, floor: { x: 0, y: 0, width: 600, height: 100 },
    rows: [{ label: "S", orientation: "horizontal", confidence: 1, slots: codes.map((code, index) => ({ code, rect: { x: 10 + index * 70, y: 35, width: 50, height: 30 } })) }],
    pillars: [], accessPoints: [], landmarks: [] };
}
function amendmentSnapshot(baseline, changes, id) {
  const plan = api.planOrganizerAmendmentCandidate(baseline, changes, () => "2026-09-16");
  const baselineJson = JSON.stringify(baseline);
  const snapshot = { schema: "organizer-submission-snapshot/4", operation: "AMEND", candidateId: id, candidateVersion: 2,
    eventId: baseline.event.id, draft: structuredClone(baseline.draft), references: baseline.references,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    amendment: { baselineJson, baselineSha256: hash(baselineJson), changes },
    import: { source: { sourceDescription: "已確認更正" }, rows: plan.rows },
    maps: baseline.maps.map((map) => ({ ...map, id: `${id}-${map.periodKey}`, mapRevision: 2,
      content: { schema: "map-contribution-draft/1", layout: layout([...new Set([...baseline.official.days.flatMap((day) => day.booths.flatMap((booth) => booth.codes)),
        ...plan.rows.flatMap((row) => row.codes)])]) } })) };
  const snapshotJson = JSON.stringify(snapshot);
  return { snapshotJson, approvalHash: hash(snapshotJson), candidateId: id, candidateVersion: 2 };
}
const published = (fixture) => ({ snapshotJson: fixture.source.snapshotJson, approvalHash: fixture.source.approvalHash, candidateId: "source", candidateVersion: 1 });
const circlesOf = (store, eventId = "event-alpha") => {
  const entry = store.read("index.json").events.find((item) => item.eventId === eventId);
  return store.read(`events/${eventId}/${entry.version}/circles.json`);
};

test("approval publishes the reader files and registry the Git pipeline produced, then switches the index", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  const result = await publishApprovedSnapshot(store, published(fixture), tick);
  assert.equal(result.alreadyPublished, false);
  const index = store.read("index.json");
  assert.equal(index.registry, result.version);
  const [entry] = index.events;
  assert.deepEqual(entry.files, ["circles.json", "event.json", "map.json", "reference-records.json"]);
  assert.deepEqual(entry.source, { candidateId: "source", candidateVersion: 1, approvalHash: fixture.source.approvalHash });
  assert.deepEqual(entry.sourceFiles, ["circle-identity-groups.json"]);
  // Byte for byte what the data repository held, and the same identities the
  // main-repository ledger recorded.
  assert.equal(store.store.get(`events/event-alpha/${entry.version}/event.json`).text, fixture.dataFiles.get("events/event-alpha/event.json"));
  assert.deepEqual(circlesOf(store), fixture.published.catalog);
  assert.deepEqual(store.read(`registry/${result.version}/evidence.json`), JSON.parse(fixture.mainFiles.get("data/circle-identities/evidence.json")));
  assert.deepEqual(entry.definition, JSON.parse(fixture.dataFiles.get("events/event-alpha/event.json")));
  // The registry readers were built with before stays as it was.
  assert.deepEqual(store.read("registry/r0/allocations.json").allocations, []);
});

test("a repeated approval changes nothing, and a first publication never overwrites a published event", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  const { version } = await publishApprovedSnapshot(store, published(fixture), tick);
  const before = store.store.get("index.json").text;
  assert.deepEqual(await publishApprovedSnapshot(store, published(fixture), tick), { version, alreadyPublished: true });
  assert.equal(store.store.get("index.json").text, before);
  const other = await amendmentFixture(runner, (snapshot) => { snapshot.candidateId = "other"; });
  await assert.rejects(publishApprovedSnapshot(store, { ...published(other), candidateId: "other" }, tick), { code: "event_id_collision" });
  assert.equal(store.store.get("index.json").text, before);
});

test("an index replaced during publication is kept, and the publication asks to be retried", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  const get = store.get.bind(store);
  store.get = async (key) => {
    const object = await get(key);
    // Another publication finishes right after this one read the index.
    if (key === "index.json") store.store.set("index.json", { text: JSON.stringify({ schema: "event-index/1", registry: "r0", events: [] }), etag: "other" });
    return object;
  };
  await assert.rejects(publishApprovedSnapshot(store, published(fixture), tick), (error) => error.code === "event_index_changed" && error.retryable === true);
  assert.equal(store.store.get("index.json").etag, "other");
});

test("a correction starts from the published version and keeps every circle it does not declare", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const before = circlesOf(store);
  const load = createR2AmendmentBaselineLoader(store);
  const baseline = await load({ ...fixture.source });
  assert.equal(baseline.schema, "organizer-amendment-baseline/3");
  assert.equal(baseline.version, store.read("index.json").events[0].version);
  assert.equal(baseline.pin, undefined);
  const amendment = amendmentSnapshot(baseline, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }], "amendment-one");
  await publishApprovedSnapshot(store, amendment, tick);
  const after = circlesOf(store);
  const idOf = (catalog, name) => catalog.circles.find((circle) => circle.name === name)?.id;
  assert.equal(idOf(after, "甲社"), idOf(before, "甲社"), "an undeclared circle keeps its id, so readers keep their favourites");
  assert.ok(idOf(after, "接手社"));
  assert.notEqual(idOf(after, "接手社"), idOf(before, "乙社"));
  assert.equal(store.read("index.json").events.length, 1);
  assert.equal(store.read("index.json").events[0].source.candidateId, "amendment-one");
});

test("a correction based on a superseded version is refused, and a mismatched source cannot start one", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const baseline = await createR2AmendmentBaselineLoader(store)({ ...fixture.source });
  await publishApprovedSnapshot(store, amendmentSnapshot(baseline, [], "amendment-one"), tick);
  const published2 = store.store.get("index.json").text;
  await assert.rejects(publishApprovedSnapshot(store, amendmentSnapshot(baseline, [], "amendment-two"), tick), { code: "amendment_base_conflict" });
  assert.equal(store.store.get("index.json").text, published2);
  // The index now names amendment-one, so the original source no longer describes what readers see.
  await assert.rejects(createR2AmendmentBaselineLoader(store)({ ...fixture.source }), { code: "amendment_baseline_changed" });
});
