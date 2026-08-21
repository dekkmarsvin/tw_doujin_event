import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { ACTIVE_EVENT, ACTIVE_EVENT_ID, EVENT_DEFINITION_SCHEMA, EVENT_REGISTRY, getEventDefinition, parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
after(async () => vite.close());

test("the active event comes from a versioned validated definition", () => {
  assert.equal(ACTIVE_EVENT.schema, EVENT_DEFINITION_SCHEMA);
  assert.equal(ACTIVE_EVENT.id, "ff47");
  assert.equal(ACTIVE_EVENT.dataLastUpdatedLabel, "2026 年 8 月 11 日");
  assert.equal(ACTIVE_EVENT.organizer.boothListUrls[1].startsWith("https://www.f-2.com.tw/"), true);
  assert.equal(ACTIVE_EVENT_ID, "ff47");
  assert.equal(EVENT_REGISTRY.size, 1);
  assert.equal(getEventDefinition("ff47"), ACTIVE_EVENT);
  assert.equal(getEventDefinition("missing"), null);
});

test("a future event may use different day and area identifiers", () => {
  const future = parseEventDefinition({
    ...ACTIVE_EVENT,
    id: "future-four-day-event",
    areaMode: "switchable",
    days: [1, 2, 3, 4].map((id) => ({ id, label: `DAY ${id}`, dateLabel: `9/${id}` })),
    areas: [
      { id: "north", label: "北館", shortLabel: "北" },
      { id: "south", label: "南館", shortLabel: "南" },
    ],
    organizer: {
      ...ACTIVE_EVENT.organizer,
      boothListUrls: Object.fromEntries([1, 2, 3, 4].map((id) => [id, `https://example.com/day-${id}`])),
    },
  });
  assert.deepEqual(future.days.map(({ id }) => id), [1, 2, 3, 4]);
  assert.deepEqual(future.areas.map(({ id }) => id), ["north", "south"]);
});

test("event definitions fail closed on unknown versions and incomplete organizer data", () => {
  assert.throws(() => parseEventDefinition({ schema: "event-definition/999" }), /Unsupported/);
  assert.throws(() => parseEventDefinition({ ...ACTIVE_EVENT, organizer: { ...ACTIVE_EVENT.organizer, boothListUrls: { 9: "https://example.com" } } }), /cover organizer booth lists/);
});
