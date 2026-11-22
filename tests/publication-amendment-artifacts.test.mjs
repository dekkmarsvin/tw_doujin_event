import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { adoptedAmendmentFixture, amendmentFixture, hash } from "./support/organizer-amendment-fixture.mjs";
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

// Approvals published before #546 carry Git-era baselines (ch-20's does), and
// the next correction reads them back: they must still load, and still refuse tampering.
test("a Git-era correction approved with an adopted /2 baseline still loads and still refuses tampering", async () => {
  const fixture = await adoptedAmendmentFixture(runner);
  fixture.baseline = fixture.expectedBaseline;
  const first = await snapshotFor(fixture, [], "adopted-settings", { name: "整合後的活動" });
  const artifacts = await builder.buildApprovedPublicationArtifacts(first.source);
  assert.equal(artifacts.operation, "AMEND");
  assert.equal(artifacts.event.name, "整合後的活動");
  for (const alter of [
    (baseline) => { baseline.schema = "organizer-amendment-baseline/1"; delete baseline.adoption; },
    (baseline) => { baseline.adoption.sha256 = "f".repeat(64); },
    (baseline) => { baseline.source.jobId = "fabricated-job"; },
    (baseline) => { baseline.grouping.groups[0].linkage.value = "unreviewed"; },
    (baseline) => { baseline.evidence.entries[0].aliases.push("unreviewed"); },
  ]) {
    const tampered = structuredClone(first.snapshot);
    const baseline = JSON.parse(tampered.amendment.baselineJson); alter(baseline);
    tampered.amendment.baselineJson = JSON.stringify(baseline);
    tampered.amendment.baselineSha256 = hash(tampered.amendment.baselineJson);
    await assert.rejects(builder.buildApprovedPublicationArtifacts(approved(tampered)), (error) => error.code === "snapshot_mismatch");
  }
});
