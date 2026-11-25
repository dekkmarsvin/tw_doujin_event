import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { adoptedAmendmentFixture, amendmentFixture, hash } from "./support/organizer-amendment-fixture.mjs";

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
function amendmentSnapshot(baseline, changes, id, settings = null) {
  const plan = api.planOrganizerAmendmentCandidate(baseline, changes, () => "2026-09-16");
  const baselineJson = JSON.stringify(baseline);
  const snapshot = { schema: "organizer-submission-snapshot/4", operation: "AMEND", candidateId: id, candidateVersion: 2,
    eventId: baseline.event.id, draft: structuredClone(baseline.draft), references: baseline.references,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    amendment: { baselineJson, baselineSha256: hash(baselineJson), changes, ...(settings ? { settings } : {}) },
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
  assert.deepEqual(store.read(`registry/${result.version}/evidence.json`), fixture.registry.evidence);
  assert.deepEqual(entry.definition, JSON.parse(fixture.dataFiles.get("events/event-alpha/event.json")));
  // The registry readers were built with before stays as it was.
  assert.deepEqual(store.read("registry/r0/allocations.json").allocations, []);
});

test("a repeated approval changes nothing, and a first publication never overwrites a published event", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const before = store.store.get("index.json").text;
  assert.deepEqual(await publishApprovedSnapshot(store, published(fixture), tick), { alreadyPublished: true });
  assert.equal(store.store.get("index.json").text, before);
  const other = await amendmentFixture(runner, (snapshot) => { snapshot.candidateId = "other"; });
  await assert.rejects(publishApprovedSnapshot(store, { ...published(other), candidateId: "other" }, tick), { code: "event_id_collision" });
  assert.equal(store.store.get("index.json").text, before);
});

test("an index replaced during publication is kept, and the publication asks to be retried", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  const put = store.put.bind(store);
  let raced = false;
  store.put = async (key, value, options) => {
    // Another publication finishes while this one is writing its version.
    if (!raced && key.startsWith("registry/")) {
      raced = true;
      store.store.set("index.json", { text: JSON.stringify({ schema: "event-index/1", registry: "r0", events: [] }), etag: "other" });
    }
    return put(key, value, options);
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

test("every published index is kept whole for rollback, and an index without an ETag is never overwritten", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  const { version } = await publishApprovedSnapshot(store, published(fixture), tick);
  assert.equal(store.store.get(`history/index-${version}.json`).text, store.store.get("index.json").text);
  const unversioned = seeded();
  const get = unversioned.get.bind(unversioned);
  unversioned.get = async (key) => { const object = await get(key); return object && key === "index.json" ? { text: object.text } : object; };
  await assert.rejects(publishApprovedSnapshot(unversioned, published(fixture), tick), { code: "event_index_unversioned" });
});

test("approving again after a lost response recognises its own publication instead of reporting a collision", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const index = store.store.get("index.json").text;
  let wrote = 0;
  assert.deepEqual(await publishApprovedSnapshot(store, published(fixture), tick, async () => { wrote++; }), { alreadyPublished: true });
  assert.equal(store.store.get("index.json").text, index);
  assert.equal(wrote, 0, "nothing new is written");
});

test("a correction cannot start from a version whose maps differ from its source snapshot", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const index = store.read("index.json");
  delete index.events[0].source; // as uploaded from the data repository
  const key = `events/event-alpha/${index.events[0].version}/map.json`;
  const map = store.read(key);
  map.layout.rows[0].slots[0].rect.x += 5; // a map fix uploaded after the approval
  store.store.set(key, { text: JSON.stringify(map), etag: "m" });
  store.store.set("index.json", { text: JSON.stringify(index), etag: "i" });
  await assert.rejects(createR2AmendmentBaselineLoader(store)({ ...fixture.source }), { code: "amendment_baseline_changed" });
});

test("a correction begun before the switch is refused before anything is written", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const before = new Map(store.store);
  let wrote = false;
  // fixture.baseline is the Git-era `/1` form.
  await assert.rejects(publishApprovedSnapshot(store, amendmentSnapshot(fixture.baseline, [], "legacy"), tick, async () => { wrote = true; }),
    { code: "amendment_baseline_legacy" });
  assert.equal(wrote, false, "no remote-write intent, so the candidate can still be sent back");
  assert.deepEqual(new Map(store.store), before);
});

/** The source a later correction starts from: the approval readers now see. */
const publishedSource = (approval, jobId) => ({ ...approval, jobId, snapshotId: `${jobId}-snapshot`, publishedAt: clock,
  dataCommit: "b".repeat(40), mainCommit: "d".repeat(40) });

