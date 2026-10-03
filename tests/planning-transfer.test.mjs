import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const records = await environment.runner.import("/app/circle-records.ts");
const transfer = await environment.runner.import("/app/planning-transfer.ts");
const planning = await environment.runner.import("/app/planning-store.ts");
after(() => vite.close());

// Transfer resolves circles through the loaded snapshot, so publish it first.
records.setCircleCatalog(JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8")));
const catalog = records.getCircleCatalog();

function sample() {
  return planning.parsePlanningDocument({
    schemaVersion: planning.PLANNING_SCHEMA_VERSION,
    favoriteGroups: [{ id: "priority", name: "必逛", color: "coral", sortOrder: 0 }],
    favorites: [{ eventId: "sample", circleId: "1-s01", groupId: "priority", memo: "=危險公式", updatedAt: "2026-08-06T00:00:00.000Z" }],
    visitPlans: [{ eventId: "sample", day: 1, circleId: "1-s01", status: "next", routeOrder: 0, purchaseMemo: "新刊 1 本", budget: 500, updatedAt: "2026-08-06T00:00:00.000Z" }],
  });
}

test("JSON export and import preserve planning data", () => {
  const preview = transfer.parsePlanningJson(transfer.exportPlanningJson(sample()));
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.document.favoriteGroups[0].name, "必逛");
  assert.equal(preview.document.favorites[0].memo, "=危險公式");
  assert.equal(preview.document.visitPlans[0].status, "next");
  assert.equal(preview.document.visitPlans[0].purchaseMemo, "新刊 1 本");
  assert.equal(preview.document.visitPlans[0].budget, 500);
});

test("JSON import rejects an unknown inner planning schema without producing writable data", () => {
  const result = transfer.parsePlanningJson(JSON.stringify({ kind: "circle-plan-json/1", planning: { schemaVersion: 99, favorites: [{ circleId: "future" }] } }));
  assert.equal(result.document.favorites.length, 0);
  assert.match(result.errors.join(" "), /內層規劃資料版本/);
});

test("CSV v1 round trip protects formula-like text and keeps favorite independent from plan", () => {
  const csv = transfer.exportPlanningCsv(sample());
  assert.match(csv, /'=危險公式/);
  const preview = transfer.parsePlanningCsv(csv);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.document.favorites[0].memo, "=危險公式");
  assert.equal(preview.document.visitPlans[0].routeOrder, 0);
  assert.equal(preview.document.visitPlans[0].purchaseMemo, "新刊 1 本");
  assert.equal(preview.document.visitPlans[0].budget, 500);
});

test("CSV v1 still accepts legacy rows without shopping fields", () => {
  const csv = [
    '"schema_version","event_id","circle_id","group_label","memo","visit_status","route_order","source_provider","source_url"',
    '"circle-plan-csv/1","sample","1-s01","","","planned","1","",""',
  ].join("\n");
  const preview = transfer.parsePlanningCsv(csv);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.document.visitPlans[0].purchaseMemo, "");
  assert.equal(preview.document.visitPlans[0].budget, null);
});

test("CSV rejects unknown versions, formula injection, and invalid URLs with row numbers", () => {
  const header = '"schema_version","event_id","circle_id","group_label","memo","visit_status","route_order","source_provider","source_url"';
  const bad = [header, '"other/9","sample","1-s01","","","planned","1","",""', '"circle-plan-csv/1","sample","1-s01","","=unsafe","","","",""', '"circle-plan-csv/1","sample","1-s01","","","planned","1","","http://unsafe.example"'].join("\n");
  const preview = transfer.parsePlanningCsv(bad);
  assert.deepEqual(preview.errors, ["第 2 列：未知 schema version。", "第 3 列：包含可能的公式注入內容。", "第 4 列：source_url 必須是有效 HTTPS URL。"]);
});

test("legacy JSON API reports unmatched circles and merge preserves them", () => {
  const incoming = planning.parsePlanningDocument({ ...sample(), favorites: [...sample().favorites, { eventId: "sample", circleId: "missing", groupId: null, memo: "", updatedAt: "" }] });
  const preview = transfer.parsePlanningJson(transfer.exportPlanningJson(incoming), sample());
  assert.deepEqual(preview.unmatchedCircleIds, ["missing"]);
  const merged = transfer.mergePlanningImport(sample(), preview.document, "incoming");
  assert.equal(merged.favorites.some((item) => item.circleId === "missing"), true);
  assert.deepEqual(transfer.mergePlanningImport(sample(), preview.document, "replace"), incoming);
});

