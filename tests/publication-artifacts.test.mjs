import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, isRunnableDevEnvironment } from "vite";
import { parseEventDataPin } from "../scripts/event-data-pin-utils.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const builder = await runner.import("/app/publication-artifacts.ts");
const catalog = await runner.import("/app/organizer-reference-catalog.ts");
const { validateStagedEventArtifacts } = await runner.import("/app/staged-event-data.ts");
after(() => vite.close());
const hash = (text) => createHash("sha256").update(text).digest("hex");
const source = (snapshot) => { const snapshotJson = JSON.stringify(snapshot); return { snapshotJson, approvalHash: hash(snapshotJson) }; };
const now = Date.parse("2026-09-14T10:00:00.000Z");
const mapLayout = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout;
const allocationsJson = await readFile("data/circle-identities/allocations.json", "utf8");
const evidenceJson = await readFile("data/circle-identities/evidence.json", "utf8");
const ff47PinBefore = await readFile("data/event-data-pins/ff47.json", "utf8");

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
const base = (snapshot) => ({ commit: "a".repeat(40), eventDirectoryExists: false, references: new Map(snapshot.references.files.map((file) => [file.path, null])) });
const mainInput = (files) => ({ dataCommit: "b".repeat(40), dataFiles: new Map(files.map((file) => [file.path, file.text])), mainCommit: "c".repeat(40), publishedEventsJson: '{"schema":"published-events/1","events":["ff47"]}', existingPinJson: null, allocationsJson, evidenceJson });

