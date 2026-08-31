import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { CircleDetails, DayItinerary, SearchResults } = await environment.runner.import("/app/event-workspace-panels.tsx");
after(() => vite.close());

const source = {
  provider: "活動主辦單位", contentType: "official", label: "官方攤位清單",
  url: "https://event.example/booths", fetchedAt: "2026-08-14T00:00:00.000Z", status: "linked",
};
const circle = {
  id: "c-preview", name: "預覽社團", description: "", categories: [], circleCategory: "原創", pen: "作者",
  work: "長篇作品", creatorTypes: [], ageRatings: [], workTypes: [], referencedWorks: [], saleInfo: "完整販售資訊",
  specialTags: ["新刊"], media: [{ id: "media-1", url: "https://image.example/a.png", sourceUrl: "https://circle.example/source", provider: "社團本人", alt: "代表圖" }],
  externalLinks: [{ kind: "website", provider: "官方網站", url: "https://circle.example/" }],
  updatedAt: "2026-08-14T00:00:00.000Z", sources: [source],
};
const record = {
  id: "ff47-A01", recordId: "ff47-A01-0", code: "A01", name: circle.name, pen: circle.pen,
  genre: "原創", tags: ["新刊"], day: 1, hall: "A", x: 0, y: 0, tone: "coral", work: circle.work,
  note: "", sources: [source], circle,
  placement: { id: "ff47-A01-0", eventId: "ff47", circleId: circle.id, day: 1, area: "A", boothCode: "A01", status: "active", tone: "coral" },
};
const callbacks = {
  onClose() {}, onOpenFull() {}, onSelectShared() {}, onToggleFavorite() {}, onTogglePlan() {},
  onSetNext() {}, onUpdateFavorite() {}, onCreateGroup() {},
};

test("read-only publication preview keeps all content but removes keyboard activation", () => {
  const markup = renderToStaticMarkup(React.createElement(CircleDetails, {
    record, sharedRecords: [record], favorite: null, plan: null, groups: [], readOnly: true, ...callbacks,
  }));

  assert.match(markup, /完整販售資訊/);
  assert.match(markup, /https:\/\/circle\.example\//);
  assert.equal([...markup.matchAll(/<button\b/g)].length, [...markup.matchAll(/<button\b[^>]*\bdisabled=""/g)].length);
  assert.equal([...markup.matchAll(/<a\b/g)].length, [...markup.matchAll(/<a\b[^>]*aria-disabled="true"[^>]*tabindex="-1"/g)].length);
});

test("informative results identify circle-authored summaries without trust wording", () => {
  const circleSource = {
    provider: "由社團填寫", contentType: "circle", label: "", url: "",
    fetchedAt: "2026-08-27T00:00:00.000Z", status: "unverified",
  };
  const authoredRecord = {
    ...record,
    sources: [source, circleSource],
    circle: { ...circle, sources: [source, circleSource] },
  };
  const markup = renderToStaticMarkup(React.createElement(SearchResults, {
    records: [authoredRecord], catalogStatus: "ready", catalogError: "", selectedId: null,
    favoriteIds: new Set(), favoriteGroupLabels: new Map(), plans: new Map(),
    density: "informative", mediaCount: 1, query: "", activeFilters: [], matchReasons: new Map(), advancedSearchActive: false,
    onSelect() {}, onToggleFavorite() {}, onResetAdvancedSearch() {}, onClearFilters() {}, onClearQuery() {},
  }));

  assert.match(markup, /原創 · 長篇作品/);
  assert.match(markup, /由社團填寫/);
  assert.doesNotMatch(markup, /尚未驗證|社團自述/);
});

/**
 * #140. A cancelled or moved placement has to be readable as such wherever a
 * reader meets it, in words rather than in colour alone, and a move points at
 * the new booth only when the organizer's data actually carries one.
 */
const retired = (status, code, name) => ({
  ...record, id: `ff47-${code}`, recordId: `ff47-${code}-0`, code, name,
  circle: { ...circle, id: `c-${code}`, name },
  placement: { ...record.placement, id: `ff47-${code}-0`, circleId: `c-${code}`, boothCode: code, status },
});
const cancelledRecord = retired("cancelled", "B02", "退出社團");
const movedRecord = retired("moved", "B03", "移動社團");
const destinationRecord = { ...retired("active", "C09", "移動社團"), circle: movedRecord.circle };

test("a retired placement is named in the result list, not only shaded", () => {
  const markup = renderToStaticMarkup(React.createElement(SearchResults, {
    records: [cancelledRecord, movedRecord], catalogStatus: "ready", catalogError: "", selectedId: null,
    favoriteIds: new Set(), favoriteGroupLabels: new Map(), plans: new Map(),
    density: "informative", mediaCount: 0, query: "", activeFilters: [], matchReasons: new Map(), advancedSearchActive: false,
    onSelect() {}, onToggleFavorite() {}, onResetAdvancedSearch() {}, onClearFilters() {}, onClearQuery() {},
  }));

  assert.match(markup, /已取消參展/);
  assert.match(markup, /已移動攤位/);
});

test("circle details say a booth is no longer a destination and offer the new one", () => {
  const cancelled = renderToStaticMarkup(React.createElement(CircleDetails, {
    record: cancelledRecord, sharedRecords: [cancelledRecord], favorite: null, plan: null, groups: [], ...callbacks,
  }));
  assert.match(cancelled, /已取消參展/);
  assert.doesNotMatch(cancelled, /看新攤位/);

  const moved = renderToStaticMarkup(React.createElement(CircleDetails, {
    record: movedRecord, sharedRecords: [movedRecord], movedDestination: destinationRecord, favorite: null, plan: null, groups: [], ...callbacks,
  }));
  assert.match(moved, /已移動攤位/);
  assert.match(moved, /看新攤位 C09/);

  const strandedMarkup = renderToStaticMarkup(React.createElement(CircleDetails, {
    record: movedRecord, sharedRecords: [movedRecord], favorite: null, plan: null, groups: [], ...callbacks,
  }));
  assert.match(strandedMarkup, /沒有公布新位置/, "an unknown destination is stated, never guessed");
  assert.doesNotMatch(strandedMarkup, /看新攤位/);
});

test("an itinerary entry keeps its plan state and still reads as retired", () => {
  const markup = renderToStaticMarkup(React.createElement(DayItinerary, {
    day: 1,
    entries: [{ eventId: "ff47", day: 1, circleId: cancelledRecord.circle.id, status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-08-30" }],
    recordsById: new Map([[cancelledRecord.circle.id, cancelledRecord]]),
    onSelect() {}, onMove() {}, onMoveTo() {}, onVisit() {}, onRemove() {}, onUpdatePurchase() {},
  }));

  assert.match(markup, /待前往 · 已取消參展/);
});