const timestamp = "2026-10-03T00:00:00.000Z";
const favorite = (eventId, circleId, overrides = {}) => ({ eventId, circleId, groupId: null, memo: "", createdAt: timestamp, updatedAt: timestamp, ...overrides });
const plan = (eventId, day, circleId, overrides = {}) => ({ eventId, day, circleId, status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: timestamp, ...overrides });
const group = (id, overrides = {}) => ({ id, name: "優先", color: "coral", sortOrder: 0, ...overrides });
const document = (overrides = {}) => planning.parsePlanningDocument({ ...planning.EMPTY_PLANNING_DOCUMENT, ...overrides });
const backupText = (value) => JSON.stringify({ kind: "circle-plan-json/1", planning: value });
const previewBackup = (value, current = document(), status = () => "loading") => transfer.previewPlanningBackup(backupText(value), current, status);

function multiEvent() {
  return document({
    favoriteGroups: [group("priority"), group("later", { name: "有空再逛", color: "blue", sortOrder: 1 })],
    favorites: [favorite("sample", "1-s01", { groupId: "priority", memo: "私人備註\n買新刊" }), favorite("other", "other-circle", { groupId: "later", memo: "跨活動備註" })],
    visitPlans: [
      plan("sample", 1, "1-s01", { status: "next", purchaseMemo: "新刊", budget: 500 }),
      plan("sample", 1, "orphan", { status: "visited", routeOrder: 1, budget: 0 }),
      plan("sample", 2, "1-s01", { status: "visited", purchaseMemo: "第二天再買", budget: 300 }),
      plan("other", "2026-10-04", "other-circle", { status: "next", purchaseMemo: "另一場新刊", budget: 1000 }),
      plan("other", "2026-10-04", "other-orphan", { routeOrder: 1 }),
    ],
  });
}

test("full JSON round trip preserves multiple events, days, groups, private values and route order", () => {
  const original = multiEvent();
  const result = transfer.previewPlanningBackup(transfer.exportPlanningJson(original), document(), () => "loading");
  assert.equal(result.ok, true);
  assert.deepEqual(result.document, original);
  assert.deepEqual(transfer.mergePlanningBackup(document(), result.document, "keep"), original);
  assert.deepEqual(transfer.mergePlanningBackup(document(), result.document, "incoming"), original);
  assert.deepEqual(result.events.map((event) => [event.eventId, event.visitPlans.perDay]), [["sample", { 1: 2, 2: 1 }], ["other", { "2026-10-04": 2 }]]);
  assert.deepEqual(result.groups.new, original.favoriteGroups);
  assert.deepEqual(transfer.parsePlanningJson(transfer.exportPlanningJson(original)).document, original);
});

test("preview separates new, identical and conflicting values without counting timestamps as conflicts", () => {
  const current = document({ favorites: [favorite("sample", "same"), favorite("sample", "changed")], visitPlans: [plan("sample", 2, "same"), plan("sample", 2, "changed", { routeOrder: 1 })] });
  const incoming = document({ favorites: [favorite("sample", "same", { updatedAt: "later" }), favorite("sample", "changed", { memo: "incoming" }), favorite("sample", "new")], visitPlans: [plan("sample", 2, "same", { updatedAt: "later", routeOrder: 1 }), plan("sample", 2, "changed", { status: "visited" }), plan("sample", 2, "new", { routeOrder: 2 })] });
  const result = previewBackup(incoming, current);
  assert.equal(result.ok, true);
  assert.deepEqual(result.events[0].favorites, { total: 3, new: 1, identical: 1, conflicting: 1 });
  assert.deepEqual(result.events[0].visitPlans, { total: 3, new: 1, identical: 1, conflicting: 1, perDay: { 2: 3 } });
  assert.deepEqual(result.document, incoming);
  assert.equal(result.baseFingerprint, transfer.planningFingerprint(current));
});

