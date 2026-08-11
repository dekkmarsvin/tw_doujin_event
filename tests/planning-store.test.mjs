import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const store = await environment.runner.import("/app/planning-store.ts");
after(() => vite.close());

const eventId = "ff47";
const empty = () => structuredClone(store.EMPTY_PLANNING_DOCUMENT);

test("keeps favorites, groups, and memos as independent planning data", () => {
  let document = store.toggleFavorite(empty(), eventId, "circle-a", "2026-08-06T00:00:00.000Z");
  document = store.createFavoriteGroup(document, "必逛");
  document = store.updateFavorite(document, eventId, "circle-a", document.favoriteGroups[0].id, "買新刊", "2026-08-06T00:01:00.000Z");
  assert.equal(document.favorites[0].memo, "買新刊");
  assert.equal(document.favorites[0].groupId, document.favoriteGroups[0].id);
  assert.equal(document.visitPlans.length, 0);
});

test("keeps adding to the itinerary separate from choosing the next stop", () => {
  let document = store.addToVisitPlan(empty(), eventId, 1, "circle-a", "2026-08-06T00:00:00.000Z");
  assert.deepEqual(document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["circle-a", "planned"]]);
  document = store.addToVisitPlan(document, eventId, 1, "circle-b", "2026-08-06T00:01:00.000Z");
  assert.deepEqual(document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["circle-a", "planned"], ["circle-b", "planned"]]);
  document = store.setNextStop(document, eventId, 1, "circle-b", "2026-08-06T00:02:00.000Z");
  assert.deepEqual(document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["circle-a", "planned"], ["circle-b", "next"]]);
  document = store.markVisited(document, eventId, 1, "circle-b", true, "2026-08-06T00:03:00.000Z");
  assert.deepEqual(document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["circle-a", "planned"], ["circle-b", "visited"]]);
  document = store.setNextStop(document, eventId, 1, "circle-a", "2026-08-06T00:04:00.000Z");
  document = store.removeFromVisitPlan(document, eventId, 1, "circle-a");
  assert.deepEqual(document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["circle-b", "visited"]]);
});

test("stores purchase notes and budgets with each itinerary entry", () => {
  let document = store.addToVisitPlan(empty(), eventId, 1, "circle-a", "2026-08-06T00:00:00.000Z");
  document = store.updateVisitPlanPurchase(document, eventId, 1, "circle-a", "新刊 1 本、壓克力立牌", 850.4, "2026-08-06T00:01:00.000Z");
  assert.equal(document.visitPlans[0].purchaseMemo, "新刊 1 本、壓克力立牌");
  assert.equal(document.visitPlans[0].budget, 850);
  assert.equal(document.visitPlans[0].updatedAt, "2026-08-06T00:01:00.000Z");
});

test("migrates favorites from the legacy storage key through the catalog ID map", () => {
  const storage = { getItem: (key) => key === "event-map-favorites" ? JSON.stringify(["1-a01"]) : null };
  assert.deepEqual(store.loadPlanningDocument(storage, eventId, (circleId) => [`${circleId}-canonical`]).favorites.map((favorite) => favorite.circleId), ["1-a01-canonical"]);
});

test("migrates schema-1 placement planning to canonical circle IDs without losing notes", () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    favoriteGroups: [{ id: "priority", name: "必逛", color: "coral", sortOrder: 0 }],
    favorites: [
      { eventId, circleId: "1-a01-0", groupId: "priority", memo: "買新刊", createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:01:00.000Z" },
      { eventId, circleId: "1-a02-1", groupId: null, memo: "拿無料", createdAt: "2026-08-06T00:00:30.000Z", updatedAt: "2026-08-06T00:02:00.000Z" },
    ],
    visitPlans: [
      { eventId, day: 1, circleId: "1-a01-0", status: "planned", routeOrder: 0, updatedAt: "2026-08-06T00:01:00.000Z" },
      { eventId, day: 1, circleId: "1-a02-1", status: "next", routeOrder: 1, updatedAt: "2026-08-06T00:02:00.000Z" },
    ],
  });
  const snapshot = store.inspectPlanningStorage(
    { getItem: (key) => key === store.PLANNING_STORAGE_KEY ? raw : null },
    eventId,
    (circleId) => [circleId === "1-a01-0" || circleId === "1-a02-1" ? "canonical-origin" : circleId],
  );
  assert.equal(snapshot.document.schemaVersion, store.PLANNING_SCHEMA_VERSION);
  assert.equal(snapshot.document.favorites.length, 1);
  assert.match(snapshot.document.favorites[0].memo, /買新刊/);
  assert.match(snapshot.document.favorites[0].memo, /拿無料/);
  assert.deepEqual(snapshot.document.visitPlans.map(({ circleId, status }) => [circleId, status]), [["canonical-origin", "next"]]);
});

