import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { ACTIVE_EVENT, ACTIVE_EVENT_ID, EVENT_DEFINITION_SCHEMA, EVENT_REGISTRY, getEventDefinition, parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
const sampleDefinition = JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url), "utf8"));
const sampleReferences = JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url), "utf8"));
after(async () => vite.close());

test("the active event comes from a versioned validated definition", () => {
  assert.equal(ACTIVE_EVENT.schema, EVENT_DEFINITION_SCHEMA);
  assert.equal(ACTIVE_EVENT.id, "sample");
  assert.equal(ACTIVE_EVENT.dataLastUpdatedLabel, "2026 年 1 月 1 日");
  assert.equal(ACTIVE_EVENT.officialData.boothListUrls[1].startsWith("https://example.invalid/"), true);
  assert.deepEqual(ACTIVE_EVENT.organizerAssignments.map(({ organizerId, role }) => ({ organizerId, role })), [{ organizerId: "sample-organizer", role: "lead" }]);
  assert.equal(ACTIVE_EVENT.venueAssignments[0].venueSpaceId, "sample-hall");
  assert.equal(ACTIVE_EVENT_ID, "sample");
  assert.deepEqual(ACTIVE_EVENT.genres, ["全部類別", "原創作品", "遊戲作品"]);
  assert.deepEqual(ACTIVE_EVENT.circleCategories.sources.map(({ url }) => url), ["https://example.invalid/sample/categories"]);
  assert.equal(EVENT_REGISTRY.size, 2);
  assert.equal(getEventDefinition("sample"), ACTIVE_EVENT);
  assert.deepEqual(getEventDefinition("sample-two")?.days.map(({ id }) => id), ["thu", "fri", "sat", "sun"]);
  assert.equal(getEventDefinition("sample-two")?.venueAssignments[0].venueId, ACTIVE_EVENT.venueAssignments[0].venueId);
  assert.notEqual(getEventDefinition("sample-two")?.venueAssignments[0].venueSpaceId, ACTIVE_EVENT.venueAssignments[0].venueSpaceId);
  assert.equal(getEventDefinition("missing"), null);
});

test("a future event may use different day and area identifiers", () => {
  const futureReferences = structuredClone(sampleReferences);
  futureReferences.push({
    ...structuredClone(futureReferences.find(({ schema }) => schema === "venue-space/1")),
    id: "sample-south-floor",
    name: "範例南館樓層",
  });
  const future = parseEventDefinition({
    ...sampleDefinition,
    id: "future-four-day-event",
    areaMode: "switchable",
    days: [1, 2, 3, 4].map((id) => ({ id, label: `DAY ${id}`, dateLabel: `9/${id}` })),
    areas: [
      { id: "north", label: "北館", shortLabel: "北" },
      { id: "south", label: "南館", shortLabel: "南" },
    ],
    venueAssignments: [
      { venueId: "sample-venue", venueSpaceId: "sample-hall", areaIds: ["north"] },
      { venueId: "sample-venue", venueSpaceId: "sample-south-floor", areaIds: ["south"] },
    ],
    officialData: {
      ...ACTIVE_EVENT.officialData,
      boothListUrls: Object.fromEntries([1, 2, 3, 4].map((id) => [id, `https://example.com/day-${id}`])),
    },
  }, futureReferences);
  assert.deepEqual(future.days.map(({ id }) => id), [1, 2, 3, 4]);
  assert.deepEqual(future.areas.map(({ id }) => id), ["north", "south"]);
  assert.deepEqual(future.venueAssignments.map(({ venueSpaceId }) => venueSpaceId), ["sample-hall", "sample-south-floor"]);
});

test("category projection preserves every official source and normalizes an omitted description", () => {
  const references = structuredClone(sampleReferences);
  const catalog = references.find(({ schema }) => schema === "category-catalog/1");
  delete catalog.categories[0].description;
  catalog.sources.push({
    id: "category-page-two",
    kind: "organizer-official",
    url: "https://example.invalid/sample/categories-2",
    retrievedAt: "2026-01-01T01:00:00.000+08:00",
  });
  const event = parseEventDefinition(sampleDefinition, references);
  assert.equal(event.circleCategories.categories[0].description, "");
  assert.deepEqual(event.circleCategories.sources.map(({ id, url }) => ({ id, url })), [
    { id: "category-page", url: "https://example.invalid/sample/categories" },
    { id: "category-page-two", url: "https://example.invalid/sample/categories-2" },
  ]);
});

test("event definitions fail closed on v2, incomplete assignments and mismatched references", () => {
  assert.throws(() => parseEventDefinition({ schema: "event-definition/2" }, sampleReferences), /Unsupported/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, venue: "inline copy" }, sampleReferences), /unknown field venue/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, days: [{ ...sampleDefinition.days[0], unexpected: true }] }, sampleReferences), /unknown field unexpected/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, eventEndsAt: "2026-02-30T23:59:59.999Z" }, sampleReferences), /valid ISO instants/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, officialData: { ...sampleDefinition.officialData, boothListUrls: { 9: "https://example.com" } } }, sampleReferences), /cover official booth lists/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, organizerAssignments: [{ organizerId: "sample-organizer", role: "partner" }] }, sampleReferences), /exactly one lead/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, categoryCatalog: { ...sampleDefinition.categoryCatalog, revision: "missing" } }, sampleReferences), /must resolve exactly once/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, venueAssignments: [{ ...sampleDefinition.venueAssignments[0], venueSpaceId: "missing" }] }, sampleReferences), /must resolve exactly once/);
  assert.throws(() => parseEventDefinition({ ...sampleDefinition, venueAssignments: [{ ...sampleDefinition.venueAssignments[0], areaIds: ["north"] }] }, sampleReferences), /uniquely cover every area/);
});

test("one event may assign lead, co-organizer and partner roles", () => {
  const references = structuredClone(sampleReferences);
  for (const [id, name] of [["sample-co-organizer", "共同主辦"], ["sample-partner", "協力單位"]]) {
    references.push({
      ...structuredClone(references.find(({ schema }) => schema === "organizer/1")),
      id,
      name,
    });
  }
  references.push({
    ...structuredClone(references.find(({ schema }) => schema === "category-catalog/1")),
    organizerId: "sample-co-organizer",
    revision: "other-revision",
  });
  const event = parseEventDefinition({
    ...sampleDefinition,
    organizerAssignments: [
      { organizerId: "sample-organizer", role: "lead" },
      { organizerId: "sample-co-organizer", role: "co-organizer" },
      { organizerId: "sample-partner", role: "partner" },
    ],
  }, references);
  assert.deepEqual(event.organizerAssignments.map(({ role }) => role), ["lead", "co-organizer", "partner"]);
});