test("unmatched, unloaded and failed catalog records are preserved and classified separately", () => {
  const incoming = document({
    favorites: [favorite("sample", "1-s01"), favorite("sample", "orphan"), favorite("unloaded", "unknown"), favorite("failed", "unknown")],
    visitPlans: [plan("sample", "day-X", "orphan"), plan("unloaded", 3, "unknown"), plan("failed", 5, "unknown")],
  });
  const result = previewBackup(incoming, document(), (eventId) => eventId === "sample" ? "ready" : eventId === "failed" ? "error" : "loading");
  assert.equal(result.ok, true);
  const [ready, unloaded, failed] = result.events;
  assert.equal(ready.unresolved.unmatched.total, 2);
  assert.deepEqual(ready.unresolved.unmatched.favorites.map((item) => item.circleId), ["orphan"]);
  assert.equal(ready.unresolved.unmatched.visitPlans[0].day, "day-X");
  assert.equal(ready.unresolved.notLoaded.total, 0);
  assert.equal(unloaded.unresolved.notLoaded.total, 2);
  assert.equal(unloaded.unresolved.unmatched.total, 0);
  assert.equal(failed.unresolved.failed.total, 2);
  assert.equal(failed.unresolved.unmatched.total, 0);
  assert.deepEqual(result.document, incoming);
  for (const mode of ["keep", "incoming"]) assert.deepEqual(transfer.mergePlanningBackup(document(), result.document, mode), incoming);
});

test("keep retains local values; incoming overwrites private values but new plans append after local order", () => {
  const current = document({ favoriteGroups: [group("local")], favorites: [favorite("e", "shared", { groupId: "local", memo: "local" }), favorite("local-only", "x")], visitPlans: [plan("e", 2, "first", { status: "next", budget: 200 }), plan("e", 2, "shared", { routeOrder: 1, purchaseMemo: "local", budget: 400 })] });
  const incoming = document({ favoriteGroups: [group("source")], favorites: [favorite("e", "shared", { groupId: "source", memo: "incoming" }), favorite("e", "new")], visitPlans: [plan("e", 2, "shared", { status: "visited", purchaseMemo: "incoming", budget: 100 }), plan("e", 2, "new-a", { status: "next", routeOrder: 1 }), plan("e", 2, "new-b", { routeOrder: 2 }), plan("e", 3, "third-day", { status: "next" })] });
  for (const mode of ["keep", "incoming"]) {
    const merged = transfer.mergePlanningBackup(current, incoming, mode);
    assert.deepEqual(merged.visitPlans.filter((item) => item.day === 2).map((item) => [item.circleId, item.routeOrder]), [["first", 0], ["shared", 1], ["new-a", 2], ["new-b", 3]]);
    assert.equal(merged.visitPlans.filter((item) => item.day === 2 && item.status === "next").length, 1);
    assert.equal(merged.visitPlans.find((item) => item.circleId === "new-a").status, "planned");
    assert.equal(merged.visitPlans.find((item) => item.day === 3).status, "next");
    const sharedFavorite = merged.favorites.find((item) => item.circleId === "shared");
    const sharedPlan = merged.visitPlans.find((item) => item.circleId === "shared");
    assert.equal(sharedFavorite.memo, mode === "keep" ? "local" : "incoming");
    assert.equal(sharedFavorite.groupId, mode === "keep" ? "local" : "source");
    assert.equal(sharedPlan.purchaseMemo, mode === "keep" ? "local" : "incoming");
    assert.equal(sharedPlan.budget, mode === "keep" ? 400 : 100);
    assert.equal(sharedPlan.status, mode === "keep" ? "planned" : "visited");
    assert.ok(merged.favorites.some((item) => item.eventId === "local-only"));
    assert.deepEqual(transfer.mergePlanningBackup(merged, incoming, mode), merged);
  }
});

test("group ID clashes get deterministic IDs and rewritten references, with repeated imports remaining identical", () => {
  const current = document({ favoriteGroups: [group("same"), group("clash", { name: "local", sortOrder: 1 }), group("lookalike", { name: "imported", color: "blue", sortOrder: 2 })], favorites: [favorite("e", "local", { groupId: "clash" })] });
  const incoming = document({ favoriteGroups: [group("same"), group("clash", { name: "imported", color: "blue", sortOrder: 1 }), group("new-id", { name: "imported", color: "blue", sortOrder: 2 })], favorites: [favorite("e", "new", { groupId: "clash" }), favorite("other", "new", { groupId: "new-id" })] });
  const result = previewBackup(incoming, current);
  assert.equal(result.ok, true);
  assert.equal(result.groups.new.length, 1);
  assert.equal(result.groups.identical.length, 1);
  assert.equal(result.groups.clashes.length, 1);
  const mappedId = result.groups.clashes[0].mappedId;
  assert.notEqual(mappedId, "clash");
  assert.notEqual(mappedId, "lookalike");
  assert.equal(result.groups.idMap.clash, mappedId);
  assert.equal(previewBackup(incoming, current).groups.idMap.clash, mappedId);
  for (const mode of ["keep", "incoming"]) {
    const merged = transfer.mergePlanningBackup(current, incoming, mode);
    assert.equal(merged.favoriteGroups.length, 5);
    assert.equal(merged.favorites.find((item) => item.eventId === "e" && item.circleId === "new").groupId, mappedId);
    assert.equal(merged.favorites.find((item) => item.circleId === "local").groupId, "clash");
    assert.equal(merged.favorites.find((item) => item.eventId === "other").groupId, "new-id");
    assert.equal(previewBackup(incoming, merged).groups.idMap.clash, mappedId);
    assert.deepEqual(transfer.mergePlanningBackup(merged, incoming, mode), merged);
  }
});

