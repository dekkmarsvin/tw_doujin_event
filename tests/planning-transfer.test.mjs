import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const catalog = await environment.runner.import("/app/circle-records.ts");
const transfer = await environment.runner.import("/app/planning-transfer.ts");
const planning = await environment.runner.import("/app/planning-store.ts");
after(() => vite.close());

function sample() {
  return planning.parsePlanningDocument({
    schemaVersion: planning.PLANNING_SCHEMA_VERSION,
    favoriteGroups: [{ id: "priority", name: "必逛", color: "coral", sortOrder: 0 }],
    favorites: [{ eventId: "ff47", circleId: "1-e19-0", groupId: "priority", memo: "=危險公式", updatedAt: "2026-08-06T00:00:00.000Z" }],
    visitPlans: [{ eventId: "ff47", day: 1, circleId: "1-e19-0", status: "next", routeOrder: 0, purchaseMemo: "新刊 1 本", budget: 500, updatedAt: "2026-08-06T00:00:00.000Z" }],
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
    '"circle-plan-csv/1","ff47","1-e19-0","","","planned","1","",""',
  ].join("\n");
  const preview = transfer.parsePlanningCsv(csv);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.document.visitPlans[0].purchaseMemo, "");
  assert.equal(preview.document.visitPlans[0].budget, null);
});

test("CSV rejects unknown versions, formula injection, and invalid URLs with row numbers", () => {
  const header = '"schema_version","event_id","circle_id","group_label","memo","visit_status","route_order","source_provider","source_url"';
  const bad = [header, '"other/9","ff47","1-e19-0","","","planned","1","",""', '"circle-plan-csv/1","ff47","1-e19-0","","=unsafe","","","",""', '"circle-plan-csv/1","ff47","1-e19-0","","","planned","1","","http://unsafe.example"'].join("\n");
  const preview = transfer.parsePlanningCsv(bad);
  assert.deepEqual(preview.errors, ["第 2 列：未知 schema version。", "第 3 列：包含可能的公式注入內容。", "第 4 列：source_url 必須是有效 HTTPS URL。"]);
});

test("merge reports and excludes unmatched circles", () => {
  const incoming = planning.parsePlanningDocument({ ...sample(), favorites: [...sample().favorites, { eventId: "ff47", circleId: "missing", groupId: null, memo: "", updatedAt: "" }] });
  const preview = transfer.parsePlanningJson(transfer.exportPlanningJson(incoming), sample());
  assert.deepEqual(preview.unmatchedCircleIds, ["missing"]);
  const merged = transfer.mergePlanningImport(sample(), preview.document, "incoming");
  assert.equal(merged.favorites.some((item) => item.circleId === "missing"), false);
});

test("real canonical circle IDs survive planning backup preview and merge", () => {
  const record = catalog.CIRCLE_RECORDS.find((item) => item.name === "蒼銀之星" && item.day === 1);
  assert.ok(record);
  const canonical = planning.parsePlanningDocument({
    schemaVersion: planning.PLANNING_SCHEMA_VERSION,
    favoriteGroups: [],
    favorites: [{ eventId: "ff47", circleId: record.circle.id, groupId: null, memo: "買新刊", updatedAt: "2026-08-11T00:00:00.000Z" }],
    visitPlans: [{ eventId: "ff47", day: record.day, circleId: record.circle.id, status: "next", routeOrder: 0, purchaseMemo: "新刊 1 本", budget: 500, updatedAt: "2026-08-11T00:00:00.000Z" }],
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
