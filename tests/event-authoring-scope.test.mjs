import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const scope = await environment.runner.import("/app/event-authoring-scope.ts");
after(() => vite.close());

test("candidate scope resolves one day and venue-space with only its imported booth codes", () => {
  const resolved = scope.resolveCandidateAuthoringScope({
    candidateId: "candidate-pf",
    draft: {
      schema: "organizer-event-draft/1",
      event: { id: "pf45", name: "PF45", days: [{ id: "1", label: "第一日", date: "2026-11-07" }, { id: "2", label: "第二日", date: "2026-11-08" }] },
      venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
      officialSource: { label: "主辦", url: "https://example.test" },
    },
    importedRows: [
      { dayId: "1", venueSpaceId: "hall-a", boothCode: "A01" },
      { dayId: "2", venueSpaceId: "hall-a", boothCode: "A02" },
    ],
  }, "1", "hall-a");
  assert.deepEqual(resolved, {
    kind: "candidate", candidateId: "candidate-pf", eventId: "pf45", periodKey: "1",
    venueSpaceId: "hall-a", mapTemplate: "TAIWAN_GENERIC_V1",
    allowedBoothCodes: ["A01"], requiredBoothCodes: ["A01"], targetPath: null,
  });
});

test("candidate scope rejects a day or venue-space not declared by that candidate", () => {
  const base = {
    candidateId: "candidate-pf",
    draft: {
      schema: "organizer-event-draft/1", event: { id: null, name: "PF", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
      venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "GENERIC" }] },
      officialSource: { label: "", url: null },
    }, importedRows: [],
  };
  assert.equal(scope.resolveCandidateAuthoringScope(base, "2", "hall-a"), null);
  assert.equal(scope.resolveCandidateAuthoringScope(base, "1", "hall-b"), null);
});

test("published scope resolves the same multi-space path contract used by Reader", () => {
  const event = {
    id: "pf45", days: [{ id: 1 }, { id: 2 }], mapTemplate: "GENERIC",
    venueAssignments: [
      { venueSpaceId: "hall-a", areaIds: ["A"] },
      { venueSpaceId: "hall-b", areaIds: ["B"] },
    ],
  };
  const resolved = scope.resolvePublishedAuthoringScope({
    event,
    placements: [
      { day: 1, area: "B", boothCode: "B01", status: "active" },
      { day: 2, area: "B", boothCode: "B02", status: "active" },
      { day: 1, area: "A", boothCode: "A01", status: "active" },
    ],
    existingBoothCodes: ["B00"],
  }, "1", "hall-b");
  assert.deepEqual(resolved, {
    kind: "published", eventId: "pf45", periodKey: "1", venueSpaceId: "hall-b",
    mapTemplate: "GENERIC", allowedBoothCodes: ["B00", "B01", "B02"],
    requiredBoothCodes: ["B01"], targetPath: "maps/1/hall-b.json",
  });
});
