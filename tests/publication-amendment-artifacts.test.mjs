import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture, gitReaderFixture, hash } from "./support/organizer-amendment-fixture.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const builder = await runner.import("/app/publication-artifacts.ts");
const api = await runner.import("/app/organizer-amendment-baseline.ts");
const { pinnedVenue } = await runner.import("/app/organizer-reference-seeds.ts");
after(() => vite.close());
const prefix = "events/event-alpha/";
const pinPath = "data/event-data-pins/event-alpha.json";
const approved = (snapshot) => { const snapshotJson = JSON.stringify(snapshot); return { snapshotJson, approvalHash: hash(snapshotJson) }; };
function layout(codes) {
  return { version: 2, template: "SAMPLE", width: 600, height: 100, floor: { x: 0, y: 0, width: 600, height: 100 },
    rows: [{ label: "S", orientation: "horizontal", confidence: 1, slots: codes.map((code, index) => ({ code, rect: { x: 10 + index * 70, y: 35, width: 50, height: 30 } })) }],
    pillars: [], accessPoints: [], landmarks: [] };
}
async function snapshotFor(fixture, changes, id = "amendment-one", settings = null) {
  const plan = api.planOrganizerAmendmentCandidate(fixture.baseline, changes, () => "2026-09-16");
  const baselineJson = JSON.stringify(fixture.baseline);
  const snapshot = { schema: "organizer-submission-snapshot/4", operation: "AMEND", candidateId: id, candidateVersion: 5,
    eventId: fixture.baseline.event.id, draft: structuredClone(fixture.baseline.draft), references: fixture.baseline.references,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    amendment: { baselineJson, baselineSha256: hash(baselineJson), changes, ...(settings ? { settings } : {}) },
    import: { source: { sourceDescription: "已確認更正" }, rows: plan.rows },
    maps: fixture.baseline.maps.map((map) => ({ ...map, id: `${id}-${map.periodKey}`, mapRevision: 2,
      content: { schema: "map-contribution-draft/1", layout: layout([...new Set([...fixture.baseline.official.days.find((day) => String(day.day) === map.periodKey).booths.flatMap((booth) => booth.codes),
        ...plan.rows.filter((row) => row.dayId === map.periodKey).flatMap((row) => row.codes)])]) } })) };
  return { snapshot, source: approved(snapshot) };
}
const dataBase = (fixture) => ({ commit: "a".repeat(40), eventDirectoryExists: true,
  references: new Map([...fixture.dataFiles].filter(([path]) => path.startsWith("references/"))),
  eventFiles: new Map([...fixture.dataFiles].filter(([path]) => path.startsWith(prefix))) });
const mainInput = (fixture, files) => ({ dataCommit: "b".repeat(40), mainCommit: "c".repeat(40),
  dataFiles: new Map(files.map((file) => [file.path, file.text])), publishedEventsJson: fixture.mainFiles.get("data/published-events.json"),
  existingPinJson: fixture.mainFiles.get(pinPath), allocationsJson: fixture.mainFiles.get("data/circle-identities/allocations.json"),
  evidenceJson: fixture.mainFiles.get("data/circle-identities/evidence.json") });
const jsonFile = (result, path) => JSON.parse(result.files.find((file) => file.path === path).text);
const evidenceOf = (result) => jsonFile(result, "data/circle-identities/evidence.json");
const reader = (artifacts, result) => buildOfficialCatalogPayload({ eventId: "event-alpha", event: artifacts.event, official: artifacts.official, evidence: evidenceOf(result) });