test("moves visit plan entries and compacts route order", () => {
  let document = store.addToVisitPlan(empty(), eventId, 2, "a");
  document = store.addToVisitPlan(document, eventId, 2, "b");
  document = store.addToVisitPlan(document, eventId, 2, "c");
  document = store.moveVisitPlanEntry(document, eventId, 2, "c", -1);
  document = store.moveVisitPlanEntry(document, eventId, 2, "c", -1);
  assert.deepEqual(document.visitPlans.map(({ circleId, routeOrder }) => [circleId, routeOrder]), [["c", 0], ["a", 1], ["b", 2]]);
});

test("moves a visit plan entry directly to a drop index", () => {
  let document = store.addToVisitPlan(empty(), eventId, 2, "a");
  document = store.addToVisitPlan(document, eventId, 2, "b");
  document = store.addToVisitPlan(document, eventId, 2, "c");
  document = store.moveVisitPlanEntryToIndex(document, eventId, 2, "a", 2);
  assert.deepEqual(document.visitPlans.map(({ circleId, routeOrder }) => [circleId, routeOrder]), [["b", 0], ["c", 1], ["a", 2]]);
});

test("restores a removed favorite with its memo and group intact", () => {
  let document = store.createFavoriteGroup(empty(), "必逛");
  document = store.toggleFavorite(document, eventId, "circle-a", "2026-08-06T00:00:00.000Z");
  document = store.updateFavorite(document, eventId, "circle-a", document.favoriteGroups[0].id, "買新刊", "2026-08-06T00:01:00.000Z");
  const removed = structuredClone(document.favorites[0]);
  document = store.toggleFavorite(document, eventId, "circle-a");
  document = store.restoreFavorite(document, removed);
  assert.deepEqual(document.favorites[0], removed);
});

test("moves a batch of favorites between named groups without changing plans", () => {
  let document = store.createFavoriteGroup(empty(), "來源");
  document = store.createFavoriteGroup(document, "目標");
  document = store.toggleFavorite(document, eventId, "a");
  document = store.toggleFavorite(document, eventId, "b");
  document = store.updateFavorite(document, eventId, "a", document.favoriteGroups[0].id, "");
  document = store.updateFavorite(document, eventId, "b", document.favoriteGroups[0].id, "");
  document = store.addToVisitPlan(document, eventId, 1, "a");
  const beforePlans = structuredClone(document.visitPlans);
  document = store.moveFavoritesToGroup(document, eventId, document.favoriteGroups[0].id, document.favoriteGroups[1].id, "2026-08-06T00:02:00.000Z");
  assert.deepEqual(document.favorites.map((favorite) => favorite.groupId), [document.favoriteGroups[1].id, document.favoriteGroups[1].id]);
  assert.deepEqual(document.visitPlans, beforePlans);
});

test("supports non-FF47 event day keys without changing repository semantics", () => {
  let document = store.addToVisitPlan(empty(), "future-event", "sat-am", "circle-x");
  document = store.addToVisitPlan(document, "future-event", "sat-am", "circle-y");
  document = store.setNextStop(document, "future-event", "sat-am", "circle-y");
  assert.deepEqual(document.visitPlans.map(({ day, circleId, status }) => [day, circleId, status]), [["sat-am", "circle-x", "planned"], ["sat-am", "circle-y", "next"]]);
});

test("migrates legacy favorite ids without inventing itinerary entries", () => {
  const values = new Map([[store.LEGACY_FAVORITES_KEY, JSON.stringify(["circle-a", "circle-b"])]]);
  const document = store.loadPlanningDocument({ getItem: (key) => values.get(key) ?? null }, eventId);
  assert.deepEqual(document.favorites.map((item) => item.circleId), ["circle-a", "circle-b"]);
  assert.equal(document.visitPlans.length, 0);
});

test("preserves an unknown planning schema instead of treating it as writable empty data", () => {
  const raw = JSON.stringify({ schemaVersion: 99, futureData: ["keep-me"] });
  const snapshot = store.inspectPlanningStorage({ getItem: (key) => key === store.PLANNING_STORAGE_KEY ? raw : null }, eventId);
  assert.equal(snapshot.writable, false);
  assert.equal(snapshot.raw, raw);
  assert.match(snapshot.error, /已保留/);
});
