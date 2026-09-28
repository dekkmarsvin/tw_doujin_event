import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const runner = vite.environments.ssr;
if (!isRunnableDevEnvironment(runner)) throw new Error("Missing SSR runner");
after(() => vite.close());
const { projectCatalogBrowse } = await runner.runner.import("/app/catalog-browse-projection.ts");
const { parseCatalogBrowseUrl, catalogBrowseUrl, switchReaderViewUrl, readerView } = await runner.runner.import("/app/catalog-browse-url.ts");
const { buildCircleCatalog } = await runner.runner.import("/app/circle-records.ts");
const { projectEventWorkspace } = await runner.runner.import("/app/event-workspace-projection.ts");
const { defaultEventUrlState } = await runner.runner.import("/app/event-url-state.ts");
const { EMPTY_PLANNING_DOCUMENT } = await runner.runner.import("/app/planning-store.ts");
const { readBrowseHistory } = await runner.runner.import("/app/catalog-browse-history.ts");
const { parseEventDefinition } = await runner.runner.import("/app/event-catalog.ts");
const event = parseEventDefinition(JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url))), JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url))));
const base = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url)));
const all = parseCatalogBrowseUrl(event, new URL("https://example.test/?event=sample&view=browse"));
function catalog() {
  const data = structuredClone(base);
  data.circles.push({ id: "c-900003", name: "北風畫室" }, { id: "c-900004", name: "取消社團" });
  data.placements.push(
    { ...data.placements[0], id: "shared", circleId: "c-900003" },
    { ...data.placements[0], id: "moved", boothCode: "A01", status: "moved" },
    { ...data.placements[0], id: "cancelled", circleId: "c-900004", status: "cancelled" },
  );
  return buildCircleCatalog(data, { schema: "circle-overrides/1", eventId: "sample", revision: 1, generatedAt: base.generatedAt,
    overrides: [{ circleId: "c-900001", fields: { referencedWorks: ["ウマ娘"], ageRatings: ["全年齡", "R18"],
      catalogImages: [{ url: "https://pictures.test/full.jpg", previewUrl: "https://pictures.test/preview.jpg", width: 800, height: 4000 }],
    } }],
  }, event);
}
test("browse aggregates identity, preserves shared/name duplicates and separates retired destinations", () => {
  const result = projectCatalogBrowse(event, catalog().records, all);
  assert.equal(result.circleCount, 4);
  assert.equal(result.placementCount, 6);
  assert.equal(result.withCatalog.length, 1);
  assert.equal(result.withCatalog[0].placements.length, 3);
  assert.equal(result.withCatalog[0].destinations.length, 2);
  assert.equal(result.withoutCatalog.at(-1).circle.id, "c-900004");
  assert.equal(result.topics[0].count, 1);
  assert.equal(result.topics[0].value, "賽馬娘 Pretty Derby");
});
test("same public scope/search yields the union of catalog and text cards equal to map circles", () => {
  const data = catalog();
  for (const query of ["", "S01", "北風"]) for (const day of event.days) {
    const state = { ...defaultEventUrlState(event), query, day: day.id };
    const map = projectEventWorkspace({ event, ...state, records: data.records, recordsById: data.recordsById,
      recordsByCircleId: data.recordsByCircleId, planning: EMPTY_PLANNING_DOCUMENT, navigationMode: false, selectedRecordId: null });
    const browse = projectCatalogBrowse(event, data.records, state);
    assert.deepEqual(new Set([...browse.withCatalog, ...browse.withoutCatalog].map((card) => card.circle.id)), new Set(map.filtered.map((record) => record.circle.id)));
  }
});
test("browse retains aliases, exclusion and explicit mixed ratings", () => {
  const data = catalog();
  const state = { ...all, advancedSearch: { ...all.advancedSearch, workTopics: ["賽馬娘"], adultContent: "R18" } };
  assert.equal(projectCatalogBrowse(event, data.records, state).circleCount, 1);
  assert.equal(projectCatalogBrowse(event, data.records, { ...state, advancedSearch: { ...state.advancedSearch, excludedWorkTopics: ["Uma Musume Pretty Derby"] } }).circleCount, 0);
});
test("browse URL encodes all scope by omission and shares only applied public criteria", () => {
  assert.equal(all.day, null); assert.equal(all.venueSpaceId, null);
  const dirty = new URL("https://example.test/?event=sample&view=browse&day=2&work=賽馬娘&workExclude=原創&r18=include&favorite=1&favoriteGroup=secret&visit=next&selectedCircle=c-900001&memo=private#secret");
  const state = parseCatalogBrowseUrl(event, dirty);
  assert.equal(state.day, 2);
  const clean = catalogBrowseUrl(event, state, dirty.origin);
  assert.deepEqual([...clean.searchParams.keys()], ["event", "view", "day", "work", "workExclude", "r18"]);
  assert.equal(clean.hash, "");
  assert.deepEqual(parseCatalogBrowseUrl(event, clean), state);
  const map = switchReaderViewUrl(event, clean);
  assert.equal(readerView(map), "map");
  assert.equal(map.searchParams.get("day"), "2");
  const back = switchReaderViewUrl(event, map);
  assert.equal(back.searchParams.get("work"), "賽馬娘");
  assert.equal(back.searchParams.get("day"), "2");
});
test("legacy space inference and invalid explicit scope use map defaults; string days round trip", () => {
  assert.equal(parseCatalogBrowseUrl(event, new URL("https://example.test/?view=browse&day=bad&area=north")).day, event.days[0].id);
  const stringEvent = { ...event, days: event.days.map((day) => ({ ...day, id: String(day.id) })) };
  assert.equal(parseCatalogBrowseUrl(stringEvent, new URL("https://example.test/?view=browse&day=2")).day, "2");
  assert.equal(switchReaderViewUrl(event, catalogBrowseUrl(event, all, "https://example.test")).searchParams.get("day"), String(event.days[0].id));
  assert.equal(readerView(new URL("https://example.test/?view=unknown")), "map");
});
test("history restores matching entries and rejects unrelated or malformed position data", () => {
  assert.deepEqual(readBrowseHistory({ catalogBrowse: { key: "a", shown: 48, textShown: 72, y: 700 } }, "a"), { key: "a", shown: 48, textShown: 72, y: 700 });
  assert.deepEqual(readBrowseHistory({ catalogBrowse: { key: "b", shown: 48, y: 700 } }, "a"), { key: "a", shown: 24, textShown: 24, y: 0 });
  assert.deepEqual(readBrowseHistory({ catalogBrowse: { key: "a", shown: Infinity, y: NaN } }, "a"), { key: "a", shown: 24, textShown: 24, y: 0 });
});