test("four reviewed declarations deterministically stage through the real Reader pipeline using the current global ledger", async () => {
  const fixture = await amendmentFixture(runner, (snapshot) => {
    snapshot.import.rows.push(...["S03", "S04"].map((code, index) => ({ ...snapshot.import.rows[0], sourceRow: index + 3, codes: [code], circleName: index ? "丁社" : "丙社" })));
    snapshot.maps[0].content.layout = layout(["S01", "S02", "S03", "S04"]);
  });
  const changes = [{ kind: "withdrawn", sources: ["1:S01"] }, { kind: "released", sources: ["1:S02"], circleName: "接手社" },
    { kind: "moved", moves: [{ source: "1:S03", to: { dayId: "1", code: "S05", areaId: "B" } }] },
    { kind: "added", placements: [{ dayId: "1", code: "S06", areaId: "A" }], circleName: "新社" }];
  const { source, snapshot } = await snapshotFor(fixture, changes);
  const before = structuredClone(fixture);
  const artifacts = await builder.buildApprovedPublicationArtifacts(source);
  const data = await builder.buildPublicationDataStage(source, dataBase(fixture));
  assert.deepEqual(await builder.buildPublicationDataStage(source, dataBase(fixture)), data);
  const input = mainInput(fixture, data.allFiles);
  const allocations = JSON.parse(input.allocationsJson), evidence = JSON.parse(input.evidenceJson);
  const other = { circleId: "c-000005", currentName: "其他活動", aliases: [], sources: [{ eventId: "prior-event", kind: "organizer-booth", value: "1:A01" }] };
  allocations.allocations.push({ id: other.circleId, allocatedAt: "2026-09-16", reason: "other event published during editing" });
  allocations.nextSequence = 6; evidence.entries.push(other);
  input.allocationsJson = JSON.stringify(allocations); input.evidenceJson = JSON.stringify(evidence);
  input.publishedEventsJson = '{"schema":"published-events/1", "events": ["prior-event", "event-alpha", "later-event"]}\n';
  const main = await builder.buildPublicationMainStage(source, input);
  assert.deepEqual(await builder.buildPublicationMainStage(source, input), main);
  assert.equal(main.files.find((file) => file.path === "data/published-events.json").text, input.publishedEventsJson);
  assert.deepEqual(evidenceOf(main).entries.find((entry) => entry.circleId === other.circleId), other);
  assert.equal(artifacts.grouping.schema, "circle-identity-groups/2");
  assert.deepEqual(artifacts.grouping.transitions, [], "published grouping is the applied result; declarations remain in approval");
  assert.equal(JSON.parse(source.snapshotJson).amendment.changes.length, 4);
  assert.equal(evidenceOf(main).entries.flatMap((entry) => entry.retiredSources ?? []).length, 3);
  assert.deepEqual(fixture, before, "no baseline mutation");
  const catalog = reader(artifacts, main);
  const active = (code) => catalog.placements.find((row) => row.boothCode === code && row.status === "active");
  assert.equal(active("S02").circleId, "c-000006", "use latest allocation sequence, not provisional preview ids");
  assert.equal(active("S04").circleId, "c-000004");
  assert.equal(active("S05").circleId, "c-000003");
  assert.equal(active("S06").circleId, "c-000007");
  assert.equal(catalog.circles.find((circle) => circle.id === "c-000002").name, "乙社", "old URL/favorite still belongs to old circle");
  assert.equal(catalog.placements.find((row) => row.circleId === "c-000002").status, "cancelled");
  assert.equal(catalog.placements.find((row) => row.circleId === "c-000002").area, "B");
  const pin = jsonFile(main, pinPath);
  assert.equal(pin.commit, input.dataCommit);
  for (const file of pin.files) assert.equal(file.sha256, hash(input.dataFiles.get(file.path)));
  assert.deepEqual(main.files.map((file) => file.path).sort(), ["data/circle-identities/allocations.json", "data/circle-identities/evidence.json", pinPath, "data/published-events.json"].sort());
  const workspace = await mkdtemp(path.join(tmpdir(), "amendment-artifacts-"));
  try {
    for (const file of [...data.allFiles, ...main.files]) {
      const relative = file.path.startsWith(prefix) ? `.event-data/event-alpha/${file.path.slice(prefix.length)}`
        : file.path.startsWith("references/") ? `.event-data/event-alpha/${file.path}` : file.path;
      const destination = path.join(workspace, relative);
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, file.text);
    }
    execFileSync(process.execPath, ["scripts/stage-event-data.mjs", "event-alpha", "--workspace", workspace], { stdio: "pipe" });
    execFileSync(process.execPath, ["scripts/check-staged-event-data.mjs", "--workspace", workspace], { stdio: "pipe" });
    assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "public/data/events/event-alpha/circles.json"), "utf8")), catalog);
    const map = JSON.parse(await readFile(path.join(workspace, "public/data/events/event-alpha/map.json"), "utf8"));
    assert.ok(map.layout.rows.flatMap((row) => row.slots).some((slot) => slot.code === "S05"));
    assert.equal(JSON.parse(await readFile(path.join(workspace, "public/data/events/event-alpha/event.json"), "utf8")).dataUpdatedAt, snapshot.contentUpdatedAt);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("partial moves preserve reviewed multi-day identity and the next baseline can load a published amendment without nested history", async () => {
  const fixture = await amendmentFixture(runner, (snapshot) => {
    snapshot.draft.event.days.push({ id: "2", label: "第二天", date: "2026-11-08" });
    Object.assign(snapshot.import.rows[0], { codes: ["S01", "S03"], stableKey: "shared", identityGroup: "stable:shared" });
    snapshot.import.rows.push({ ...snapshot.import.rows[0], sourceRow: 3, dayId: "2", codes: ["S01"] });
    snapshot.maps[0].content.layout = layout(["S01", "S02", "S03"]);
    snapshot.maps.push({ ...snapshot.maps[0], id: "day-2-map", periodKey: "2", content: { schema: "map-contribution-draft/1", layout: layout(["S01"]) } });
  });
  const first = await snapshotFor(fixture, [{ kind: "moved", moves: [{ source: "1:S03", to: { dayId: "2", code: "S05", areaId: "B" } }] }]);
  const artifacts = await builder.buildApprovedPublicationArtifacts(first.source);
  const data = await builder.buildPublicationDataStage(first.source, dataBase(fixture));
  const main = await builder.buildPublicationMainStage(first.source, mainInput(fixture, data.allFiles));
  assert.deepEqual(artifacts.grouping.groups[0].sources, ["1:S01", "2:S01", "2:S05"]);
  assert.equal(evidenceOf(main).entries.length, fixture.baseline.evidence.entries.length);
  const nextFixture = { ...fixture, source: { ...fixture.source, ...first.source, candidateId: first.snapshot.candidateId, candidateVersion: 5,
    mainCommit: "d".repeat(40), dataCommit: "b".repeat(40), jobId: "amendment-job", snapshotId: "amendment-snapshot" },
    baseline: { mainCommit: "e".repeat(40) }, mainFiles: new Map(main.files.map((file) => [file.path, file.text])), dataFiles: new Map(data.allFiles.map((file) => [file.path, file.text])),
    published: { dataCommit: "b".repeat(40), catalog: reader(artifacts, main) } };
  const remote = gitReaderFixture(nextFixture);
  nextFixture.baseline = await api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test" }, fetch: remote.fetch,
    published: async () => nextFixture.published })(nextFixture.source);
  assert.equal("snapshotJson" in nextFixture.baseline.source, false);
  assert.equal(JSON.stringify(nextFixture.baseline).includes("baselineJson"), false);
  const second = await snapshotFor(nextFixture, [{ kind: "released", sources: ["2:S05"], circleName: "後來接手社" }], "amendment-two");
  const secondArtifacts = await builder.buildApprovedPublicationArtifacts(second.source);
  const secondData = await builder.buildPublicationDataStage(second.source, dataBase(nextFixture));
  const secondMain = await builder.buildPublicationMainStage(second.source, mainInput(nextFixture, secondData.allFiles));
  const catalog = reader(secondArtifacts, secondMain);
  assert.deepEqual(catalog.placements.filter((row) => row.circleId === "c-000001" && row.status === "active").map((row) => [row.day, row.boothCode]), [["1", "S01"], ["2", "S01"]]);
  assert.equal(catalog.placements.find((row) => row.boothCode === "S05" && row.status === "active").circleId, "c-000003");
  const changedHistory = mainInput(nextFixture, secondData.allFiles);
  const evidence = JSON.parse(changedHistory.evidenceJson);
  evidence.entries[0].retiredSources[0].retirement.areaId = "B";
  changedHistory.evidenceJson = JSON.stringify(evidence);
  await assert.rejects(builder.buildPublicationMainStage(second.source, changedHistory), (e) => e.code === "amendment_baseline_changed");
});

