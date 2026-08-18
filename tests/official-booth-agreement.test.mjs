import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareOfficialWithCatalog,
  diffOfficialSnapshots,
  indexOfficialBooths,
  parseOfficialBoothTable,
} from "../scripts/official-booth-utils.mjs";

const page = (rows) => `<html><body><table><tbody><tr><th>攤位編號</th><th>攤位名稱</th></tr>${
  rows.map(([codes, name]) => `<tr><td>${codes}</td><td>${name}</td></tr>`).join("")
}</tbody></table></body></html>`;

const filler = (count, offset = 0) => Array.from({ length: count }, (_, index) => {
  const serial = index + offset + 1;
  return [`A${String(serial).padStart(2, "0")}`, `社團${serial}`];
});

test("the official booth table parses codes, names and comma-joined booths", () => {
  const booths = parseOfficialBoothTable(page([["A01,A02", "OriginZero"], ["A03", "MAI &amp; friends"]]), { day: 1, minimumRows: 2 });

  assert.deepEqual(booths, [
    { codes: ["A01", "A02"], name: "OriginZero" },
    { codes: ["A03"], name: "MAI & friends" },
  ]);
});

test("a page without a booth table stops the pipeline instead of publishing nothing", () => {
  assert.throws(() => parseOfficialBoothTable("<html><body><p>維護中</p></body></html>", { day: 2 }), /no booth table/);
});

test("a truncated list is rejected rather than treated as an update", () => {
  assert.throws(() => parseOfficialBoothTable(page(filler(3)), { day: 3, minimumRows: 600 }), /only 3 booth rows/);
});

test("an unreadable booth code fails rather than silently dropping a circle", () => {
  assert.throws(() => parseOfficialBoothTable(page([["企業攤", "某公司"]]), { day: 1, minimumRows: 1 }), /unreadable booth code/);
});

test("the same booth listed twice under different names fails closed", () => {
  const html = page([["B01", "社團甲"], ["B01", "社團乙"]]);

  assert.throws(() => parseOfficialBoothTable(html, { day: 1, minimumRows: 1 }), /twice with different names/);
});

test("snapshot diffs report added, removed and renamed booths separately", () => {
  const before = { days: [{ day: 1, booths: [{ codes: ["A01"], name: "甲" }, { codes: ["A02"], name: "乙" }] }] };
  const after = { days: [{ day: 1, booths: [{ codes: ["A01"], name: "甲改名" }, { codes: ["A03"], name: "丙" }] }] };

  const diff = diffOfficialSnapshots(before, after);

  assert.deepEqual(diff.added, ["1:A03"]);
  assert.deepEqual(diff.removed, ["1:A02"]);
  assert.deepEqual(diff.renamed, [{ key: "1:A01", before: "甲", after: "甲改名" }]);
});

test("a name conflict the adjudication file has never seen is drift, not backlog", () => {
  const official = { days: [{ day: 1, booths: [{ codes: ["A01"], name: "官網名" }] }] };
  const catalog = { booths: [{ day: 1, code: "A01", name: "工作簿名" }] };

  const unseen = compareOfficialWithCatalog({ official, catalog, adjudications: { conflicts: [] } });
  assert.deepEqual(unseen.unrecorded, [{ key: "1:A01", official: "官網名", catalog: "工作簿名" }]);

  const recorded = compareOfficialWithCatalog({
    official,
    catalog,
    adjudications: { conflicts: [{ key: "1:A01", official: "官網名", catalog: "工作簿名", decision: "unadjudicated" }] },
  });
  assert.equal(recorded.unrecorded.length, 0);
  assert.equal(recorded.unadjudicated.length, 1);
});

test("a recorded conflict whose names moved on is treated as new drift", () => {
  const result = compareOfficialWithCatalog({
    official: { days: [{ day: 1, booths: [{ codes: ["A01"], name: "官網新名" }] }] },
    catalog: { booths: [{ day: 1, code: "A01", name: "工作簿名" }] },
    adjudications: { conflicts: [{ key: "1:A01", official: "官網舊名", catalog: "工作簿名", decision: "official" }] },
  });

  assert.equal(result.unrecorded.length, 1);
});

test("booths present on only one side are reported as grid drift", () => {
  const result = compareOfficialWithCatalog({
    official: { days: [{ day: 1, booths: [{ codes: ["A01"], name: "甲" }, { codes: ["A09"], name: "新社團" }] }] },
    catalog: { booths: [{ day: 1, code: "A01", name: "甲" }, { day: 1, code: "A05", name: "已撤" }] },
    adjudications: { conflicts: [] },
  });

  assert.deepEqual(result.missingFromCatalog, ["1:A09"]);
  assert.deepEqual(result.missingFromOfficial, ["1:A05"]);
});

test("a resolved conflict left in the adjudication file is reported as stale", () => {
  const result = compareOfficialWithCatalog({
    official: { days: [{ day: 1, booths: [{ codes: ["A01"], name: "同名" }] }] },
    catalog: { booths: [{ day: 1, code: "A01", name: "同名" }] },
    adjudications: { conflicts: [{ key: "1:A01", official: "舊", catalog: "更舊", decision: "official" }] },
  });

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.stale.length, 1);
});

test("the committed official snapshot agrees with the published catalog grid", async () => {
  const [official, catalog, adjudications] = await Promise.all(
    [
      "data_source_test/ff47-official-booths.json",
      "public/data/events/ff47/circles.json",
      "data_source_test/ff47-official-name-adjudications.json",
    ].map((path) => readFile(path, "utf8").then(JSON.parse)),
  );

  const result = compareOfficialWithCatalog({ official, catalog, adjudications });

  assert.equal(indexOfficialBooths(official).size, 2953);
  assert.deepEqual(result.missingFromCatalog, []);
  assert.deepEqual(result.missingFromOfficial, []);
  assert.deepEqual(result.unrecorded, []);
  assert.deepEqual(result.stale, []);
});