test("approved snapshot produces deterministic two-stage files and stages through the real Reader pipeline", async () => {
  const snapshot = await sample();
  const approved = source(snapshot);
  const data = await builder.buildPublicationDataStage(approved, base(snapshot));
  assert.deepEqual(await builder.buildPublicationDataStage(approved, base(snapshot)), data);
  const main = await builder.buildPublicationMainStage(approved, mainInput(data.allFiles));
  assert.deepEqual(await builder.buildPublicationMainStage(approved, mainInput(data.allFiles)), main);
  const mainFiles = new Map(main.files.map((file) => [file.path, JSON.parse(file.text)]));
  assert.deepEqual(mainFiles.get("data/published-events.json").events, ["ff47", "next-event"]);
  const pin = parseEventDataPin(mainFiles.get("data/event-data-pins/next-event.json"));
  assert.equal(pin.commit, "b".repeat(40));
  for (const file of pin.files) assert.equal(file.sha256, hash(mainInput(data.allFiles).dataFiles.get(file.path)));
  const previous = JSON.parse(evidenceJson);
  assert.deepEqual(mainFiles.get("data/circle-identities/evidence.json").entries.slice(0, previous.entries.length), previous.entries);
  assert.equal(mainFiles.get("data/circle-identities/evidence.json").entries.length, previous.entries.length + 2, "same names are not linkage");
  assert.equal(await readFile("data/event-data-pins/ff47.json", "utf8"), ff47PinBefore);
  const workspace = await mkdtemp(path.join(tmpdir(), "publication-artifacts-"));
  try {
    for (const file of [...data.allFiles, ...main.files]) {
      const relative = file.path.startsWith("events/next-event/") ? `.event-data/next-event/${file.path.slice("events/next-event/".length)}`
        : file.path.startsWith("references/") ? `.event-data/next-event/${file.path}` : file.path;
      const destination = path.join(workspace, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.text);
    }
    execFileSync(process.execPath, ["scripts/stage-event-data.mjs", "next-event", "--workspace", workspace], { cwd: process.cwd(), stdio: "pipe" });
    execFileSync(process.execPath, ["scripts/check-staged-event-data.mjs", "--workspace", workspace], { cwd: process.cwd(), stdio: "pipe" });
    const root = path.join(workspace, "public/data/events/next-event");
    const reader = JSON.parse(await readFile(path.join(root, "circles.json"), "utf8"));
    assert.deepEqual(reader.placements.map(({ area }) => area), ["A", "B"]);
    const event = JSON.parse(await readFile(path.join(root, "event.json"), "utf8"));
    assert.equal(event.eventEndsAt, "2026-11-07T23:59:59+08:00");
    assert.equal(event.dataUpdatedAt, snapshot.contentUpdatedAt);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("scoped maps retain every day and explicit stable-key linkage without name guessing", async () => {
  const snapshot = await sample({ days: 2 });
  for (const row of snapshot.import.rows.filter((row) => row.codes[0] === "S01")) { row.stableKey = "circle-1"; row.identityGroup = "stable:circle-1"; }
  const approved = source(snapshot);
  const data = await builder.buildPublicationDataStage(approved, base(snapshot));
  assert.ok(!data.files.some((file) => file.path === "events/next-event/map.json"));
  const artifacts = await builder.buildApprovedPublicationArtifacts(approved);
  const main = await builder.buildPublicationMainStage(approved, mainInput(data.allFiles));
  const evidence = JSON.parse(main.files.find((file) => file.path.endsWith("/evidence.json")).text);
  assert.equal(evidence.entries.length, JSON.parse(evidenceJson).entries.length + 3);
  const payload = buildOfficialCatalogPayload({ eventId: "next-event", event: artifacts.event, official: artifacts.official, evidence });
  const jsonFiles = new Map(data.allFiles.filter((file) => file.path.endsWith(".json")).map((file) => [file.path.replace("events/next-event/", ""), JSON.parse(file.text)]));
  const manifest = jsonFiles.get("map-manifest.json");
  assert.equal(manifest.maps.length, 2);
  assert.equal(artifacts.event.eventEndsAt, "2026-11-08T23:59:59+08:00");
  validateStagedEventArtifacts(artifacts.event, snapshot.references.files.map((file) => JSON.parse(file.content)), payload,
    { manifest, maps: new Map(manifest.maps.map((map) => [map.path, jsonFiles.get(map.path)])) }, "next-event");
});

test("existing references preserve original bytes and pin the actual merged formatting", async () => {
  const snapshot = await sample();
  const approved = source(snapshot);
  const existing = base(snapshot);
  const reference = snapshot.references.files[0];
  const bytes = JSON.stringify(JSON.parse(reference.content));
  existing.references.set(reference.path, bytes);
  const data = await builder.buildPublicationDataStage(approved, existing);
  assert.ok(!data.files.some((file) => file.path === reference.path));
  assert.equal(data.allFiles.find((file) => file.path === reference.path).text, bytes);
  const main = await builder.buildPublicationMainStage(approved, mainInput(data.allFiles));
  const pin = JSON.parse(main.files.find((file) => file.path.includes("event-data-pins/")).text);
  assert.equal(pin.files.find((file) => file.path === reference.path).sha256, hash(bytes));
  for (const value of ["{broken", "{}", reference.content.replace('原創', '其他')]) {
    const conflict = base(snapshot); conflict.references.set(reference.path, value);
    await assert.rejects(builder.buildPublicationDataStage(approved, conflict), (error) => error.code === "reference_conflict");
  }
  existing.references.delete(reference.path);
  await assert.rejects(builder.buildPublicationDataStage(approved, existing), /尚未核對/);
});

test("legacy, altered approvals, collisions, missing maps and merged-data drift fail before a write set", async () => {
  const snapshot = await sample();
  const approved = source(snapshot);
  await assert.rejects(builder.buildApprovedPublicationArtifacts({ ...approved, approvalHash: "0".repeat(64) }), /hash/);
  for (const schema of ["organizer-submission-snapshot/1", "organizer-submission-snapshot/2"]) await assert.rejects(builder.buildApprovedPublicationArtifacts(source({ ...snapshot, schema })), /歷史 snapshot/);
  await assert.rejects(builder.buildPublicationDataStage(approved, { ...base(snapshot), eventDirectoryExists: true }), (error) => error.code === "event_id_collision");
  await assert.rejects(builder.buildPublicationDataStage(approved, { ...base(snapshot), commit: "main" }), /commit/);
  await assert.rejects(builder.buildApprovedPublicationArtifacts(source({ ...snapshot, maps: [] })), /地圖/);
  const data = await builder.buildPublicationDataStage(approved, base(snapshot));
  for (const override of [{ existingPinJson: "{}" }, { publishedEventsJson: '{"schema":"published-events/1","events":["ff47","next-event"]}' }]) {
    await assert.rejects(builder.buildPublicationMainStage(approved, { ...mainInput(data.allFiles), ...override }), (error) => error.code === "event_id_collision");
  }
  const input = mainInput(data.allFiles);
  input.dataFiles.set("events/next-event/official-booths.json", "{}");
  await assert.rejects(builder.buildPublicationMainStage(approved, input), (error) => error.code === "snapshot_mismatch");
  input.dataFiles.delete("events/next-event/official-booths.json");
  await assert.rejects(builder.buildPublicationMainStage(approved, input), /缺少/);
});