// ADR-0068: declared settings change the published event and nothing else, and
// the next correction starts from the event as it was published.
test("declared settings publish a renamed, re-dated event and the next baseline starts from it", async () => {
  const fixture = await amendmentFixture(runner);
  const settings = { name: "測試活動 改名", aliases: ["TA"], days: [{ id: "1", date: "2026-11-14" }] };
  const first = await snapshotFor(fixture, [], "amendment-settings", settings);
  const artifacts = await builder.buildApprovedPublicationArtifacts(first.source);
  assert.equal(artifacts.event.name, "測試活動 改名");
  assert.deepEqual(artifacts.event.aliases, ["TA"]);
  assert.deepEqual(artifacts.event.days.map((day) => day.dateLabel), ["2026-11-14"]);
  assert.equal(artifacts.event.dateRangeLabel, "2026-11-14");
  assert.equal(artifacts.event.eventEndsAt, "2026-11-14T23:59:59+08:00");
  assert.equal(artifacts.draft.event.name, "測試活動 改名");
  assert.deepEqual(first.snapshot.draft, fixture.baseline.draft, "the draft itself never moves");
  const settled = ["name", "aliases", "days", "dateRangeLabel", "eventEndsAt", "dataUpdatedAt"];
  const rest = (event) => Object.fromEntries(Object.entries(event).filter(([key]) => !settled.includes(key)));
  assert.deepEqual(rest(artifacts.event), rest(fixture.baseline.event), "fields outside the allow-list stay exactly as published");
  const data = await builder.buildPublicationDataStage(first.source, dataBase(fixture));
  const main = await builder.buildPublicationMainStage(first.source, mainInput(fixture, data.allFiles));
  assert.deepEqual(reader(artifacts, main).placements.map((row) => [row.boothCode, row.circleId, row.status]),
    [["S01", "c-000001", "active"], ["S02", "c-000002", "active"]], "a settings-only correction leaves the roster alone");
  const nextFixture = { ...fixture, source: { ...fixture.source, ...first.source, candidateId: first.snapshot.candidateId, candidateVersion: 5,
    mainCommit: "d".repeat(40), dataCommit: "b".repeat(40), jobId: "amendment-job", snapshotId: "amendment-snapshot" },
    baseline: { mainCommit: "e".repeat(40) }, mainFiles: new Map(main.files.map((file) => [file.path, file.text])), dataFiles: new Map(data.allFiles.map((file) => [file.path, file.text])),
    published: { dataCommit: "b".repeat(40), catalog: reader(artifacts, main) } };
  const remote = gitReaderFixture(nextFixture);
  nextFixture.baseline = await api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test" }, fetch: remote.fetch,
    published: async () => nextFixture.published })(nextFixture.source);
  assert.equal(nextFixture.baseline.draft.event.name, "測試活動 改名");
  assert.deepEqual(nextFixture.baseline.draft.event.aliases, ["TA"]);
  assert.equal(nextFixture.baseline.draft.event.days[0].date, "2026-11-14");
  const second = await snapshotFor(nextFixture, [{ kind: "withdrawn", sources: ["1:S02"] }], "amendment-after-settings");
  const secondArtifacts = await builder.buildApprovedPublicationArtifacts(second.source);
  assert.equal(secondArtifacts.event.name, "測試活動 改名", "a later correction without settings keeps the corrected event");
  assert.equal(secondArtifacts.event.eventEndsAt, "2026-11-14T23:59:59+08:00");
});