test("chained corrections keep every undeclared circle and number new ones from the current registry", async () => {
  const fixture = await amendmentFixture(runner, (snapshot) => {
    snapshot.import.rows.push(...["S03", "S04"].map((code, index) => ({ ...snapshot.import.rows[0], sourceRow: index + 3, codes: [code], circleName: index ? "丁社" : "丙社" })));
    snapshot.maps[0].content.layout = layout(["S01", "S02", "S03", "S04"]);
  });
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const load = createR2AmendmentBaselineLoader(store);
  const idOf = (catalog, code) => catalog.placements.find((row) => row.boothCode === code && row.status === "active")?.circleId;
  const created = circlesOf(store);
  const first = amendmentSnapshot(await load({ ...fixture.source }), [{ kind: "moved", moves: [{ source: "1:S03", to: { dayId: "1", code: "S05", areaId: "B" } }] }], "amendment-one");
  await publishApprovedSnapshot(store, first, tick);
  const moved = circlesOf(store);
  assert.equal(idOf(moved, "S05"), idOf(created, "S03"), "a moved circle keeps its id");
  const second = amendmentSnapshot(await load(publishedSource(first, "amendment-one-job")), [{ kind: "released", sources: ["1:S05"], circleName: "後來接手社" }], "amendment-two");
  await publishApprovedSnapshot(store, second, tick);
  const released = circlesOf(store);
  for (const code of ["S01", "S02", "S04"]) assert.equal(idOf(released, code), idOf(created, code), `${code} keeps its id`);
  assert.ok(idOf(released, "S05"));
  assert.ok(![idOf(created, "S01"), idOf(created, "S02"), idOf(created, "S03"), idOf(created, "S04")].includes(idOf(released, "S05")), "a released booth gets a new id");
});

// ADR-0068: declared settings change the published event and nothing else, and
// the next correction starts from the event as it was published.
test("a settings correction renames the published event and the next correction starts from it", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const load = createR2AmendmentBaselineLoader(store);
  const settings = { name: "測試活動 改名", aliases: ["TA"], days: [{ id: "1", date: "2026-11-14" }] };
  const first = amendmentSnapshot(await load({ ...fixture.source }), [], "amendment-settings", settings);
  await publishApprovedSnapshot(store, first, tick);
  const entry = () => store.read("index.json").events[0];
  assert.equal(entry().definition.name, "測試活動 改名");
  assert.deepEqual(entry().definition.aliases, ["TA"]);
  assert.deepEqual(circlesOf(store).placements.map((row) => row.boothCode), ["S01", "S02"], "a settings-only correction leaves the roster alone");
  const next = await load(publishedSource(first, "amendment-settings-job"));
  assert.equal(next.draft.event.name, "測試活動 改名");
  assert.equal(next.draft.event.days[0].date, "2026-11-14");
  await publishApprovedSnapshot(store, amendmentSnapshot(next, [{ kind: "withdrawn", sources: ["1:S02"] }], "amendment-after-settings"), tick);
  assert.equal(entry().definition.name, "測試活動 改名", "a later correction without settings keeps the corrected event");
  assert.equal(entry().definition.eventEndsAt, "2026-11-14T23:59:59+08:00");
});

test("a correction starts from the grouping readers were published with, including a maintainer's cross-day merge", async () => {
  const fixture = await adoptedAmendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  // A maintainer-reviewed grouping merges each circle across both days,
  // uploaded together with the registry and catalog it produces.
  const index = store.read("index.json");
  const { version } = index.events[0];
  const merged = fixture.dataFiles.get("events/event-alpha/circle-identity-groups.json");
  store.store.set(`events/event-alpha/${version}/source/circle-identity-groups.json`, { text: merged, etag: "g" });
  store.store.set(`events/event-alpha/${version}/circles.json`, { text: JSON.stringify(fixture.published.catalog), etag: "c" });
  store.store.set(`registry/${index.registry}/evidence.json`, { text: JSON.stringify(fixture.registry.evidence), etag: "r" });
  const baseline = await createR2AmendmentBaselineLoader(store)({ ...fixture.source });
  assert.deepEqual(baseline.grouping, JSON.parse(merged));
  await publishApprovedSnapshot(store, amendmentSnapshot(baseline, [], "after-merge", { name: "整合後的活動" }), tick);
  const catalog = circlesOf(store);
  assert.equal(catalog.circles.length, 2, "the merge survives the correction");
  assert.deepEqual(catalog.placements.map((row) => [row.day, row.boothCode, row.circleId]),
    fixture.published.catalog.placements.map((row) => [row.day, row.boothCode, row.circleId]));
});

