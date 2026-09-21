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
  assert.deepEqual(result.rows.map(({ dayId, venueSpaceId, codes }) => [dayId, venueSpaceId, codes[0]]), [
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

const DUPLICATE_ROWS = [
  { sourceRow: 5, cells: ["Booth", "Circle"] },
  { sourceRow: 6, cells: ["A01", "同名社團"] },
  { sourceRow: 7, cells: ["a01", "同名社團"] },
  { sourceRow: 8, cells: ["", ""] },
];
const DUPLICATE_MAPPING = {
  day: { fixed: "1" }, venueSpace: { fixed: "hall-a" }, area: { fixed: "A" },
  boothCode: { column: 0 }, circleName: { column: 1 },
};
const MIXED_ROWS = [
  { sourceRow: 1, cells: ["Space", "Area", "Booth", "Circle"] },
  { sourceRow: 2, cells: ["全館", "來源中的假分區", "A01", "甲社"] },
  { sourceRow: 3, cells: ["分館", "B", "B01", "乙社"] },
  { sourceRow: 4, cells: ["分館", "", "B02", "丙社"] },
];
const MIXED_MAPPING = {
  day: { fixed: "1" },
  venueSpace: { column: 0, values: { 全館: "whole-hall", 分館: "divided-hall" } },
  area: { column: 1 }, boothCode: { column: 2 }, circleName: { column: 3 },
};
const MIXED_AREA_MODES = { "whole-hall": "none", "divided-hall": "imported" };

test("a removed source row produces neither an imported row nor an issue", () => {
  const removeLater = imports.prepareOrganizerImport({
    rows: DUPLICATE_ROWS, headerRow: 1, mapping: DUPLICATE_MAPPING, excludedRows: [7, 8],
  });
  assert.deepEqual(removeLater.issues, []);
  assert.deepEqual(removeLater.rows.map((row) => row.sourceRow), [6]);

  // Removing the row that claimed the booth first hands the placement to the
  // survivor, so the duplicate is gone rather than merely reassigned.
  const removeFirst = imports.prepareOrganizerImport({
    rows: DUPLICATE_ROWS, headerRow: 1, mapping: DUPLICATE_MAPPING, excludedRows: [6, 8],
  });
  assert.deepEqual(removeFirst.issues, []);
  assert.deepEqual(removeFirst.rows.map((row) => [row.sourceRow, row.codes[0]]), [[7, "a01"]]);
});

test("a correction supplies a missing value and the row stops being rejected", () => {
  const result = imports.prepareOrganizerImport({
    rows: MIXED_ROWS, headerRow: 1, mapping: MIXED_MAPPING, areaModeByVenueSpace: MIXED_AREA_MODES,
    overrides: { 4: { areaId: "B" } },
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.rows.map(({ sourceRow, areaId }) => [sourceRow, areaId]), [[2, "ALL"], [3, "B"], [4, "B"]]);
});

test("a no-division space ignores an area correction", () => {
  const result = imports.prepareOrganizerImport({
    rows: MIXED_ROWS, headerRow: 1, mapping: MIXED_MAPPING, areaModeByVenueSpace: MIXED_AREA_MODES,
    overrides: { 2: { areaId: "手動填的分區" } },
  });
  assert.equal(result.rows.find((row) => row.sourceRow === 2).areaId, "ALL");
});

test("correcting the venue space re-decides whether the row needs an area at all", () => {
  const result = imports.prepareOrganizerImport({
    rows: MIXED_ROWS, headerRow: 1, mapping: MIXED_MAPPING, areaModeByVenueSpace: MIXED_AREA_MODES,
    overrides: { 4: { venueSpaceId: "whole-hall" } },
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.find((row) => row.sourceRow === 4), {
    sourceRow: 4, dayId: "1", venueSpaceId: "whole-hall", areaId: "ALL",
    codes: ["B02"], circleName: "丙社", stableKey: null, identityGroup: null,
  });
});

test("a corrected internal number rebuilds the identity group instead of keeping a stale one", () => {
  const linked = imports.prepareOrganizerImport({
    rows: DUPLICATE_ROWS.slice(0, 2), headerRow: 1, mapping: DUPLICATE_MAPPING,
    overrides: { 6: { stableKey: "circle-101" } },
  });
  assert.equal(linked.rows[0].stableKey, "circle-101");
  assert.equal(linked.rows[0].identityGroup, "stable:circle-101");

  const cleared = imports.prepareOrganizerImport({
    rows: [DUPLICATE_ROWS[0], { sourceRow: 6, cells: ["A01", "同名社團", "circle-101"] }],
    headerRow: 1, mapping: { ...DUPLICATE_MAPPING, stableKey: { column: 2 } },
    overrides: { 6: { stableKey: "" } },
  });
  assert.equal(cleared.rows[0].stableKey, null);
  assert.equal(cleared.rows[0].identityGroup, null);
});

test("a correction can create a duplicate placement", () => {
  const result = imports.prepareOrganizerImport({
    rows: [
      DUPLICATE_ROWS[0],
      { sourceRow: 6, cells: ["A01", "甲社"] },
      { sourceRow: 7, cells: ["A02", "乙社"] },
    ],
    headerRow: 1, mapping: DUPLICATE_MAPPING, overrides: { 7: { boothCode: "A01" } },
  });
  assert.deepEqual(result.issues.map(({ row, code }) => [row, code]), [[7, "duplicate_booth"]]);
  assert.deepEqual(result.rows.map((row) => row.sourceRow), [6]);
});

test("rejected rows carry the values that did resolve and the codes that rejected them", () => {
  const result = imports.prepareOrganizerImport({
    rows: DUPLICATE_ROWS, headerRow: 1, mapping: DUPLICATE_MAPPING,
  });
  assert.deepEqual(result.rejected.map(({ sourceRow, codes }) => [sourceRow, codes]), [
    [7, ["duplicate_booth"]], [8, ["missing_booth", "missing_circle"]],
  ]);
  // The fixed day and space survive a rejection, so the preview can show the
  // row with only its unresolved cells marked.
  assert.equal(result.rejected[1].dayId, "1");
  assert.equal(result.rejected[1].venueSpaceId, "hall-a");
  assert.equal(result.rejected[1].boothCode, "");
});

test("a correction cannot resurrect the header line as data", () => {
  const result = imports.prepareOrganizerImport({
    rows: DUPLICATE_ROWS, headerRow: 1, mapping: DUPLICATE_MAPPING,
    overrides: { 5: { boothCode: "Z99", circleName: "標題列社團" } },
  });
  assert.equal(result.rows.some((row) => row.sourceRow === 5), false);
  assert.equal(result.rejected.some((row) => row.sourceRow === 5), false);
});

test("the downloadable example parses back into the table it was built from", () => {
  const sample = imports.buildOrganizerImportSample({
    days: [{ id: "1", label: "第一天" }, { id: "2", label: "第二天" }],
    spaces: [{ id: "zhengyan", label: "新光三越高雄左營店・10F國際活動展演中心", divided: true }],
    requiresArea: true,
  });
  assert.deepEqual(sample.header, ["活動日", "使用空間", "展區", "攤位代碼", "社團名稱", "主辦內部編號"]);

  const parsed = imports.parseOrganizerCsv(imports.toOrganizerCsv([sample.header, ...sample.rows]));
  assert.deepEqual(parsed.map((row) => row.cells), [sample.header, ...sample.rows]);

  // The example is not just readable, it is importable: mapping it by column
  // yields exactly the rows it shows.
  const result = imports.prepareOrganizerImport({
    rows: parsed, headerRow: 1,
    mapping: {
      day: { column: 0, values: { 1: "1", 2: "2" } },
      venueSpace: { column: 1, values: { "新光三越高雄左營店・10F國際活動展演中心": "zhengyan" } },
      area: { column: 2 }, boothCode: { column: 3 }, circleName: { column: 4 }, stableKey: { column: 5 },
    },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows.length, sample.rows.length);
  assert.deepEqual(result.rows.map((row) => row.identityGroup), ["stable:circle-001", "stable:circle-002", "stable:circle-003"]);
});

test("an undivided event gets an example without an area column", () => {
  const sample = imports.buildOrganizerImportSample({
    days: [{ id: "1", label: "第一天" }],
    spaces: [{ id: "whole-hall", label: "全館", divided: false }],
    requiresArea: false,
  });
  assert.deepEqual(sample.header, ["活動日", "使用空間", "攤位代碼", "社團名稱", "主辦內部編號"]);
  assert.equal(sample.rows.every((row) => row[0] === "1" && row[1] === "全館"), true);
});

test("the example leaves the area blank for a space that has no divisions", () => {
  const sample = imports.buildOrganizerImportSample({
    days: [{ id: "1", label: "第一天" }],
    spaces: [{ id: "divided", label: "分區館", divided: true }, { id: "whole", label: "全館", divided: false }],
    requiresArea: true,
  });
  // The column exists because another space is divided, but filling it in for
  // the undivided one would teach a value the import throws away.
  const area = sample.header.indexOf("展區");
  const space = sample.header.indexOf("使用空間");
  const cells = sample.rows.map((row) => [row[space], row[area]]);
  assert.deepEqual(cells.filter(([name]) => name === "全館").map(([, value]) => value), ["", ""]);
  assert.equal(cells.find(([name]) => name === "分區館")[1], "A");
});

const groupImport = (values, mapping = {}) => imports.prepareOrganizerImport({
  rows: [{ sourceRow: 1, cells: ["攤位", "社團"] }, ...values.map((code, index) => ({ sourceRow: index + 2, cells: [code, `社團${index}`] }))],
  headerRow: 1, mapping: { day: { fixed: "1" }, venueSpace: { fixed: "hall" }, area: { fixed: "ALL" }, boothCode: { column: 0 }, circleName: { column: 1 }, ...mapping },
});

test("combined codes require confirmed width, preserve groups, and detect individual collisions", () => {
  const single = groupImport(["A01", "A02A03"]);
  assert.deepEqual(single.rows[1].codes, ["A02A03"]);
  assert.equal(single.suggestedWidth, 3);
  assert.equal(single.issues[0].code, "possibly_combined_booth");
  assert.throws(() => groupImport(["A01A02"], { boothCodeMode: "fixed-width" }), /確認/);
  const grouped = groupImport(["A01A02", "A03"], { boothCodeMode: "fixed-width", boothCodeWidth: 3 });
  assert.equal(grouped.boothCount, 3);
  assert.deepEqual(grouped.rows[0].codes, ["A01", "A02"]);
  assert.equal(grouped.rows[0].identityGroup, null, "a multi-booth circle needs no stable key");
  const duplicates = groupImport(["A01A02", "a02A03"], { boothCodeMode: "fixed-width", boothCodeWidth: 3 });
  assert.equal(duplicates.rejected[0].sourceRow, 3);
  assert.equal(duplicates.issues[0].code, "duplicate_booth");
  assert.equal(groupImport(["A01A01"], { boothCodeMode: "fixed-width", boothCodeWidth: 3 }).rejected.length, 1);
  const invalid = groupImport(["A01A0"], { boothCodeMode: "fixed-width", boothCodeWidth: 3 });
  assert.equal(invalid.rows.length, 0);
  assert.equal(invalid.issues[0].row, 2);
});

test("delimited mode supports official separators and rejects duplicates inside a group", () => {
  assert.deepEqual(groupImport(["A01，A02、A03;A04；A05/A06 A07"], { boothCodeMode: "delimited" }).rows[0].codes,
    ["A01", "A02", "A03", "A04", "A05", "A06", "A07"]);
  assert.equal(groupImport(["A01,a01"], { boothCodeMode: "delimited" }).rejected.length, 1);
  assert.equal(groupImport([",;/"], { boothCodeMode: "delimited" }).rejected.length, 1);
  assert.equal(groupImport(["A01 A02"], { boothCodeMode: "fixed-width", boothCodeWidth: 7 }).rejected.length, 1);
});

test("CH20-shaped 170 groups cover all 202 physical booths without invented identity", () => {
  // Structural regression fixture, not a copy of the official circle names.
  const codes = Object.entries({ A: 18, B: 30, C: 30, D: 28, E: 28, F: 30, G: 30, S: 8 })
    .flatMap(([area, count]) => Array.from({ length: count }, (_, index) => `${area}${String(index + 1).padStart(2, "0")}`));
  const rows = [...Array.from({ length: 32 }, (_, index) => codes[index * 2] + codes[index * 2 + 1]), ...codes.slice(64)];
  const result = groupImport(rows, { boothCodeMode: "fixed-width", boothCodeWidth: 3 });
  assert.equal(result.rows.length, 170);
  assert.equal(result.boothCount, 202);
  assert.deepEqual(result.rows.flatMap((row) => row.codes), codes);
  assert.deepEqual(result.issues, []);
});

// #294: 展區 is a required column, so an organizer whose list has no real one
// maps the nearest thing — almost always the row letter at the front of the
// booth code. pf45-rf14 imported 1434 rows that way and the event ended up
// declaring 13 "areas" that were 13 rows of one hall.
const rowLetterImport = (count, letters) => imports.prepareOrganizerImport({
  rows: [
    { sourceRow: 1, cells: ["Day", "Area", "Booth", "Circle"] },
    ...Array.from({ length: count }, (unused, index) => {
      const letter = letters[index % letters.length];
      return { sourceRow: index + 2, cells: ["1", letter, `${letter}${String(index + 1).padStart(2, "0")}`, `社團 ${index + 1}`] };
    }),
  ],
  headerRow: 1,
  mapping: {
    day: { fixed: "1" }, venueSpace: { fixed: "zhengyan" }, area: { column: 1 },
    boothCode: { column: 2 }, circleName: { column: 3 },
  },
});

test("an area column that is only the booth row letter is called out, not refused", () => {
  const warned = rowLetterImport(26, ["A", "B", "C", "D"]);
  const issue = warned.issues.find(({ code }) => code === "area_looks_like_booth_row");
  assert.equal(issue.severity, "warning", "an organizer really may use whole rows as areas");
  assert.match(issue.message, /沒有分區/);
  assert.equal(warned.rows.length, 26, "and every row still imports");

  // One area for the whole space is a deliberate choice, not the shape this
  // looks for: there is nothing to tell apart.
  assert.equal(rowLetterImport(26, ["A"]).issues.some(({ code }) => code === "area_looks_like_booth_row"), false);

  // A handful of rows is not evidence of anything.
  assert.equal(rowLetterImport(8, ["A", "B"]).issues.some(({ code }) => code === "area_looks_like_booth_row"), false);
});

test("a real area column is left alone", () => {
  const real = imports.prepareOrganizerImport({
    rows: [
      { sourceRow: 1, cells: ["Day", "Area", "Booth", "Circle"] },
      ...Array.from({ length: 12 }, (unused, index) => ({
        sourceRow: index + 2,
        cells: ["1", index < 6 ? "東側" : "西側", `A${String(index + 1).padStart(2, "0")}`, `社團 ${index + 1}`],
      })),
    ],
    headerRow: 1,
    mapping: {
      day: { fixed: "1" }, venueSpace: { fixed: "zhengyan" }, area: { column: 1 },
      boothCode: { column: 2 }, circleName: { column: 3 },
    },
  });
  assert.equal(real.issues.some(({ code }) => code === "area_looks_like_booth_row"), false);
});