test("settings and roster declarations publish together", async () => {
  const fixture = await amendmentFixture(runner);
  const { source } = await snapshotFor(fixture, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }], "amendment-both", { name: "測試活動 改名" });
  const artifacts = await builder.buildApprovedPublicationArtifacts(source);
  const data = await builder.buildPublicationDataStage(source, dataBase(fixture));
  const main = await builder.buildPublicationMainStage(source, mainInput(fixture, data.allFiles));
  assert.equal(artifacts.event.name, "測試活動 改名");
  assert.equal(Object.hasOwn(artifacts.event, "aliases"), false);
  assert.equal(reader(artifacts, main).placements.find((row) => row.boothCode === "S02" && row.status === "active").circleId, "c-000003");
});

test("settings outside their stored form, and merged data that ignores them, fail closed", async () => {
  const fixture = await amendmentFixture(runner);
  const { source, snapshot } = await snapshotFor(fixture, [], "amendment-settings", { name: "測試活動 改名" });
  for (const [alter, code] of [
    [(s) => { s.amendment.settings = { name: "測試活動" }; }, "snapshot_mismatch"],
    [(s) => { s.amendment.settings = { name: " 測試活動 改名" }; }, "snapshot_mismatch"],
    [(s) => { s.amendment.settings = { mapTemplate: "OTHER" }; }, "artifact_invalid"],
    [(s) => { s.amendment.settings = { days: [{ id: "9", date: "2026-11-14" }] }; }, "artifact_invalid"],
    [(s) => { s.draft.event.name = "測試活動 改名"; }, "snapshot_mismatch"],
  ]) {
    const changed = structuredClone(snapshot); alter(changed);
    await assert.rejects(builder.buildApprovedPublicationArtifacts(approved(changed)), (e) => e.code === code, JSON.stringify(changed.amendment.settings));
  }
  const data = await builder.buildPublicationDataStage(source, dataBase(fixture));
  const input = mainInput(fixture, data.allFiles);
  input.dataFiles.set(prefix + "event.json", fixture.dataFiles.get(prefix + "event.json"));
  await assert.rejects(builder.buildPublicationMainStage(source, input), (e) => e.code === "snapshot_mismatch");
});

