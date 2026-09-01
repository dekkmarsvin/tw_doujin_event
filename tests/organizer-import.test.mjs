import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const imports = await environment.runner.import("/app/organizer-import.ts");
after(() => vite.close());

test("CSV parsing preserves quoted newlines and source row numbers", () => {
  const matrix = imports.parseOrganizerCsv("\uFEFFDay,Booth,Circle\r\n1,A01,甲社\r\n2,A02,\"乙\n社\"\r\n");
  assert.deepEqual(matrix, [
    { sourceRow: 1, cells: ["Day", "Booth", "Circle"] },
    { sourceRow: 2, cells: ["1", "A01", "甲社"] },
    { sourceRow: 3, cells: ["2", "A02", "乙\n社"] },
  ]);
});

test("required mapping accepts columns or unambiguous fixed event values", () => {
  const result = imports.prepareOrganizerImport({
    rows: [
      { sourceRow: 1, cells: ["Day", "Booth", "Circle", "Stable"] },
      { sourceRow: 2, cells: ["第一日", "A01", "甲社", "circle-101"] },
      { sourceRow: 3, cells: ["第二日", "A02", "甲社", "circle-101"] },
      { sourceRow: 4, cells: ["第二日", "A03", "甲社", ""] },
    ],
    headerRow: 1,
    mapping: {
      day: { column: 0, values: { 第一日: "1", 第二日: "2" } },
      venueSpace: { fixed: "zhengyan" },
      area: { fixed: "ALL" },
      boothCode: { column: 1 },
      circleName: { column: 2 },
      stableKey: { column: 3 },
    },
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.map(({ dayId, venueSpaceId, boothCode }) => [dayId, venueSpaceId, boothCode]), [
    ["1", "zhengyan", "A01"], ["2", "zhengyan", "A02"], ["2", "zhengyan", "A03"],
  ]);
  assert.equal(result.rows[0].identityGroup, "stable:circle-101");
  assert.equal(result.rows[1].identityGroup, "stable:circle-101");
  assert.equal(result.rows[2].identityGroup, null, "a matching circle name is not identity evidence");
});

test("mapping reports missing values and duplicate booth placement without inventing identity", () => {
  const result = imports.prepareOrganizerImport({
    rows: [
      { sourceRow: 5, cells: ["Booth", "Circle"] },
      { sourceRow: 6, cells: ["A01", "同名社團"] },
      { sourceRow: 7, cells: ["a01", "同名社團"] },
      { sourceRow: 8, cells: ["", ""] },
    ],
    headerRow: 1,
    mapping: {
      day: { fixed: "1" }, venueSpace: { fixed: "hall-a" }, area: { fixed: "A" },
      boothCode: { column: 0 }, circleName: { column: 1 },
    },
  });
  assert.equal(result.rows.every((row) => row.identityGroup === null), true);
  assert.deepEqual(result.issues.map(({ row, code }) => [row, code]), [
    [7, "duplicate_booth"], [8, "missing_booth"], [8, "missing_circle"],
  ]);
});

test("a no-division space needs no area mapping and is canonicalized to ALL", () => {
  const result = imports.prepareOrganizerImport({
    rows: [
      { sourceRow: 1, cells: ["Booth", "Circle"] },
      { sourceRow: 2, cells: ["A01", "甲社"] },
    ],
    headerRow: 1,
    mapping: {
      day: { fixed: "1" }, venueSpace: { fixed: "whole-hall" },
      boothCode: { column: 0 }, circleName: { column: 1 },
    },
    areaModeByVenueSpace: { "whole-hall": "none" },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows[0].areaId, "ALL");
});

test("mixed imports require areas only for the rows whose event space is divided", () => {
  const result = imports.prepareOrganizerImport({
    rows: [
      { sourceRow: 1, cells: ["Space", "Area", "Booth", "Circle"] },
      { sourceRow: 2, cells: ["全館", "來源中的假分區", "A01", "甲社"] },
      { sourceRow: 3, cells: ["分館", "B", "B01", "乙社"] },
      { sourceRow: 4, cells: ["分館", "", "B02", "丙社"] },
    ],
    headerRow: 1,
    mapping: {
      day: { fixed: "1" },
      venueSpace: { column: 0, values: { 全館: "whole-hall", 分館: "divided-hall" } },
      area: { column: 1 }, boothCode: { column: 2 }, circleName: { column: 3 },
    },
    areaModeByVenueSpace: { "whole-hall": "none", "divided-hall": "imported" },
  });
  assert.deepEqual(result.rows.map(({ venueSpaceId, areaId }) => [venueSpaceId, areaId]), [
    ["whole-hall", "ALL"], ["divided-hall", "B"],
  ]);
  assert.deepEqual(result.issues.map(({ row, code }) => [row, code]), [[4, "missing_area"]]);
});

test("source metadata hashes bytes and never contains the raw workbook", async () => {
  const metadata = await imports.buildOrganizerImportMetadata({
    bytes: new TextEncoder().encode("private workbook bytes"),
    fileName: "official.xlsx",
    worksheet: "Day 1",
    sourceDescription: "主辦提供",
  });
  assert.match(metadata.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(metadata).sort(), ["fileName", "sha256", "sourceDescription", "worksheet"]);
  assert.doesNotMatch(JSON.stringify(metadata), /private workbook bytes/);
});