test("a partial move keeps a multi-day circle whole, and a changed identity history stops the next correction", async () => {
  const fixture = await amendmentFixture(runner, (snapshot) => {
    snapshot.draft.event.days.push({ id: "2", label: "第二天", date: "2026-11-08" });
    Object.assign(snapshot.import.rows[0], { codes: ["S01", "S03"], stableKey: "shared", identityGroup: "stable:shared" });
    snapshot.import.rows.push({ ...snapshot.import.rows[0], sourceRow: 3, dayId: "2", codes: ["S01"] });
    snapshot.maps[0].content.layout = layout(["S01", "S02", "S03"]);
    snapshot.maps.push({ ...snapshot.maps[0], id: "day-2-map", periodKey: "2", content: { schema: "map-contribution-draft/1", layout: layout(["S01"]) } });
  });
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const load = createR2AmendmentBaselineLoader(store);
  const first = amendmentSnapshot(await load({ ...fixture.source }), [{ kind: "moved", moves: [{ source: "1:S03", to: { dayId: "2", code: "S05", areaId: "B" } }] }], "amendment-one");
  await publishApprovedSnapshot(store, first, tick);
  const grouping = store.read(`events/event-alpha/${store.read("index.json").events[0].version}/source/circle-identity-groups.json`);
  assert.deepEqual(grouping.groups[0].sources, ["1:S01", "2:S01", "2:S05"]);
  const next = await load(publishedSource(first, "amendment-one-job"));
  assert.equal("snapshotJson" in next.source, false);
  assert.equal(JSON.stringify(next).includes("baselineJson"), false, "a baseline never nests the previous one");
  const second = amendmentSnapshot(next, [{ kind: "released", sources: ["2:S05"], circleName: "後來接手社" }], "amendment-two");

  // Someone edits the published identity history in between: the correction stops.
  const tampered = bucket(Object.fromEntries([...store.store].map(([key, value]) => [key, JSON.parse(value.text)])));
  const index = tampered.read("index.json");
  const evidence = tampered.read(`registry/${index.registry}/evidence.json`);
  evidence.entries[0].retiredSources[0].retirement.areaId = "B";
  tampered.store.set(`registry/${index.registry}/evidence.json`, { text: JSON.stringify(evidence), etag: "x" });
  await assert.rejects(publishApprovedSnapshot(tampered, second, tick), { code: "amendment_baseline_changed" });

  await publishApprovedSnapshot(store, second, tick);
  const catalog = circlesOf(store);
  assert.deepEqual(catalog.placements.filter((row) => row.circleId === "c-000001" && row.status === "active").map((row) => [row.day, row.boothCode]), [["1", "S01"], ["2", "S01"]]);
  assert.equal(catalog.placements.find((row) => row.boothCode === "S05" && row.status === "active").circleId, "c-000003");
});

test("a correction numbers new circles after the ids another event claimed while it was being edited", async () => {
  const fixture = await amendmentFixture(runner);
  const store = seeded();
  await publishApprovedSnapshot(store, published(fixture), tick);
  const baseline = await createR2AmendmentBaselineLoader(store)({ ...fixture.source });
  // Another event is published after the correction's baseline was taken.
  const otherSnapshot = { ...JSON.parse(fixture.source.snapshotJson), candidateId: "other", eventId: "event-beta" };
  otherSnapshot.draft = { ...otherSnapshot.draft, event: { ...otherSnapshot.draft.event, id: "event-beta" } };
  otherSnapshot.references = { ...otherSnapshot.references, selection: { ...otherSnapshot.references.selection, eventId: "event-beta" } };
  const otherJson = JSON.stringify(otherSnapshot);
  await publishApprovedSnapshot(store, { snapshotJson: otherJson, approvalHash: hash(otherJson), candidateId: "other", candidateVersion: 1 }, tick);
  const claimed = circlesOf(store, "event-beta").circles.map((circle) => circle.id);
  await publishApprovedSnapshot(store, amendmentSnapshot(baseline, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }], "amendment-one"), tick);
  const handedOver = circlesOf(store).circles.find((circle) => circle.name === "接手社").id;
  assert.ok(!claimed.includes(handedOver), `${handedOver} was already given to event-beta`);
  assert.equal(store.read("index.json").events.length, 2, "the other event stays published");
});