test("approval, operation, immutable baseline and declaration-derived rows fail closed", async () => {
  const fixture = await amendmentFixture(runner);
  const { source, snapshot } = await snapshotFor(fixture, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }]);
  await assert.rejects(builder.buildApprovedPublicationArtifacts({ ...source, approvalHash: "0".repeat(64) }), (e) => e.code === "snapshot_mismatch");
  for (const alter of [
    (s) => { s.operation = "CREATE"; }, (s) => { s.schema = "organizer-submission-snapshot/3"; },
    (s) => { delete s.amendment; }, (s) => { s.amendment.baselineJson += " "; },
    (s) => { s.draft.event.name = "unauthorized metadata change"; },
    (s) => { s.references.files[0].content += " "; },
    (s) => { s.import.rows.pop(); }, (s) => { s.import.rows[0].circleName = "wrong"; },
    (s) => { s.import.rows[0].stableKey = "made-up"; s.import.rows[0].identityGroup = "stable:made-up"; },
    (s) => { s.amendment.changes = []; }, (s) => { s.candidateId = fixture.source.candidateId; },
  ]) {
    const changed = structuredClone(snapshot); alter(changed);
    await assert.rejects(builder.buildApprovedPublicationArtifacts(approved(changed)), (e) => e.code === "snapshot_mismatch");
  }
  const changed = structuredClone(fixture.snapshot); changed.operation = "AMEND";
  await assert.rejects(builder.buildApprovedPublicationArtifacts(approved(changed)), (e) => e.code === "snapshot_mismatch");
});

test("data replacement requires the complete unchanged event directory and retains canonical references", async () => {
  const fixture = await amendmentFixture(runner);
  const { source } = await snapshotFor(fixture, []);
  for (const alter of [
    (base) => { delete base.eventFiles; }, (base) => { base.eventDirectoryExists = false; },
    (base) => { base.eventFiles.delete(prefix + "map.json"); },
    (base) => { base.eventFiles.set(prefix + "official-booths.json", "{}"); },
    (base) => { base.eventFiles.set(prefix + "unreviewed.json", "{}"); },
    (base) => { base.eventFiles.set(prefix + "NOTICE", "changed"); },
  ]) {
    const base = dataBase(fixture); alter(base);
    await assert.rejects(builder.buildPublicationDataStage(source, base), (e) => e.code === "amendment_baseline_changed");
  }
  const base = dataBase(fixture), [refPath, original] = [...base.references][0];
  base.references.set(refPath, JSON.stringify(JSON.parse(original)));
  const data = await builder.buildPublicationDataStage(source, base);
  assert.ok(!data.files.some((file) => file.path === refPath));
  assert.equal(data.allFiles.find((file) => file.path === refPath).text, base.references.get(refPath));
  base.references.set(refPath, "{}");
  await assert.rejects(builder.buildPublicationDataStage(source, base), (e) => e.code === "reference_conflict");
});