test("generated group IDs avoid occupied IDs and incoming original IDs", () => {
  const incoming = document({ favoriteGroups: [group("clash", { name: "imported" })], favorites: [favorite("e", "x", { groupId: "clash" })] });
  const original = document({ favoriteGroups: [group("clash", { name: "local" })] });
  const baseId = previewBackup(incoming, original).groups.idMap.clash;
  for (const sameName of [false, true]) {
    const current = document({ favoriteGroups: [...original.favoriteGroups, group(baseId, { name: sameName ? "imported" : "occupied", sortOrder: 1 })] });
    const source = document({ ...incoming, favoriteGroups: [...incoming.favoriteGroups, group(baseId, { name: sameName ? "imported" : "occupied", sortOrder: 1 })], favorites: [...incoming.favorites, favorite("e", "y", { groupId: baseId })] });
    const result = previewBackup(source, current);
    assert.notEqual(result.groups.idMap.clash, baseId);
    const merged = transfer.mergePlanningBackup(current, source, "incoming");
    assert.notEqual(merged.favorites[0].groupId, merged.favorites[1].groupId);
    assert.deepEqual(transfer.mergePlanningBackup(merged, source, "incoming"), merged);
  }
});

test("changing only a group colour is an ID clash; same content under a new ID stays a separate group", () => {
  const current = document({ favoriteGroups: [group("g")] });
  const incoming = document({ favoriteGroups: [group("g", { color: "blue" }), group("another", { sortOrder: 1 })], favorites: [favorite("e", "x", { groupId: "g" })] });
  const result = previewBackup(incoming, current);
  assert.equal(result.ok, true);
  assert.equal(result.groups.clashes.length, 1);
  assert.equal(result.groups.new.length, 1);
  assert.equal(result.groups.identical.length, 0);
  const merged = transfer.mergePlanningBackup(current, incoming, "incoming");
  assert.equal(merged.favoriteGroups.length, 3);
  assert.equal(merged.favorites[0].groupId, result.groups.idMap.g);
  assert.deepEqual(transfer.mergePlanningBackup(merged, incoming, "incoming"), merged);
});

