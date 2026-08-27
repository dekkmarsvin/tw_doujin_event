import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { CircleDetails, SearchResults } = await environment.runner.import("/app/event-workspace-panels.tsx");
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
    density: "informative", mediaCount: 1, query: "", activeFilters: [], advancedSearchActive: false,
    onSelect() {}, onToggleFavorite() {}, onResetAdvancedSearch() {}, onClearFilters() {}, onClearQuery() {},
  }));

  assert.match(markup, /原創 · 長篇作品/);
  assert.match(markup, /由社團填寫/);
  assert.doesNotMatch(markup, /尚未驗證|社團自述/);
});
