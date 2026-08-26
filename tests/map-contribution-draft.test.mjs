import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const {
  MAP_CONTRIBUTION_DRAFT_SCHEMA, buildMapCandidate, parseMapContributionDraftContent,
  resolveCanonicalMapPeriod, validateMapContributionDraft,
} = await environment.runner.import("/app/map-contribution-draft.ts");
after(async () => { await vite.close(); });

const layout = {
  version: 2,
  template: "SAMPLE",
  width: 200,
  height: 100,
  floor: { x: 0, y: 0, width: 200, height: 100 },
  rows: [{
    label: "S", orientation: "horizontal", confidence: 1,
    slots: [
      { code: "S01", rect: { x: 20, y: 35, width: 50, height: 30 } },
      { code: "S02", rect: { x: 130, y: 35, width: 50, height: 30 } },
    ],
  }],
  pillars: [],
  accessPoints: [],
  landmarks: [],
};

const scope = {
  eventId: "sample",
  periodKey: "1",
  periodAliases: ["1", "day-1"],
  venueSpaceId: "sample-hall",
  mapTemplate: "SAMPLE",
  allowedBoothCodes: ["S01", "S02", "S03"],
  requiredBoothCodes: ["S01", "S02"],
  targetPath: "map.json",
};

test("period aliases resolve to one canonical storage and target key", () => {
  const days = [{ id: 1, label: "Day 1" }, { id: "special", label: "Special" }];
  assert.deepEqual(resolveCanonicalMapPeriod(days, "1"), {
    period: days[0], periodKey: "1", periodAliases: ["1", "day-1"],
  });
  assert.deepEqual(resolveCanonicalMapPeriod(days, "day-1"), {
    period: days[0], periodKey: "1", periodAliases: ["1", "day-1"],
  });
  assert.equal(resolveCanonicalMapPeriod(days, "missing"), null);
  const ambiguous = [{ id: "1" }, { id: "day-1" }];
  assert.deepEqual(resolveCanonicalMapPeriod(ambiguous, "1"), {
    period: ambiguous[0], periodKey: "1", periodAliases: ["1"],
  });
  assert.deepEqual(resolveCanonicalMapPeriod(ambiguous, "day-1"), {
    period: ambiguous[1], periodKey: "day-1", periodAliases: ["day-1", "day-day-1"],
  });
});

const content = (nextLayout = layout) => ({ schema: MAP_CONTRIBUTION_DRAFT_SCHEMA, layout: nextLayout });

test("working drafts use a bounded versioned envelope and valid geometry can be submitted", () => {
  assert.equal(parseMapContributionDraftContent(content())?.layout.template, "SAMPLE");
  assert.equal(parseMapContributionDraftContent({ ...content(), extra: true }), null);
  assert.equal(parseMapContributionDraftContent(content({ ...layout, width: 100_001 })), null);
  assert.deepEqual(validateMapContributionDraft(content(), scope), { ok: true, content: content(), problems: [] });
});

test("malformed nested shapes fail closed before reaching the shared renderer", () => {
  const malformed = content(structuredClone(layout));
  malformed.layout.rows = [null];
  assert.equal(parseMapContributionDraftContent(malformed), null);
  const malformedAccess = content(structuredClone(layout));
  malformedAccess.layout.accessPoints = [{ id: "door", x: 10, y: 10 }];
  assert.equal(parseMapContributionDraftContent(malformedAccess), null);
  const unknownNestedField = content(structuredClone(layout));
  unknownNestedField.layout.rows[0].slots[0].privateNote = "must not enter a candidate";
  assert.equal(parseMapContributionDraftContent(unknownNestedField), null);
});

test("submission reports unknown, missing and overlapping booth rectangles together", () => {
  const invalid = structuredClone(layout);
  invalid.rows[0].slots = [
    { code: "S01", rect: { x: 20, y: 35, width: 50, height: 30 } },
    { code: "X99", rect: { x: 40, y: 40, width: 50, height: 30 } },
  ];
  const result = validateMapContributionDraft(content(invalid), scope);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code).sort(), ["missing_booth", "overlap", "unknown_booth"]);
  assert.deepEqual(result.problems.find(({ code }) => code === "unknown_booth").boothCodes, ["X99"]);
  assert.deepEqual(result.problems.find(({ code }) => code === "missing_booth").boothCodes, ["S02"]);
});

test("candidate export is deterministic, scoped and summarizes reviewable geometry changes", () => {
  const previous = {
    eventId: "sample", revision: 4, sourceName: "reviewed", confidence: 1,
    updatedAt: "2026-08-24T00:00:00.000Z", layout,
  };
  const changed = structuredClone(layout);
  changed.rows[0].slots[0].rect.x = 25;
  changed.rows[0].slots.push({ code: "S03", rect: { x: 82, y: 35, width: 30, height: 30 } });
  const result = buildMapCandidate({
    scope, draftId: "draft-a", draftRevision: 3, layout: changed, previous, now: Date.parse("2026-08-25T10:00:00Z"),
  });
  assert.equal(result.targetPath, "map.json");
  assert.equal(result.candidate.revision, 5);
  assert.equal(result.candidate.sourceName, "map-contribution:draft-a:r3");
  assert.deepEqual(result.diff.addedBoothCodes, ["S03"]);
  assert.deepEqual(result.diff.movedBoothCodes, ["S01"]);
  assert.deepEqual(result.diff.removedBoothCodes, []);
});

test("candidate diff reports a floor-only geometry change", () => {
  const previous = {
    eventId: "sample", revision: 4, sourceName: "reviewed", confidence: 1,
    updatedAt: "2026-08-24T00:00:00.000Z", layout,
  };
  const changed = structuredClone(layout);
  changed.floor.x = 5;
  changed.floor.width = 195;
  const { diff } = buildMapCandidate({
    scope, draftId: "draft-floor", draftRevision: 1, layout: changed, previous, now: Date.parse("2026-08-25T10:00:00Z"),
  });
  assert.equal(diff.dimensionsChanged, false);
  assert.equal(diff.floorChanged, true);
  assert.deepEqual(diff.addedBoothCodes, []);
  assert.deepEqual(diff.removedBoothCodes, []);
  assert.deepEqual(diff.movedBoothCodes, []);
  assert.deepEqual(diff.changedPillarIds, []);
  assert.deepEqual(diff.changedAccessPointIds, []);
  assert.deepEqual(diff.changedLandmarkIds, []);
});
