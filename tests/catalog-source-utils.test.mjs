import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeTextSource } from "../scripts/catalog-source-utils.mjs";
import { compareWorkbookData } from "../scripts/workbook-diff-utils.mjs";

const sha256 = (value) => createHash("sha256").update(normalizeTextSource(value)).digest("hex");

test("catalog text source hashes are stable across platform line endings", () => {
  const lf = "circle_name,thumbnail_url\n社團甲,https://example.com/a.png\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  const cr = lf.replaceAll("\n", "\r");

  assert.equal(normalizeTextSource(crlf), lf);
  assert.equal(normalizeTextSource(cr), lf);
  assert.equal(sha256(crlf), sha256(lf));
  assert.equal(sha256(cr), sha256(lf));
});

test("workbook data comparison reports cell and sheet changes", () => {
  const current = { sheets: [
    { name: "主表", cells: [
      { reference: "A1", value: "名稱" },
      { reference: "A2", value: "社團甲" },
      { reference: "B2", value: 1, formula: "1" },
    ] },
    { name: "已刪工作表", cells: [{ reference: "A1", value: "舊資料" }] },
  ] };
  const incoming = { sheets: [
    { name: "主表", cells: [
      { reference: "A1", value: "名稱" },
      { reference: "A2", value: "社團乙" },
      { reference: "C2", value: true },
    ] },
    { name: "新增工作表", cells: [{ reference: "A1", value: "新資料" }] },
  ] };

  const diff = compareWorkbookData(current, incoming);

  assert.equal(diff.changed, true);
  assert.deepEqual(diff.totals, { added: 2, removed: 2, changed: 1 });
  assert.deepEqual(diff.sheets.map(({ name, status }) => ({ name, status })), [
    { name: "主表", status: "changed" },
    { name: "已刪工作表", status: "removed" },
    { name: "新增工作表", status: "added" },
  ]);
  assert.deepEqual(diff.samples[0], {
    sheet: "主表",
    reference: "A2",
    kind: "changed",
    before: { reference: "A2", value: "社團甲" },
    after: { reference: "A2", value: "社團乙" },
  });
});

test("workbook data comparison ignores identical workbook data", () => {
  const workbook = { sheets: [{ name: "主表", cells: [{ reference: "A1", value: "相同" }] }] };
  assert.deepEqual(compareWorkbookData(workbook, structuredClone(workbook)), {
    changed: false,
    totals: { added: 0, removed: 0, changed: 0 },
    sheets: [],
    samples: [],
  });
});

test("workbook data comparison ignores volatile formula caches and their dependents", () => {
  const current = { sheets: [{ name: "狀態", cells: [
    { reference: "A1", value: 10, formula: "NOW()" },
    { reference: "B1", value: "舊倒數", formula: "A1-C1" },
    { reference: "C1", value: 5 },
    { reference: "D1", value: 2, formula: "1+1" },
  ] }] };
  const incoming = { sheets: [{ name: "狀態", cells: [
    { reference: "A1", value: 11, formula: "NOW()" },
    { reference: "B1", value: "新倒數", formula: "A1-C1" },
    { reference: "C1", value: 5 },
    { reference: "D1", value: 3, formula: "1+1" },
  ] }] };

  const diff = compareWorkbookData(current, incoming);

  assert.deepEqual(diff.totals, { added: 0, removed: 0, changed: 1 });
  assert.equal(diff.samples[0].reference, "D1");
});