test("original string day keys remain usable and do not fall back to the current event or day one", () => {
  const incoming = document({ visitPlans: [plan("not-current", "__proto__", "a"), plan("not-current", "__proto__", "b", { routeOrder: 1 })] });
  const result = previewBackup(incoming, document({ visitPlans: [plan("sample", 1, "local")] }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.entries(result.events[0].visitPlans.perDay), [["__proto__", 2]]);
  assert.equal(Object.getPrototypeOf(result.events[0].visitPlans.perDay), Object.prototype);
  const merged = transfer.mergePlanningBackup(document(), result.document, "keep");
  assert.deepEqual(merged.visitPlans.map((item) => [item.eventId, item.day, item.routeOrder]), [["not-current", "__proto__", 0], ["not-current", "__proto__", 1]]);
});

test("repeated JSON imports into an empty browser are idempotent", () => {
  for (const mode of ["keep", "incoming"]) {
    const incoming = multiEvent();
    const once = transfer.mergePlanningBackup(document(), incoming, mode);
    const reparsed = previewBackup(incoming, once);
    assert.deepEqual(transfer.mergePlanningBackup(once, reparsed.document, mode), once);
    assert.ok(reparsed.events.every((event) => event.favorites.new === 0 && event.visitPlans.new === 0));
  }
});

function assertRejected(result) {
  assert.equal(result.ok, false);
  assert.equal(result.document, null);
  assert.ok(result.errors.length > 0 && result.errors.length <= 5);
}

test("UTF-8 size is checked before JSON.parse and before catalog work", () => {
  const oversized = "界".repeat(Math.floor(10 * 1024 * 1024 / 3) + 1);
  assert.ok(oversized.length < 10 * 1024 * 1024);
  const originalParse = JSON.parse;
  let parsed = false;
  let result;
  try {
    JSON.parse = () => { parsed = true; throw new Error("must not parse"); };
    result = transfer.previewPlanningBackup(oversized, document(), () => { throw new Error("must not classify"); });
  } finally { JSON.parse = originalParse; }
  assertRejected(result);
  assert.equal(parsed, false);
  const text = backupText(document());
  const atLimit = text.padEnd(10 * 1024 * 1024, " ");
  assert.equal(transfer.previewPlanningBackup(atLimit, document(), () => "loading").ok, true);
});

test("combined groups + favorites + plans item limit rejects the whole file", () => {
  const incoming = { ...planning.EMPTY_PLANNING_DOCUMENT, favoriteGroups: [group("g")], favorites: Array.from({ length: 19_999 }, (_, index) => favorite("e", String(index))), visitPlans: [plan("e", 1, "x")] };
  assertRejected(previewBackup(incoming));
  incoming.visitPlans = [];
  const accepted = previewBackup(incoming);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.document.favorites.length, 19_999);
});

test("unknown kind, inner version, malformed JSON and broken structure reject with nothing to write", () => {
  const current = sample();
  const before = structuredClone(current);
  const texts = ["{", "null", "[]", JSON.stringify({ kind: "other", planning: document() }), backupText({ ...document(), schemaVersion: 99 }), backupText(null), backupText({ ...document(), favorites: {} }), backupText({ schemaVersion: planning.PLANNING_SCHEMA_VERSION })];
  for (const text of texts) {
    assertRejected(transfer.previewPlanningBackup(text, current, () => { throw new Error("must not classify"); }));
    const legacy = transfer.parsePlanningJson(text, current);
    assert.ok(legacy.errors.length);
    assert.deepEqual(legacy.document, document());
  }
  assert.deepEqual(current, before);
});

test("any invalid item rejects the complete backup rather than silently normalizing or dropping it", () => {
  const base = sample();
  const invalid = [
    ["favorites", { circleId: "" }], ["favorites", { eventId: null }], ["favorites", { memo: 12 }],
    ["favorites", { groupId: "absent" }], ["favorites", { createdAt: false }], ["favorites", { updatedAt: "" }],
    ["visitPlans", { day: null }], ["visitPlans", { day: " " }], ["visitPlans", { status: "unknown" }],
    ["visitPlans", { budget: -1 }], ["visitPlans", { budget: 1.5 }], ["visitPlans", { budget: "100" }],
    ["visitPlans", { routeOrder: -1 }], ["visitPlans", { purchaseMemo: [] }], ["visitPlans", { updatedAt: 3 }],
    ["favoriteGroups", { id: "" }], ["favoriteGroups", { name: " " }], ["favoriteGroups", { color: 3 }], ["favoriteGroups", { sortOrder: 0.5 }],
  ];
  for (const [collection, change] of invalid) {
    const incoming = structuredClone(base);
    incoming[collection][0] = { ...incoming[collection][0], ...change };
    assertRejected(previewBackup(incoming));
    assert.deepEqual(transfer.parsePlanningJson(backupText(incoming)).document, document());
  }
  for (const collection of ["favorites", "visitPlans", "favoriteGroups"]) {
    for (const invalidItem of [null, {}, 5]) {
      const incoming = structuredClone(base);
      incoming[collection].push(invalidItem);
      assertRejected(previewBackup(incoming));
    }
    const duplicate = structuredClone(base);
    duplicate[collection].push({ ...duplicate[collection][0] });
    assertRejected(previewBackup(duplicate));
  }
});

test("invalid-item reasons identify the collection and one-based item index, capped at five", () => {
  const incoming = { ...sample(), favorites: [favorite("sample", "valid"), ...Array.from({ length: 10 }, () => null)] };
  const result = previewBackup(incoming);
  assertRejected(result);
  assert.equal(result.errors.length, 5);
  assert.match(result.errors[0], /收藏.*2/);
  assert.match(result.errors[4], /收藏.*6/);
});

