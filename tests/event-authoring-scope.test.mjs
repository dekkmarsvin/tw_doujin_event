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
    allowedBoothCodes: ["A01"], requiredBoothCodes: ["A01"],
    allowsUnallocatedBooths: true, targetPath: null,
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
    allowsUnallocatedBooths: false,
    requiredBoothCodes: ["B01"], targetPath: "maps/1/hall-b.json",
  });
});

/* A hall re-laid out overnight needs one artifact per day, so the artifact path
 * follows day x hall rather than hall alone. An event with nothing to scope
 * keeps the flat map.json that predates scoped maps. */
test("published scope scopes the artifact path per day even inside a single hall", () => {
  const singleHall = {
    id: "k51", mapTemplate: "GENERIC",
    days: [{ id: 1 }, { id: 2 }],
    venueAssignments: [{ venueSpaceId: "kaohsiung-10f", areaIds: ["A"] }],
  };
  const placements = [
    { day: 1, area: "A", boothCode: "B01", status: "active" },
    { day: 2, area: "A", boothCode: "B02", status: "active" },
  ];
  assert.equal(scope.resolvePublishedAuthoringScope({ event: singleHall, placements }, "1", "kaohsiung-10f").targetPath,
    "maps/1/kaohsiung-10f.json");
  assert.equal(scope.resolvePublishedAuthoringScope({ event: singleHall, placements }, "2", "kaohsiung-10f").targetPath,
    "maps/2/kaohsiung-10f.json");

  const oneDay = { ...singleHall, days: [{ id: 1 }] };
  assert.equal(scope.resolvePublishedAuthoringScope({ event: oneDay, placements }, "1", "kaohsiung-10f").targetPath,
    "map.json");

  // A day id only has to be a non-empty string, so it can hold characters no
  // path may carry. An artifact with no representable path is an unresolvable
  // scope, not an exception thrown out of a request handler.
  const unsafeDay = { ...singleHall, days: [{ id: "第一天" }, { id: 2 }] };
  assert.equal(scope.resolvePublishedAuthoringScope({ event: unsafeDay, placements }, "第一天", "kaohsiung-10f"), null);
  // The same event resolves fine on the day whose id is representable.
  assert.equal(scope.resolvePublishedAuthoringScope({ event: unsafeDay, placements }, "2", "kaohsiung-10f").targetPath,
    "maps/2/kaohsiung-10f.json");
});
