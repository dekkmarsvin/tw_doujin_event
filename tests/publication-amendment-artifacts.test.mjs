import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { adoptedAmendmentFixture, amendmentFixture, hash } from "./support/organizer-amendment-fixture.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";
import { planOrganizerAmendment } from "../app/organizer-amendment.mjs";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const builder = await runner.import("/app/publication-artifacts.ts");
const api = await runner.import("/app/organizer-amendment-baseline.ts");
const { pinnedVenue } = await runner.import("/app/organizer-reference-seeds.ts");
after(() => vite.close());
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
test("settings and roster declarations publish together", async () => {
  const fixture = await amendmentFixture(runner);
  const { source } = await snapshotFor(fixture, [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }], "amendment-both", { name: "測試活動 改名" });
  const artifacts = await builder.buildApprovedPublicationArtifacts(source);
  assert.equal(artifacts.event.name, "測試活動 改名");
  assert.equal(Object.hasOwn(artifacts.event, "aliases"), false);
  // The registry the publisher writes for this correction, and what readers get from it.
  const { evidence } = planOrganizerAmendment({ ...fixture.baseline, changes: artifacts.amendment.changes, today: () => "2026-09-16" });
  const reader = buildOfficialCatalogPayload({ eventId: "event-alpha", event: artifacts.event, official: artifacts.official, evidence });
  assert.equal(reader.placements.find((row) => row.boothCode === "S02" && row.status === "active").circleId, "c-000003");
});

test("settings outside their stored form fail closed", async () => {
  const fixture = await amendmentFixture(runner);
  const { snapshot } = await snapshotFor(fixture, [], "amendment-settings", { name: "測試活動 改名" });
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

// #395: an event published before its venue had an address gets it through a
// correction. The venue record may differ from the baseline by that address
// and nothing else.
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
  const artifacts = await builder.buildApprovedPublicationArtifacts(withAddress(completed));
  assert.equal(artifacts.files.find((file) => file.path === venuePath)?.text, completed);

  const renamed = JSON.parse(completed);
  renamed.name = "爭艷館（改名）";
  await assert.rejects(builder.buildApprovedPublicationArtifacts(withAddress(`${JSON.stringify(renamed, null, 2)}\n`)), (e) => e.code === "snapshot_mismatch");
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