test("replace summary spans all local events and counts shared/unused global groups correctly", () => {
  const current = document({ favoriteGroups: [group("shared"), group("removed", { sortOrder: 1 }), group("unused", { sortOrder: 2 })], favorites: [favorite("a", "kept", { groupId: "shared" }), favorite("a", "removed", { groupId: "removed" }), favorite("b", "removed", { groupId: "shared" })], visitPlans: [plan("a", 1, "kept"), plan("a", 2, "removed"), plan("b", "original-day", "removed")] });
  const incoming = document({ favoriteGroups: [group("shared")], favorites: [favorite("a", "kept", { groupId: "shared" }), favorite("new-event", "new")], visitPlans: [plan("a", 1, "kept")] });
  const result = transfer.planningReplaceSummary(current, incoming);
  assert.deepEqual(result.totals, { favorites: { total: 3, removed: 2, replaced: 1 }, visitPlans: { total: 3, removed: 2, replaced: 1 }, groups: { total: 3, removed: 2, replaced: 1 } });
  assert.deepEqual(result.events, [
    { eventId: "a", favorites: { total: 2, removed: 1, replaced: 1 }, visitPlans: { total: 2, removed: 1, replaced: 1 }, groups: { total: 2, removed: 1, replaced: 1 } },
    { eventId: "b", favorites: { total: 1, removed: 1, replaced: 0 }, visitPlans: { total: 1, removed: 1, replaced: 0 }, groups: { total: 1, removed: 0, replaced: 1 } },
  ]);
  assert.deepEqual(transfer.planningReplaceSummary(document(), incoming).totals.groups, { total: 0, removed: 0, replaced: 0 });
});

test("fingerprint is stable across object property order and changes with every stored field", () => {
  const current = multiEvent();
  const fingerprint = transfer.planningFingerprint(current);
  assert.equal(transfer.planningFingerprint(structuredClone(current)), fingerprint);
  const reordered = { visitPlans: current.visitPlans.map((item) => Object.fromEntries(Object.entries(item).reverse())), favorites: current.favorites, favoriteGroups: current.favoriteGroups, schemaVersion: current.schemaVersion };
  assert.equal(transfer.planningFingerprint(reordered), fingerprint);
  for (const collection of ["favoriteGroups", "favorites", "visitPlans"]) {
    for (const field of Object.keys(current[collection][0])) {
      const changed = structuredClone(current);
      changed[collection][0][field] = `${changed[collection][0][field]}-changed`;
      assert.notEqual(transfer.planningFingerprint(changed), fingerprint, `${collection}.${field}`);
    }
  }
  const changedOrder = structuredClone(current);
  changedOrder.visitPlans.reverse();
  assert.notEqual(transfer.planningFingerprint(changedOrder), fingerprint);
  const changed = planning.updateFavorite(current, "sample", "1-s01", "priority", "edited locally");
  assert.notEqual(transfer.planningFingerprint(changed), previewBackup(current, current).baseFingerprint);
});

test("canonical circle IDs survive planning backup preview and merge", () => {
  const record = catalog.records.find((item) => item.name === "北風畫室" && item.day === 1);
  assert.ok(record);
  const canonical = planning.parsePlanningDocument({
    schemaVersion: planning.PLANNING_SCHEMA_VERSION,
    favoriteGroups: [],
    favorites: [{ eventId: "sample", circleId: record.circle.id, groupId: null, memo: "買新刊", updatedAt: "2026-08-11T00:00:00.000Z" }],
    visitPlans: [{ eventId: "sample", day: record.day, circleId: record.circle.id, status: "next", routeOrder: 0, purchaseMemo: "新刊 1 本", budget: 500, updatedAt: "2026-08-11T00:00:00.000Z" }],
  });

  const jsonPreview = transfer.parsePlanningJson(transfer.exportPlanningJson(canonical));
  assert.deepEqual(jsonPreview.unmatchedCircleIds, []);
  const merged = transfer.mergePlanningImport(planning.EMPTY_PLANNING_DOCUMENT, jsonPreview.document, "incoming");
  assert.equal(merged.favorites[0].circleId, record.circle.id);
  assert.equal(merged.visitPlans[0].circleId, record.circle.id);

  const csvPreview = transfer.parsePlanningCsv(transfer.exportPlanningCsv(canonical));
  assert.deepEqual(csvPreview.unmatchedCircleIds, []);
  assert.equal(csvPreview.document.visitPlans[0].day, record.day);
});
