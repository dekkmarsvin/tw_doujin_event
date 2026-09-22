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
  venueAssignments: [{ venueSpaceId: "main", areaIds: ["ALL", "A"] }],
  genres: ["全部類別", "原創"],
});

function record(eventId, id, code, options = {}) {
  const circle = {
    id, name: options.name ?? id, description: "", categories: [], circleCategory: options.genre ?? "原創", pen: "", work: "", creatorTypes: [], ageRatings: [], workTypes: [], referencedWorks: [], saleInfo: "", specialTags: [], media: [], externalLinks: [], updatedAt: "2026-08-14", sources: [],
  };
  const recordId = `${eventId}-${code}-${options.suffix ?? 0}`;
  return {
    id: `${eventId}-${code}`, recordId, code, name: circle.name, pen: "", genre: options.genre ?? "原創", tags: [], day: options.day ?? 1, hall: "A", x: 0, y: 0, tone: "coral", work: "", note: "", sources: [], circle,
    placement: { id: recordId, eventId, circleId: id, day: options.day ?? 1, area: "A", boothCode: code, status: options.status ?? "active", x: 0, y: 0, tone: "coral" },
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
  day: 1, area: "ALL", venueSpaceId: "main", genre: "全部類別", query: "", favoriteOnly: false,
  advancedSearch: { creatorType: "ALL", workTopics: [], workTopicMode: "any", excludedWorkTopics: [], workType: "ALL", adultContent: "ALL" },
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

test("navigation covers all areas in the current space without mixing identical booth codes from another space", () => {
  const secondSpace = record("event-a", "c-other-space", "A02", { suffix: 1 });
  secondSpace.hall = secondSpace.placement.area = "B";
  const all = [...records, secondSpace];
  const multiEvent = { ...event("event-a"), areas: [...event("event-a").areas, { id: "B", label: "B", shortLabel: "B" }], venueAssignments: [
    { venueSpaceId: "main", areaIds: ["ALL", "A"] }, { venueSpaceId: "other", areaIds: ["B"] },
  ] };
  const input = {
    event: multiEvent, records: all, recordsById: new Map(all.map((item) => [item.recordId, item])), recordsByCircleId: new Map(all.map((item) => [item.circle.id, [item]])),
    planning: { ...planning, visitPlans: [...planning.visitPlans, { ...planning.visitPlans[0], circleId: "c-other-space", routeOrder: 1 }] },
    ...defaults, navigationMode: true, query: "a filter that excludes everything", favoriteOnly: true,
  };
  assert.deepEqual(projectEventWorkspace(input).markersByCode.get("A02").records.map((item) => item.circle.id), ["c-b"]);
  assert.deepEqual(projectEventWorkspace({ ...input, area: "B", venueSpaceId: "other" }).markersByCode.get("A02").records.map((item) => item.circle.id), ["c-other-space"]);
  assert.equal(input.query, "a filter that excludes everything");
  assert.equal(input.area, "ALL");
});

test("each applied work topic gets its own removable chip", () => {
  const projected = project("event-a", {
    advancedSearch: { ...defaults.advancedSearch, workTopics: ["原神", "蔚藍檔案"], workTopicMode: "all", excludedWorkTopics: ["米哈遊"] },
  });
  const topics = projected.activeFilterDescriptors.filter((filter) => filter.kind === "work");
  assert.deepEqual(topics.map((filter) => filter.value), ["原神", "蔚藍檔案"]);
  assert.deepEqual(topics.map((filter) => filter.label), ["同時包含：原神", "同時包含：蔚藍檔案"]);
  assert.equal(new Set(projected.activeFilterDescriptors.map((filter) => filter.id)).size, projected.activeFilterDescriptors.length);
  assert.deepEqual(
    projected.activeFilterDescriptors.filter((filter) => filter.kind === "work-exclude").map((filter) => filter.label),
    ["排除：米哈遊"],
  );
});

test("match reasons cover exactly the visible results", () => {
  const projected = project("event-a", { query: "alpha" });
  assert.deepEqual(projected.filtered.map((item) => item.recordId), [...projected.matchReasonsByRecordId.keys()]);
  assert.deepEqual(projected.matchReasonsByRecordId.get("event-a-A01-0").map((reason) => reason.label), ["關鍵字命中社團名"]);
});

test("result and category counts use circle identity without losing booth records", () => {
  const countedRecords = [
    record("event-a", "c-a", "A01", { name: "同名社團", genre: "全部類別" }),
    record("event-a", "c-a", "A02", { name: "同名社團", genre: "全部類別" }),
    record("event-a", "c-b", "A03", { name: "同名社團" }),
    record("event-a", "c-b", "A04", { name: "同名社團" }),
    record("event-a", "c-a", "A05", { day: 2, genre: "全部類別" }),
    record("event-a", "c-next-day", "A06", { day: 2 }),
    record("event-b", "c-other-event", "A07"),
  ];
  const countedByCircleId = new Map();
  countedRecords.forEach((item) => countedByCircleId.set(item.circle.id, [...(countedByCircleId.get(item.circle.id) ?? []), item]));
  const input = {
    event: event("event-a"), records: countedRecords,
    recordsById: new Map(countedRecords.map((item) => [item.recordId, item])),
    recordsByCircleId: countedByCircleId, planning, ...defaults,
  };
  const all = projectEventWorkspace(input);
  assert.equal(all.resultCircleCount, 2, "same names are not identities; two booths are not two circles");
  assert.equal(all.filtered.length, 4);
  assert.deepEqual([...all.markersByCode.keys()], ["A01", "A02", "A03", "A04"]);
  assert.deepEqual([...all.genreCounts], [["全部類別", 2], ["原創", 1]], "unclassified circles count once in the total");

  const favorite = projectEventWorkspace({ ...input, favoriteOnly: true });
  assert.equal(favorite.resultCircleCount, 1);
  assert.equal(favorite.filtered.length, 2);
  assert.deepEqual([...favorite.genreCounts], [...all.genreCounts], "category availability does not narrow with favorites");
  const category = projectEventWorkspace({ ...input, genre: "原創" });
  assert.equal(category.resultCircleCount, 1);
  assert.deepEqual(category.filtered.map((item) => item.code), ["A03", "A04"]);
  const singleBooth = projectEventWorkspace({ ...input, query: "A02" });
  assert.equal(singleBooth.resultCircleCount, 1);
  assert.equal(singleBooth.filtered.length, 1);
  const empty = projectEventWorkspace({ ...input, query: "no such circle" });
  assert.equal(empty.resultCircleCount, 0);
  assert.equal(empty.filtered.length, 0);
  const nextDay = projectEventWorkspace({ ...input, day: 2 });
  assert.equal(nextDay.resultCircleCount, 2);
  assert.deepEqual([...nextDay.genreCounts], [["全部類別", 2], ["原創", 1]]);
});

test("retired and shared-booth results still count distinct circles", () => {
  const projected = projectRetired();
  assert.equal(projected.resultCircleCount, 5);
  assert.equal(projected.filtered.length, 6, "the moved circle retains both locations");
  assert.equal(projected.genreCounts.get("全部類別"), 5);
});


/**
 * #140. A withdrawn or moved circle stays in the catalog so favourites and
 * shared links keep resolving; every reader surface has to say which of the two
 * it is rather than draw the booth as a normal destination.
 */
const retiredRecords = [
  record("event-c", "c-moved", "A03", { name: "移動社團", status: "moved" }),
  record("event-c", "c-moved", "A09", { name: "移動社團" }),
  record("event-c", "c-gone", "A04", { name: "退出社團", status: "cancelled" }),
  record("event-c", "c-lost", "A06", { name: "去向不明社團", status: "moved" }),
  record("event-c", "c-old", "A05", { name: "換手前社團", status: "cancelled", suffix: "old" }),
  record("event-c", "c-new", "A05", { name: "換手後社團", suffix: "new" }),
];
const retiredPlanning = {
  schemaVersion: 3,
  favoriteGroups: [],
  favorites: [{ eventId: "event-c", circleId: "c-gone", groupId: null, memo: "", createdAt: "2026-08-30", updatedAt: "2026-08-30" }],
  visitPlans: [{ eventId: "event-c", day: 1, circleId: "c-moved", status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-08-30" }],
};

function projectRetired(changes = {}) {
  const recordsByCircleId = new Map();
  retiredRecords.forEach((item) => recordsByCircleId.set(item.circle.id, [...(recordsByCircleId.get(item.circle.id) ?? []), item]));
  return projectEventWorkspace({
    event: event("event-c"), records: retiredRecords,
    recordsById: new Map(retiredRecords.map((item) => [item.recordId, item])),
    recordsByCircleId, planning: retiredPlanning, ...defaults, ...changes,
  });
}

test("a booth nobody is attending is projected as retired, and says which kind", () => {
  const projected = projectRetired();
  assert.equal(projected.slots.A04.retired, "cancelled");
  assert.equal(projected.slots.A03.retired, "moved");
  assert.match(projected.slots.A04.ariaLabel, /已取消參展/);
  assert.match(projected.slots.A03.ariaLabel, /已移動攤位/);
  assert.match(projected.slots.A04.label, /已取消參展/);
  assert.equal(projected.slots.A09.retired, undefined);
});

test("a booth someone else took over stays a destination", () => {
  const projected = projectRetired();
  assert.equal(projected.slots.A05.retired, undefined);
  assert.doesNotMatch(projected.slots.A05.ariaLabel, /已取消參展/, "one slot label cannot speak for two circles at once");
  assert.deepEqual(projected.filtered.filter((item) => item.code === "A05").map((item) => item.placement.status), ["cancelled", "active"]);
});

test("a moved placement resolves to the circle's live booth, and only when there is one", () => {
  assert.equal(projectRetired({ selectedRecordId: "event-c-A03-0" }).selectedMovedDestination.code, "A09");
  assert.equal(projectRetired({ selectedRecordId: "event-c-A06-0" }).selectedMovedDestination, null);
  assert.equal(projectRetired({ selectedRecordId: "event-c-A04-0" }).selectedMovedDestination, null);
});

test("the itinerary resolves a moved circle to the booth a reader can still walk to", () => {
  const projected = projectRetired();
  assert.equal(projected.dayRecordsByCircleId.get("c-moved").code, "A09");
  assert.equal(projected.dayRecordsByCircleId.get("c-gone").code, "A04");
});

test("a favourite survives its circle leaving the event and never moves to another circle", () => {
  const projected = projectRetired();
  assert.deepEqual(projected.favorites.map((item) => item.circleId), ["c-gone"]);
  assert.equal(projected.favoriteIds.has("c-gone"), true);
  assert.deepEqual(projected.filtered.filter((item) => projected.favoriteIds.has(item.circle.id)).map((item) => item.name), ["退出社團"]);
});

const pairRecords = [
  record("event-p", "c-pair", "A01", { name: "雙攤社團" }),
  record("event-p", "c-pair", "A02", { name: "雙攤社團", suffix: "second" }),
  record("event-p", "c-pair", "A09", { name: "雙攤社團", suffix: "other-day", day: 2 }),
  record("event-p", "c-closed", "B01", { name: "撤攤社團", status: "cancelled" }),
  record("event-p", "c-closed", "B02", { name: "撤攤社團", suffix: "live" }),
];
const pairPlanning = {
  schemaVersion: 3,
  favoriteGroups: [],
  favorites: [],
  visitPlans: [
    { eventId: "event-p", day: 1, circleId: "c-pair", status: "next", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-09-12" },
    { eventId: "event-p", day: 1, circleId: "c-closed", status: "planned", routeOrder: 1, purchaseMemo: "", budget: null, updatedAt: "2026-09-12" },
  ],
};

function projectPair(records) {
  const recordsByCircleId = new Map();
  records.forEach((item) => recordsByCircleId.set(item.circle.id, [...(recordsByCircleId.get(item.circle.id) ?? []), item]));
  return projectEventWorkspace({
    event: event("event-p"), records,
    recordsById: new Map(records.map((item) => [item.recordId, item])),
    recordsByCircleId, planning: pairPlanning, ...defaults,
  });
}

test("a circle on two booths resolves to one of them, and the itinerary and navigation agree", () => {
  const projected = projectPair(pairRecords);
  assert.equal(projected.nextRecord.code, "A01");
  assert.equal(projected.navigationTargetRecord.code, "A01");
  assert.equal(projected.dayRecordsByCircleId.get("c-pair").code, "A01");
});

test("the resolved booth follows the record order rather than whichever record was read last", () => {
  assert.equal(projectPair([...pairRecords].reverse()).navigationTargetRecord.code, "A02");
});

test("booth resolution skips another day and prefers a live booth over a retired one", () => {
  const projected = projectPair(pairRecords);
  assert.equal(projected.dayRecordsByCircleId.get("c-pair").day, 1);
  assert.equal(projected.dayRecordsByCircleId.get("c-closed").code, "B02");
});

/**
 * Areas are derived from the organizer's booth list, so an event can have a
 * dozen of them and no id that means all of them. The reader supplies `ALL`
 * itself, and it has to mean this venue space rather than the whole event: the
 * map on screen covers one day in one space, so a booth from another space has
 * no coordinates to be drawn at.
 */
test("all areas covers every area of the reader's space and none of another's", () => {
  const areaOf = (item, area) => { item.hall = item.placement.area = area; return item; };
  const derivedRecords = [
    areaOf(record("event-d", "c-a", "A01"), "A"),
    areaOf(record("event-d", "c-b", "B01"), "B"),
    areaOf(record("event-d", "c-s", "S01", { suffix: 1 }), "S"),
  ];
  const derivedEvent = {
    ...event("event-d"),
    areas: ["A", "B", "S"].map((id) => ({ id, label: id, shortLabel: id })),
    venueAssignments: [{ venueSpaceId: "main", areaIds: ["A", "B"] }, { venueSpaceId: "annex", areaIds: ["S"] }],
  };
  const project = (changes) => projectEventWorkspace({
    event: derivedEvent, records: derivedRecords,
    recordsById: new Map(derivedRecords.map((item) => [item.recordId, item])),
    recordsByCircleId: new Map(derivedRecords.map((item) => [item.circle.id, [item]])),
    planning: { schemaVersion: 3, favoriteGroups: [], favorites: [], visitPlans: [] },
    ...defaults, ...changes,
  });

  assert.deepEqual(project({ area: "ALL" }).filtered.map((item) => item.circle.id), ["c-a", "c-b"]);
  assert.deepEqual(project({ area: "B" }).filtered.map((item) => item.circle.id), ["c-b"]);
  assert.deepEqual(project({ area: "ALL", venueSpaceId: "annex" }).filtered.map((item) => item.circle.id), ["c-s"]);
  assert.equal(project({ area: "ALL" }).genreCounts.get("全部類別"), 2);
  assert.equal(project({ area: "B" }).genreCounts.get("全部類別"), 1);
  assert.equal(project({ area: "ALL", venueSpaceId: "annex" }).genreCounts.get("全部類別"), 1);
});

test("the area chip appears for a chosen area and not for all of them", () => {
  // Two venue spaces, because that is the only event whose reader can choose an
  // area at all; a chip for a state nobody can reach would prove nothing.
  const derivedEvent = {
    ...event("event-a"),
    areas: ["A", "B", "S"].map((id) => ({ id, label: `${id} 區`, shortLabel: id })),
    venueAssignments: [{ venueSpaceId: "main", areaIds: ["A", "B"] }, { venueSpaceId: "annex", areaIds: ["S"] }],
  };
  const project = (area) => projectEventWorkspace({
    event: derivedEvent, records, recordsById, recordsByCircleId, planning, ...defaults, area,
  }).activeFilterDescriptors.filter((filter) => filter.kind === "area");

  assert.deepEqual(project("ALL"), []);
  assert.deepEqual(project("A").map((filter) => filter.label), ["A 區"]);
});
