import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const codec = await environment.runner.import("/app/event-url-state.ts");
after(() => vite.close());

const eventA = {
  id: "event-a", name: "A", venue: "A", dateRangeLabel: "A", dataUpdatedAt: "2026-01-01", dataLastUpdatedLabel: "A", mapTemplate: "A",
  areaMode: "switchable", days: [{ id: 7, label: "D7", dateLabel: "D7" }, { id: 8, label: "D8", dateLabel: "D8" }],
  areas: [{ id: "ALL", label: "全部", shortLabel: "全" }, { id: "EAST", label: "東區", shortLabel: "東" }], genres: ["全部", "原創"],
  venueAssignments: [{ venueId: "venue-a", venueSpaceId: "hall-a", areaIds: ["ALL", "EAST"] }],
};
const eventB = {
  ...eventA, id: "event-b", name: "B", days: [{ id: "sat-am", label: "六上午", dateLabel: "六" }],
  areas: [{ id: "NORTH", label: "北館", shortLabel: "北" }], genres: ["所有類型", "攝影"],
  venueAssignments: [{ venueId: "venue-b", venueSpaceId: "hall-b", areaIds: ["NORTH"] }],
};

test("full URL state round-trips through one schema while defaults are omitted", () => {
  const input = new URL("https://map.example/?event=event-a&day=8&area=EAST&query=%20needle%20&genre=%E5%8E%9F%E5%89%B5&favorite=1&creator=Alice&work=Book&workType=original&r18=include&favoriteGroup=g1&visit=next&sort=name&density=compact&media=3&selectedCircle=c-000001&selectedBooth=A01&keep=x");
  const parsed = codec.parseEventUrlState(eventA, input);
  assert.equal(parsed.eventMatched, true);
  const serialized = codec.serializeEventUrlState(eventA, parsed.state, input);
  const reparsed = codec.parseEventUrlState(eventA, serialized);
  assert.deepEqual(reparsed.state, { ...parsed.state, query: "needle" });
  assert.equal(serialized.searchParams.get("keep"), "x", "unowned URL state is preserved");

  const defaults = codec.serializeEventUrlState(eventA, codec.defaultEventUrlState(eventA), "https://map.example/?genre=stale&hall=EAST");
  assert.equal(defaults.search, "?event=event-a&day=7&area=ALL");
});

test("invalid values use event-derived defaults and a foreign event fails closed", () => {
  const invalid = codec.parseEventUrlState(eventA, "https://map.example/?event=event-a&day=1&area=WEST&genre=bad&visit=bad&media=2");
  assert.equal(invalid.state.day, 7);
  assert.equal(invalid.state.area, "ALL");
  assert.equal(invalid.state.genre, "全部");
  assert.equal(invalid.state.planningDisplay.visitStatus, "ALL");
  assert.equal(invalid.state.planningDisplay.mediaCount, 0);

  const foreign = codec.parseEventUrlState(eventB, "https://map.example/?event=event-a&day=8&query=must-not-leak&selectedCircle=c-000001");
  assert.equal(foreign.eventMatched, false);
  assert.equal(foreign.state.day, "sat-am");
  assert.equal(foreign.state.area, "NORTH");
  assert.equal(foreign.state.query, "");
  assert.equal(foreign.state.selection.circleId, null);
});

test("legacy hall alias parses but serialization emits only area", () => {
  const parsed = codec.parseEventUrlState(eventA, "https://map.example/?event=event-a&day=7&hall=EAST");
  assert.equal(parsed.state.area, "EAST");
  const url = codec.serializeEventUrlState(eventA, parsed.state, "https://map.example/?hall=EAST");
  assert.equal(url.searchParams.get("area"), "EAST");
  assert.equal(url.searchParams.has("hall"), false);
});

