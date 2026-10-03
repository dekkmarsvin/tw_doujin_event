import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const share = await environment.runner.import("/app/planning-share.ts");
const records = await environment.runner.import("/app/circle-records.ts");
const planning = await environment.runner.import("/app/planning-store.ts");
after(() => vite.close());

const timestamp = "2026-10-03T00:00:00.000Z";
const favorite = (eventId, circleId, overrides = {}) => ({ eventId, circleId, groupId: null, memo: "", createdAt: timestamp, updatedAt: timestamp, ...overrides });
const plan = (eventId, day, circleId, overrides = {}) => ({ eventId, day, circleId, status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: timestamp, ...overrides });
const document = (overrides = {}) => ({ ...planning.EMPTY_PLANNING_DOCUMENT, ...overrides });
const snapshot = (items = [{ circleId: "c-000001", day: 1 }]) => ({ version: 1, eventId: "sample", items });

test("projection sends only itinerary IDs/days, never private planning data or favorites", () => {
  const source = document({
    favoriteGroups: [{ id: "PRIVATE_GROUP_ID", name: "PRIVATE_GROUP_NAME", color: "coral", sortOrder: 0 }],
    favorites: [favorite("sample", "c-000001", { groupId: "PRIVATE_GROUP_ID", memo: "PRIVATE_MEMO" }), favorite("sample", "c-000002")],
    visitPlans: [plan("sample", 1, "c-000001", { status: "next", purchaseMemo: "PRIVATE_PURCHASE", budget: 987654321 })],
  });
  const projected = share.projectSharedItinerary(source, "sample", [
    { circleId: "c-000001", day: 1, memo: "SELECTION_MEMO" }, { circleId: "c-000002", day: 1 },
  ]);
  assert.deepEqual(projected, snapshot());
  const text = JSON.stringify(projected);
  for (const secret of ["PRIVATE_GROUP_ID", "PRIVATE_GROUP_NAME", "PRIVATE_MEMO", "PRIVATE_PURCHASE", "SELECTION_MEMO", "987654321", timestamp]) assert.equal(text.includes(secret), false);
  assert.doesNotMatch(text, /memo|budget|group|purchase|status|visited|next|updatedAt|createdAt|account|history/i);
});

test("projection keeps selection order, deduplicates and isolates event/day without reading private fields", () => {
  const privateField = { get() { throw new Error("Private field read"); } };
  const entry = plan("sample", 2, "c-000002");
  for (const field of ["purchaseMemo", "budget", "status", "routeOrder"]) Object.defineProperty(entry, field, privateField);
  const source = document({ visitPlans: [entry, plan("sample", 1, "c-000002"), plan("sample", "日期甲", "c-000004"), plan("other", 2, "c-000003")] });
  for (const field of ["favorites", "favoriteGroups"]) Object.defineProperty(source, field, privateField);
  const selected = [
    { circleId: "c-000004", day: "日期甲" }, { circleId: "c-000002", day: 2 },
    { circleId: "c-000002", day: "2" }, { circleId: "c-000002", day: 1 },
    { circleId: "c-000002", day: 2 }, { circleId: "c-000003", day: 2 },
    { circleId: "c-000004", day: 1 }, { circleId: "c-999999", day: 1 },
  ];
  assert.deepEqual(share.projectSharedItinerary(source, "sample", selected), snapshot([selected[0], selected[1], selected[3]]));
  assert.deepEqual(share.projectSharedItinerary(source, "sample", []), snapshot([]));
});

