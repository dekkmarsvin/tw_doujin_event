import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildOfficialCatalogPayload } from "../../scripts/official-catalog-core.mjs";

export const hash = (text) => createHash("sha256").update(text).digest("hex");
export async function amendmentFixture(runner) {
  const builder = await runner.import("/app/publication-artifacts.ts");
  const catalog = await runner.import("/app/organizer-reference-catalog.ts");
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const organizer = catalog.createOrganizerReference({ name: "測試主辦", sourceUrl: "https://organizer.example/" }, now);
  const categories = catalog.createCategoryReference({ name: "官方分類", sourceUrl: "https://organizer.example/categories", categories: [{ label: "原創" }] }, organizer.id, now);
  const draft = { schema: "organizer-event-draft/1", event: { id: "event-alpha", name: "測試活動", days: [{ id: "1", label: "第一天", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "taipei-expo-park-zhengyan-hall", venueSpaceId: "zhengyan-exhibition-area", areaIds: ["A", "B"], mapTemplate: "SAMPLE", areaMode: "imported" }] },
    officialSource: { label: "主辦名單", url: "https://organizer.example/event" },
    references: { organizerAssignments: [{ organizerId: organizer.id, role: "lead" }], categoryCatalog: { id: categories.id, organizerId: organizer.id, revision: "1" } } };
  const referenceRecords = [organizer, categories, ...catalog.initialVenueReferences()];
  const references = (await catalog.resolveOrganizerReferences(draft, referenceRecords)).snapshot;
  const rows = ["S01", "S02"].map((code, i) => ({ sourceRow: i + 1, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: i ? "B" : "A", codes: [code], circleName: i ? "乙社" : "甲社", stableKey: null, identityGroup: null }));
  const snapshot = { schema: "organizer-submission-snapshot/3", candidateId: "source", candidateVersion: 1, eventId: "event-alpha", draft,
    contentUpdatedAt: new Date(now).toISOString(), references, import: { source: { sourceDescription: "主辦名單" }, rows },
    maps: [{ id: "source-map", periodKey: "1", venueSpaceId: "zhengyan-exhibition-area", mapRevision: 1,
      content: { schema: "map-contribution-draft/1", layout: JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout } }] };
  const snapshotJson = JSON.stringify(snapshot);
  const source = { candidateId: "source", candidateVersion: 1, jobId: "published-job", snapshotId: "published-snapshot",
    snapshotJson, approvalHash: hash(snapshotJson), mainCommit: "1".repeat(40), dataCommit: "3".repeat(40), publishedAt: now };
  const artifacts = await builder.buildApprovedPublicationArtifacts(source);
  const main = await builder.buildPublicationMainStage(source, { dataCommit: source.dataCommit,
    dataFiles: new Map(artifacts.files.map((file) => [file.path, file.text])), mainCommit: "0".repeat(40),
    publishedEventsJson: '{"schema":"published-events/1","events":["prior-event"]}', existingPinJson: null,
    allocationsJson: '{"schema":"circle-id-allocations/1","nextSequence":1,"allocations":[]}', evidenceJson: '{"schema":"circle-identity-evidence/1","entries":[]}' });
  const mainFiles = new Map(main.files.map((file) => [file.path, file.text]));
  const dataFiles = new Map(artifacts.files.map((file) => [file.path, file.text]));
  const allocations = JSON.parse(mainFiles.get("data/circle-identities/allocations.json"));
  const evidence = JSON.parse(mainFiles.get("data/circle-identities/evidence.json"));
  const published = { dataCommit: source.dataCommit, catalog: buildOfficialCatalogPayload({ eventId: "event-alpha", event: artifacts.event, official: artifacts.official, evidence }) };
  const baseline = { schema: "organizer-amendment-baseline/1", source: { ...source }, mainCommit: "2".repeat(40),
    pin: JSON.parse(mainFiles.get("data/event-data-pins/event-alpha.json")), event: artifacts.event, official: artifacts.official,
    grouping: artifacts.grouping, allocations, evidence, draft, references, maps: snapshot.maps };
  delete baseline.source.snapshotJson;
  return { now, source, snapshot, baseline, published, mainFiles, dataFiles, referenceRecords };
}

export function gitReaderFixture(fixture) {
  const reads = [];
  const main = fixture.mainFiles;
  const original = new Map(main);
  const data = fixture.dataFiles;
  const commits = new Map([[fixture.source.mainCommit, original], [fixture.baseline.mainCommit, main], [fixture.source.dataCommit, data]]);
  return { reads, original, async fetch(url, init) {
    assert.ok(!init?.method || init.method === "GET", "baseline loading must never write to GitHub");
    const path = new URL(url).pathname;
    reads.push(path);
    if (path.endsWith("/git/ref/heads/main")) return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: fixture.baseline.mainCommit } });
    const commit = path.match(/\/git\/commits\/([a-f0-9]{40})$/)?.[1];
    if (commit && commits.has(commit)) return Response.json({ sha: commit, tree: { sha: commit }, parents: [], message: "fixture" });
    const tree = path.match(/\/git\/trees\/([a-f0-9]{40})$/)?.[1];
    if (tree && commits.has(tree)) return Response.json({ sha: tree, truncated: false, tree: [...commits.get(tree)].map(([path, text]) => ({ path, type: "blob", mode: "100644", sha: hash(text).slice(0, 40) })) });
    const blob = path.match(/\/git\/blobs\/([a-f0-9]{40})$/)?.[1];
    if (blob) for (const files of commits.values()) for (const text of files.values()) {
      if (hash(text).slice(0, 40) === blob) return Response.json({ sha: blob, encoding: "base64", content: Buffer.from(text).toString("base64") });
    }
    throw new Error(`Unexpected GitHub read ${path}`);
  } };
}
