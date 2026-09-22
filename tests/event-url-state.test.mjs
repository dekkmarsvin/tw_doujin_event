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
/** The only shape with an area switcher: areas a reader can navigate between. */
const eventMulti = {
  ...eventA, id: "event-m", name: "M",
  areas: ["N1", "N2", "S1", "S2"].map((id) => ({ id, label: id, shortLabel: id })),
  venueAssignments: [
    { venueId: "venue-m", venueSpaceId: "north-floor", areaIds: ["N1", "N2"] },
    { venueId: "venue-m", venueSpaceId: "south-floor", areaIds: ["S1", "S2"] },
  ],
};
const eventB = {
  ...eventA, id: "event-b", name: "B", days: [{ id: "sat-am", label: "六上午", dateLabel: "六" }],
  areas: [{ id: "NORTH", label: "北館", shortLabel: "北" }], genres: ["所有類型", "攝影"],
  venueAssignments: [{ venueId: "venue-b", venueSpaceId: "hall-b", areaIds: ["NORTH"] }],
};

test("full URL state round-trips through one schema while defaults are omitted", () => {
  const input = new URL("https://map.example/?event=event-a&day=8&area=EAST&query=%20needle%20&genre=%E5%8E%9F%E5%89%B5&favorite=1&creator=Alice&work=Book&workType=male&r18=include&favoriteGroup=g1&visit=next&sort=name&density=compact&media=3&selectedCircle=c-000001&selectedBooth=A01&keep=x");
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
  // 舊連結帶的 original／derivative 已無對應取向，只掉這個條件，不整條 URL 失效。
  const retired = codec.parseEventUrlState(eventA, "https://map.example/?event=event-a&day=7&area=ALL&workType=original");
  assert.equal(retired.state.advancedSearch.workType, "ALL");

  // A parameter naming an inherited property must not become search state: the
  // applied-filter chip renders this value, and an object there blanks the page.
  for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const parsed = codec.parseEventUrlState(eventA, `https://map.example/?event=event-a&day=7&area=ALL&workType=${hostile}`);
    assert.equal(parsed.state.advancedSearch.workType, "ALL", `${hostile} must not resolve to a work type`);
    assert.equal(codec.serializeEventUrlState(eventA, parsed.state, "https://map.example/").searchParams.has("workType"), false);
  }

  const foreign = codec.parseEventUrlState(eventB, "https://map.example/?event=event-a&day=8&query=must-not-leak&selectedCircle=c-000001");
  assert.equal(foreign.eventMatched, false);
  assert.equal(foreign.state.day, "sat-am");
  assert.equal(foreign.state.area, "NORTH");
  assert.equal(foreign.state.query, "");
  assert.equal(foreign.state.selection.circleId, null);
});

test("legacy hall alias parses but serialization emits only area", () => {
  // Read on an event that offers a choice of areas, so the alias is what the
  // assertion is about rather than the widening a single-space event applies.
  const parsed = codec.parseEventUrlState(eventMulti, "https://map.example/?event=event-m&day=7&hall=N2");
  assert.equal(parsed.state.area, "N2");
  const url = codec.serializeEventUrlState(eventMulti, parsed.state, "https://map.example/?hall=N2");
  assert.equal(url.searchParams.get("area"), "N2");
  assert.equal(url.searchParams.has("hall"), false);
});

