import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { projectEventWorkspace } = await environment.runner.import("/app/event-workspace-projection.ts");
after(() => vite.close());

const event = (id) => ({
  id, name: id, venue: id, dateRangeLabel: id, dataUpdatedAt: "2026-08-14", dataLastUpdatedLabel: "today", mapTemplate: id,
  areaMode: "switchable", days: [{ id: 1, label: "D1", dateLabel: "D1" }],
  areas: [{ id: "ALL", label: "全部", shortLabel: "全" }, { id: "A", label: "A 區", shortLabel: "A" }],
  genres: ["全部類別", "原創"],
});

function record(eventId, id, code, options = {}) {
  const circle = {
    id, name: options.name ?? id, description: "", categories: [], pen: "", work: "", creatorTypes: [], ageRatings: [], workTypes: [], referencedWorks: [], saleInfo: "", specialTags: [], media: [], externalLinks: [], updatedAt: "2026-08-14", sources: [],
  };
  return {
    id: `${eventId}-${code}`, recordId: `${eventId}-${code}-0`, code, name: circle.name, pen: "", genre: options.genre ?? "原創", tags: [], day: 1, hall: "A", x: 0, y: 0, tone: "coral", work: "", note: "", sources: [], circle,
    placement: { id: `${eventId}-${code}-0`, eventId, circleId: id, day: 1, area: "A", boothCode: code, status: "active", x: 0, y: 0, tone: "coral" },
  };
}

const records = [record("event-a", "c-a", "A01", { name: "Alpha" }), record("event-a", "c-b", "A02", { name: "Beta" }), record("event-b", "c-z", "A01", { name: "Other" })];
const recordsById = new Map(records.map((item) => [item.recordId, item]));
const recordsByCircleId = new Map(records.map((item) => [item.circle.id, [item]]));
const planning = {
  schemaVersion: 3,
  favoriteGroups: [{ id: "g", name: "必逛", color: "coral", sortOrder: 0 }],
  favorites: [
    { eventId: "event-a", circleId: "c-a", groupId: "g", memo: "A", createdAt: "2026-08-14", updatedAt: "2026-08-14" },
    { eventId: "event-b", circleId: "c-z", groupId: null, memo: "B", createdAt: "2026-08-14", updatedAt: "2026-08-14" },
  ],
  visitPlans: [
    { eventId: "event-a", day: 1, circleId: "c-b", status: "next", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-08-14" },
    { eventId: "event-b", day: 1, circleId: "c-z", status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-08-14" },
  ],
};

const defaults = {
  day: 1, area: "ALL", genre: "全部類別", query: "", favoriteOnly: false,
  advancedSearch: { creatorType: "ALL", workQuery: "", workType: "ALL", adultContent: "ALL" },
  planningDisplay: { favoriteGroupId: "ALL", visitStatus: "ALL", sort: "booth", density: "informative", mediaCount: 0 },
  navigationMode: false, selectedRecordId: null,
};

function project(eventId, changes = {}) {
  return projectEventWorkspace({ event: event(eventId), records, recordsById, recordsByCircleId, planning, ...defaults, ...changes });
}

test("all workspace projections are event-scoped across catalog and planning data", () => {
  const a = project("event-a");
  assert.deepEqual(a.filtered.map((item) => item.circle.id), ["c-a", "c-b"]);
  assert.deepEqual(a.favorites.map((item) => item.circleId), ["c-a"]);
  assert.deepEqual(a.dayPlan.map((item) => item.circleId), ["c-b"]);
  assert.deepEqual([...a.markersByCode.values()].flatMap((marker) => marker.records.map((item) => item.circle.id)), ["c-a", "c-b"]);

  const b = project("event-b");
  assert.deepEqual(b.filtered.map((item) => item.circle.id), ["c-z"]);
  assert.deepEqual(b.favorites.map((item) => item.circleId), ["c-z"]);
  assert.deepEqual(b.dayPlan.map((item) => item.circleId), ["c-z"]);
});

/**
 * The map paints a booth as an image only when the slot carries a thumbnail.
 * Since ADR-0012 retired the reviewed thumbnail index almost no slot does, so
 * the projection has to leave `thumbnailUrl` absent rather than pass along an
 * empty string the renderer would treat as a value and draw a blank cell for.
 */
test("a map slot carries a thumbnail only when the circle supplied one", () => {
  const plain = project("event-a");
  assert.deepEqual(Object.values(plain.slots).map((slot) => slot.thumbnailUrl), [undefined, undefined]);

  const pictured = records.map((item) => item.circle.id !== "c-a" ? item : {
    ...item,
    circle: { ...item.circle, media: [{ id: "m", kind: "thumbnail", url: "https://i.imgur.com/self.png", sourceUrl: "https://example.com/self", provider: "社團本人", alt: "" }] },
  });
  const projected = projectEventWorkspace({
    event: event("event-a"), records: pictured,
    recordsById: new Map(pictured.map((item) => [item.recordId, item])),
    recordsByCircleId: new Map(pictured.map((item) => [item.circle.id, [item]])),
    planning, ...defaults,
  });
  assert.equal(projected.slots.A01.thumbnailUrl, "https://i.imgur.com/self.png");
  assert.equal(projected.slots.A02.thumbnailUrl, undefined);
});

test("desktop results, mobile results and map markers consume the same projected ID set", () => {
  const result = project("event-a", { favoriteOnly: true });
  const resultIds = result.filtered.map((item) => item.circle.id);
  const mapIds = [...result.markersByCode.values()].flatMap((marker) => marker.records.map((item) => item.circle.id));
  assert.deepEqual(resultIds, ["c-a"]);
  assert.deepEqual(mapIds, resultIds);
  assert.equal(result.activeFilterDescriptors.some((filter) => filter.id === "favorite"), true);
});

test("navigation projection uses only this event's itinerary and selection", () => {
  const result = project("event-a", { navigationMode: true, selectedRecordId: "event-b-A01-0" });
  assert.deepEqual(result.mapRecords.map((item) => item.circle.id), ["c-b"]);
  assert.equal(result.selected, null, "a selected record from another event cannot leak into details");
  assert.equal(result.nextRecord.circle.id, "c-b");
});