test("joining appends in snapshot order within each day, preserves private data and next/visited entries, and is idempotent", () => {
  const source = document({
    favoriteGroups: [{ id: "private", name: "Private group", color: "coral", sortOrder: 0 }],
    favorites: [favorite("sample", "c-3", { groupId: "private", memo: "Do not inherit" })],
    visitPlans: [
      plan("sample", 1, "c-1", { status: "next", routeOrder: 7, purchaseMemo: "Private next", budget: 100 }),
      plan("sample", 2, "c-2", { status: "visited", routeOrder: 3, purchaseMemo: "Private visited", budget: 200 }),
      plan("sample", 1, "c-3", { routeOrder: 2, purchaseMemo: "Other day's notes", budget: 300 }),
      plan("other", 1, "c-4", { routeOrder: 99 }),
    ],
  });
  const before = structuredClone(source);
  const items = [
    { circleId: "c-3", day: 2 }, { circleId: "c-4", day: 1 },
    { circleId: "c-1", day: 1 }, { circleId: "c-5", day: 2 },
    { circleId: "c-6", day: 1 }, { circleId: "c-4", day: 1 },
    { circleId: "c-2", day: "2" }, { circleId: "c-7", day: "日期甲" },
  ];
  const result = share.addSharedToPlan(source, "sample", items);
  assert.equal(result.added, 5);
  assert.deepEqual(result.document.visitPlans.slice(0, source.visitPlans.length), source.visitPlans);
  const added = result.document.visitPlans.slice(source.visitPlans.length);
  assert.deepEqual(added.map(({ circleId, day, routeOrder }) => [circleId, day, routeOrder]), [
    ["c-3", 2, 4], ["c-4", 1, 8], ["c-5", 2, 5], ["c-6", 1, 9], ["c-7", "日期甲", 0],
  ]);
  for (const entry of added) {
    assert.equal(entry.eventId, "sample");
    assert.equal(entry.status, "planned");
    assert.equal(entry.purchaseMemo, "");
    assert.equal(entry.budget, null);
    assert.ok(Number.isFinite(Date.parse(entry.updatedAt)));
  }
  assert.deepEqual(result.document.visitPlans.filter(item => item.status === "next"), [source.visitPlans[0]]);
  assert.deepEqual(result.document.favorites, source.favorites);
  assert.deepEqual(result.document.favoriteGroups, source.favoriteGroups);
  assert.deepEqual(source, before);
  const repeated = share.addSharedToPlan(result.document, "sample", items);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.document, result.document);
  assert.deepEqual(share.addSharedToPlan(source, "sample", []), { document: source, added: 0 });
});

test("joining an empty plan deduplicates each day and permits the same circle on different days", () => {
  const result = share.addSharedToPlan(document(), "sample", [
    { circleId: "c-1", day: 1 }, { circleId: "c-1", day: 2 },
    { circleId: "c-1", day: 1 }, { circleId: "c-2", day: 2 },
  ]);
  assert.equal(result.added, 3);
  assert.deepEqual(result.document.visitPlans.map(({ circleId, day, routeOrder, status }) => [circleId, day, routeOrder, status]), [
    ["c-1", 1, 0, "planned"], ["c-1", 2, 0, "planned"], ["c-2", 2, 1, "planned"],
  ]);
});

test("resolution uses canonical IDs and current placements for available/moved/withdrawn/unknown", () => {
  const placement = (circleId, day, code, status = "active") => ({ id: `${circleId}-${day}-${code}`, circleId, day, area: "S", boothCode: code, status, tone: "coral" });
  records.setCircleCatalog({
    schema: records.CIRCLE_CATALOG_SCHEMA, eventId: "sample", generatedAt: timestamp,
    circles: ["c-000001", "c-000002", "c-000003", "c-000004", "c-000005"].map(id => ({ id, name: "Same name" })),
    placements: [placement("c-000001", 1, "A01"), placement("c-000001", 1, "A02"), placement("c-000001", 2, "A03"), placement("c-000002", 1, "Old", "moved"), placement("c-000002", 2, "B01"), placement("c-000002", 3, "C01"), placement("c-000003", 1, "D01", "cancelled"), placement("c-000004", 1, "E01", "moved")],
  });
  const value = snapshot([
    { circleId: "c-000001", day: 1 }, { circleId: "c-000002", day: 1 },
    { circleId: "c-000003", day: 1 }, { circleId: "c-999999", day: 1 },
    { circleId: "c-000004", day: 1 }, { circleId: "c-000005", day: 1 },
  ]);
  const result = share.resolveSharedList(value);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.items.map(item => item.state), ["available", "moved", "withdrawn", "unknown", "moved", "moved"]);
  assert.deepEqual(result.items[0].records.map(record => record.code), ["A01", "A02"]);
  assert.deepEqual(result.items[0].days, [1, 2]);
  assert.deepEqual(result.items[1].days, [2, 3]);
  assert.deepEqual(result.items[1].records.map(record => [record.circle.name, record.code, record.day]), [["Same name", "B01", 2], ["Same name", "C01", 3]]);
  assert.equal(result.items[2].records[0].placement.status, "cancelled");
  assert.deepEqual(result.items[2].days, []);
  assert.equal(result.items[3].circle, null);
  assert.deepEqual(result.items[3].records, []);
  assert.equal(result.items[4].records[0].placement.status, "moved");
  assert.deepEqual(share.resolveSharedList({ ...value, eventId: "sample-two" }), { status: "loading", items: [] });
});

test("loading and failed catalogs never label shared items unknown", () => {
  records.resetCircleCatalog("sample");
  assert.deepEqual(share.resolveSharedList(snapshot()), { status: "loading", items: [] });
  records.failCircleCatalog("sample", "Cannot load");
  assert.deepEqual(share.resolveSharedList(snapshot()), { status: "error", items: [] });
});