test("URL defaults follow event area order rather than assignment order", () => {
  const reversedAreas = {
    ...eventA,
    venueAssignments: [{ venueId: "venue-a", venueSpaceId: "hall-a", areaIds: ["EAST", "ALL"] }],
  };
  assert.equal(codec.defaultEventUrlState(reversedAreas).area, "ALL");

  const reversedAssignments = {
    ...eventA,
    areas: [{ id: "NORTH", label: "北館", shortLabel: "北" }, { id: "SOUTH", label: "南館", shortLabel: "南" }],
    venueAssignments: [
      { venueId: "venue-a", venueSpaceId: "south-floor", areaIds: ["SOUTH"] },
      { venueId: "venue-a", venueSpaceId: "north-floor", areaIds: ["NORTH"] },
    ],
  };
  const defaults = codec.defaultEventUrlState(reversedAssignments);
  assert.equal(defaults.area, "NORTH");
  assert.equal(defaults.venueSpaceId, "north-floor");
});

test("venue space is shareable only for multi-space events and invalid pairs fail closed", () => {
  const multiSpace = {
    ...eventA,
    areas: [{ id: "NORTH", label: "北館", shortLabel: "北" }, { id: "SOUTH", label: "南館", shortLabel: "南" }],
    venueAssignments: [
      { venueId: "venue-a", venueSpaceId: "north-floor", areaIds: ["NORTH"] },
      { venueId: "venue-a", venueSpaceId: "south-floor", areaIds: ["SOUTH"] },
    ],
  };
  const south = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=south-floor&area=SOUTH");
  assert.equal(south.state.venueSpaceId, "south-floor");
  assert.equal(south.state.area, "SOUTH");
  const serialized = codec.serializeEventUrlState(multiSpace, south.state, "https://map.example/");
  assert.equal(serialized.searchParams.get("venueSpaceId"), "south-floor");

  const mismatched = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=north-floor&area=SOUTH");
  assert.equal(mismatched.state.venueSpaceId, "north-floor");
  assert.equal(mismatched.state.area, "NORTH");

  const reversedMismatch = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=south-floor&area=NORTH");
  assert.equal(reversedMismatch.state.venueSpaceId, "north-floor");
  assert.equal(reversedMismatch.state.area, "NORTH");

  const invalidSpace = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=missing&area=SOUTH");
  assert.equal(invalidSpace.state.venueSpaceId, "north-floor");
  assert.equal(invalidSpace.state.area, "NORTH");
  const unknownArea = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=south-floor&area=BOGUS");
  assert.equal(unknownArea.state.venueSpaceId, "north-floor");
  assert.equal(unknownArea.state.area, "NORTH");
  const missingArea = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-a&day=7&venueSpaceId=south-floor");
  assert.equal(missingArea.state.venueSpaceId, "north-floor");
  assert.equal(missingArea.state.area, "NORTH");
  assert.equal(codec.serializeEventUrlState(multiSpace, invalidSpace.state, "https://map.example/?venueSpaceId=missing").searchParams.get("venueSpaceId"), "north-floor");
  const singleSpace = codec.serializeEventUrlState(eventA, codec.defaultEventUrlState(eventA), "https://map.example/?venueSpaceId=stale");
  assert.equal(singleSpace.searchParams.has("venueSpaceId"), false);
});

test("loading and popstate restoration protect deep links from rewrite", () => {
  assert.equal(codec.shouldWriteEventUrl({ urlReady: true, catalogStatus: "loading", restoringFromPopstate: false }), false);
  assert.equal(codec.shouldWriteEventUrl({ urlReady: true, catalogStatus: "ready", restoringFromPopstate: true }), false);
  assert.equal(codec.shouldWriteEventUrl({ urlReady: true, catalogStatus: "ready", restoringFromPopstate: false }), true);
  assert.equal(codec.historyMethod("push", false), "pushState");
  assert.equal(codec.historyMethod("replace", false), "replaceState");
  assert.equal(codec.historyMethod("push", true), "none");
});