// #395: an event published before its venue had an address gets it through a
// correction. The venue record may differ from the baseline by that address
// and nothing else; the data stage writes it and the new pin names it.
test("a correction carries the venue's added address, and no other reference change", async () => {
  const venuePath = "references/venues/taipei-expo-park-zhengyan-hall.json";
  const fixture = await amendmentFixture(runner, (snapshot) => {
    const file = snapshot.references.files.find((item) => item.path === venuePath);
    Object.assign(file, { content: pinnedVenue, sha256: hash(pinnedVenue) });
  });
  const completed = fixture.referenceRecords.find((record) => record.path === venuePath).publicReferenceJson;
  assert.equal(JSON.parse(completed).address, "10452 臺北市中山區玉門街1號");
  assert.equal(fixture.dataFiles.get(venuePath), pinnedVenue);
  const { snapshot } = await snapshotFor(fixture, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }]);
  const withAddress = (content) => {
    const changed = structuredClone(snapshot);
    Object.assign(changed.references.files.find((item) => item.path === venuePath), { content, sha256: hash(content) });
    return approved(changed);
  };
  const source = withAddress(completed);
  const data = await builder.buildPublicationDataStage(source, dataBase(fixture));
  assert.equal(data.files.find((file) => file.path === venuePath)?.text, completed);
  const main = await builder.buildPublicationMainStage(source, mainInput(fixture, data.allFiles));
  assert.equal(jsonFile(main, pinPath).files.find((file) => file.path === venuePath).sha256, hash(completed));

  const renamed = JSON.parse(completed);
  renamed.name = "爭艷館（改名）";
  await assert.rejects(builder.buildApprovedPublicationArtifacts(withAddress(`${JSON.stringify(renamed, null, 2)}\n`)), (e) => e.code === "snapshot_mismatch");
});

test("main replacement rejects changed or absent pin, changed source identity and changed merged data", async () => {
  const fixture = await amendmentFixture(runner);
  const { source } = await snapshotFor(fixture, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }]);
  const data = await builder.buildPublicationDataStage(source, dataBase(fixture));
  for (const alter of [
    (input) => { input.existingPinJson = null; }, (input) => { input.existingPinJson = "{}"; },
    (input) => { const pin = JSON.parse(input.existingPinJson); pin.commit = "f".repeat(40); input.existingPinJson = JSON.stringify(pin); },
    (input) => { const pin = JSON.parse(input.existingPinJson); pin.files[0].sha256 = "0".repeat(64); input.existingPinJson = JSON.stringify(pin); },
    (input) => { input.publishedEventsJson = '{"schema":"published-events/1","events":["prior-event"]}'; },
    (input) => { const evidence = JSON.parse(input.evidenceJson); [evidence.entries[0].circleId, evidence.entries[1].circleId] = [evidence.entries[1].circleId, evidence.entries[0].circleId]; input.evidenceJson = JSON.stringify(evidence); },
  ]) {
    const input = mainInput(fixture, data.allFiles); alter(input);
    await assert.rejects(builder.buildPublicationMainStage(source, input), (e) => e.code === "amendment_baseline_changed");
  }
  const input = mainInput(fixture, data.allFiles); input.dataFiles.set(prefix + "circle-identity-groups.json", fixture.dataFiles.get(prefix + "circle-identity-groups.json"));
  await assert.rejects(builder.buildPublicationMainStage(source, input), (e) => e.code === "snapshot_mismatch");
});