test("R15 shares and reloads while legacy rating links and unrelated state retain their meaning", () => {
  for (const [parameter, filter, canonical] of [["include", "R18", "include"], ["general", "GENERAL", "general"], ["exclude", "GENERAL", "general"], ["r15", "R15", "r15"]]) {
    const url = `https://map.example/?event=event-a&day=8&query=book&work=first&work=second&workMode=all&workExclude=third&favorite=1&selectedCircle=c-1&selectedBooth=A01&keep=value&r18=${parameter}`;
    const parsed = codec.parseEventUrlState(eventA, url);
    assert.equal(parsed.state.advancedSearch.adultContent, filter);
    const serialized = codec.serializeEventUrlState(eventA, parsed.state, url);
    assert.equal(serialized.searchParams.get("r18"), canonical);
    assert.equal(serialized.searchParams.get("keep"), "value");
    assert.deepEqual(codec.parseEventUrlState(eventA, serialized).state, parsed.state);
  }
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

test("work topics are repeated parameters so a title cannot split itself", () => {
  const parsed = codec.parseEventUrlState(eventA, "https://map.example/?event=event-a&day=7&work=%E5%8E%9F%E7%A5%9E&work=%E8%94%9A%E8%97%8D%E6%AA%94%E6%A1%88&workMode=all&workExclude=%E7%B1%B3%E5%93%88%E9%81%8A");
  assert.deepEqual(parsed.state.advancedSearch.workTopics, ["原神", "蔚藍檔案"]);
  assert.equal(parsed.state.advancedSearch.workTopicMode, "all");
  assert.deepEqual(parsed.state.advancedSearch.excludedWorkTopics, ["米哈遊"]);

  const serialized = codec.serializeEventUrlState(eventA, parsed.state, "https://map.example/");
  assert.deepEqual(serialized.searchParams.getAll("work"), ["原神", "蔚藍檔案"]);
  assert.deepEqual(serialized.searchParams.getAll("workExclude"), ["米哈遊"]);
  assert.deepEqual(codec.parseEventUrlState(eventA, serialized).state, parsed.state);
});

test("a single legacy work parameter still restores as one topic", () => {
  const parsed = codec.parseEventUrlState(eventA, "https://map.example/?event=event-a&day=7&work=Book");
  assert.deepEqual(parsed.state.advancedSearch.workTopics, ["Book"]);
  assert.equal(parsed.state.advancedSearch.workTopicMode, "any");
  assert.equal(codec.serializeEventUrlState(eventA, parsed.state, "https://map.example/").searchParams.has("workMode"), false);
});


test("a URL naming a published event resolves to it, whichever it is", () => {
  const published = [eventA, eventB];
  for (const event of published) {
    const resolved = codec.resolveUrlEvent(published, `https://map.example/?event=${event.id}&day=7`);
    assert.equal(resolved.kind, "event");
    assert.equal(resolved.event.id, event.id);
  }

  // The hard constraint in #119: a link shared before a second event existed
  // must still open the same screen. Links are the only way state moves between
  // devices (ADR-0002), so there is no recovery path if they stop resolving.
  const shared = "https://map.example/?event=event-a&day=8&area=EAST&selectedCircle=c-000001";
  const resolved = codec.resolveUrlEvent(published, shared);
  assert.equal(resolved.kind, "event");
  const state = codec.parseEventUrlState(resolved.event, shared);
  assert.equal(state.eventMatched, true);
  assert.equal(state.state.day, 8);
  assert.equal(state.state.selection.circleId, "c-000001");
  // The event, the day and the selection are what the link promised, and they
  // all survive. The area does not: a single-space event offers no way to pick
  // one, so the filter widens to the whole space. That direction is the point
  // -- nothing the recipient could see before is missing, and the alternative
  // is the state this widening exists to escape, a reader held inside one block
  // with no control to leave it by.
  assert.equal(state.state.area, "ALL");

  const sharedArea = "https://map.example/?event=event-m&day=8&venueSpaceId=south-floor&area=S2&selectedCircle=c-000001";
  const multi = codec.parseEventUrlState(eventMulti, sharedArea);
  assert.deepEqual([multi.state.area, multi.state.venueSpaceId], ["S2", "south-floor"],
    "where the reader can choose an area, a link naming one still lands on it exactly");
});

test("only an unpublished event fails closed; naming none is not an error", () => {
  const published = [eventA, eventB];

  // Answering with another event's map under someone's link is worse than
  // saying the link does not resolve, so this never falls back to a default.
  assert.deepEqual(
    codec.resolveUrlEvent(published, "https://map.example/?event=event-c&day=8"),
    { kind: "unpublished", requested: "event-c" },
  );
  assert.deepEqual(
    codec.resolveUrlEvent(published, "https://map.example/?event=&day=8"),
    { kind: "unpublished", requested: "" },
  );

  // Naming no event means "not chosen yet" once there is a choice to make…
  assert.deepEqual(codec.resolveUrlEvent(published, "https://map.example/"), { kind: "choose" });
  // …and means the only event there is when there is just one, which is what
  // keeps a bare URL behaving exactly as it did before this existed.
  const single = codec.resolveUrlEvent([eventA], "https://map.example/");
  assert.equal(single.kind, "event");
  assert.equal(single.event.id, "event-a");
});

/**
 * The shape of every event published since areas became derived from the
 * organizer's booth list: each id is a code that appeared in that list, so none
 * of them means "all of them". Landing on the first one leaves the reader
 * filtered to one block of a hall they have chosen nothing about yet.
 */
test("an event whose areas are all derived codes still opens on all of them", () => {
  const derived = {
    ...eventA,
    areas: [{ id: "A", label: "A", shortLabel: "A" }, { id: "B", label: "B", shortLabel: "B" }],
    venueAssignments: [{ venueId: "venue-a", venueSpaceId: "hall-a", areaIds: ["A", "B"] }],
  };
  const defaults = codec.defaultEventUrlState(derived);
  assert.equal(defaults.area, "ALL");
  assert.equal(defaults.venueSpaceId, "hall-a");
  assert.equal(codec.serializeEventUrlState(derived, defaults, "https://map.example/").search, "?event=event-a&day=7&area=ALL");
  assert.equal(codec.parseEventUrlState(derived, "https://map.example/?event=event-a&day=7&area=ALL").state.area, "ALL");
  assert.equal(codec.parseEventUrlState(derived, "https://map.example/?event=event-a&day=7&area=B").state.area, "ALL",
    "one hall offers no area to pick, so naming one widens rather than filters");
});

test("a space with one area offers no all-areas state to land in or restore", () => {
  assert.equal(codec.defaultEventUrlState(eventB).area, "NORTH");
  const requested = codec.parseEventUrlState(eventB, "https://map.example/?event=event-b&day=sat-am&area=ALL");
  assert.equal(requested.state.area, "NORTH", "all of one area is that area, not a filter matching nothing");
});

test("all areas is scoped to the venue space the URL names", () => {
  const multiSpace = eventMulti;
  const defaults = codec.defaultEventUrlState(multiSpace);
  assert.deepEqual([defaults.area, defaults.venueSpaceId], ["ALL", "north-floor"]);

  const south = codec.parseEventUrlState(multiSpace, "https://map.example/?event=event-m&day=7&venueSpaceId=south-floor&area=ALL");
  assert.deepEqual([south.state.area, south.state.venueSpaceId], ["ALL", "south-floor"],
    "the sentinel names no space of its own, so the one the URL names has to survive");
  assert.equal(codec.serializeEventUrlState(multiSpace, south.state, "https://map.example/").searchParams.get("venueSpaceId"), "south-floor");
});
