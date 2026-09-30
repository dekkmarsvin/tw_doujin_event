import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { planRowCopies: plan, copyRowLabels: labels } = await vite.environments.ssr.runner.import("/app/map-row-copies.ts");
after(() => vite.close());
const row = { label: "A", orientation: "vertical", confidence: 1, slots: [
  { code: "A01", rect: { x: 20, y: 20, width: 10, height: 10 } },
  { code: "A02", rect: { x: 20, y: 30, width: 10, height: 10 } },
  { code: "A03", rect: { x: 40, y: 30, width: 10, height: 10 } },
  { code: "A04", rect: { x: 40, y: 20, width: 10, height: 10 } },
] };
const layout = { width: 500, height: 500, rows: [row], floor: { x: 0, y: 0, width: 500, height: 500 }, pillars: [], landmarks: [], accessPoints: [] };
const options = { count: 3, gap: 5, labels: ["B", "C", "D"], direction: "right" };
test("a U-shaped batch preserves numbering order, geometry, source and orientation", () => {
  const before = structuredClone(layout);
  const result = plan(row, layout, options);
  assert.equal(result.ok, true);
  assert.deepEqual(layout, before);
  assert.deepEqual(result.rows.map(r => r.label), ["B", "C", "D"]);
  for (const [i, copy] of result.rows.entries()) for (const [j, slot] of copy.slots.entries()) {
    assert.equal(copy.orientation, row.orientation);
    assert.equal(slot.code, copy.label + row.slots[j].code.slice(1));
    assert.deepEqual(slot.rect, { ...row.slots[j].rect, x: row.slots[j].rect.x + 35 * (i + 1) });
  }
});
test("explicit labels support Chinese and bounded alphabet/branch sequences", () => {
  assert.deepEqual(labels("alphabet", "B", 21), [..."BCDEFGHIJKLMNOPQRSTUV"]);
  assert.deepEqual(labels("branches", "子", 8), [..."子丑寅卯辰巳午未"]);
  assert.equal(plan(row, layout, { ...options, labels: ["逃", "追", "賽"] }).rows[0].slots[0].code, "逃01");
  assert.equal(plan(row, layout, { ...options, labels: labels("alphabet", "Z", 3) }).ok, false);
});
test("a conflict anywhere rejects the whole batch without suffixes or clamping", () => {
  for (const patch of [{ labels: ["B", "C", "A"] }, { labels: ["B", "B", "C"] }, { labels: ["B"] }, { gap: 200 }, { direction: "left" }, { count: 0 }, { count: 1.2 }, { count: 101 }, { gap: NaN }, { gap: -1 }]) {
    const result = plan(row, layout, { ...options, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.deepEqual(result.rows, []);
  }
  const occupied = { ...layout, rows: [...layout.rows, { ...row, label: "X", slots: [{ code: "X01", rect: { x: 90, y: 20, width: 10, height: 10 } }] }] };
  assert.equal(plan(row, occupied, options).ok, false);
  const codeConflict = { ...layout, rows: [...layout.rows, { ...row, label: "X", slots: [{ code: "C01", rect: { x: 400, y: 400, width: 10, height: 10 } }] }] };
  assert.equal(plan(row, codeConflict, options).ok, false);
});
test("unsupported code prefixes are explained rather than guessed", () => {
  assert.match(plan({ ...row, slots: [{ ...row.slots[0], code: "特01" }] }, layout, options).error, /前綴/);
});
test("copies down, up and left use the selected bounds plus edge gap", () => {
  for (const [direction, x, y] of [["down", 20, 45], ["up", 20, 0], ["left", 0, 20]]) {
    const source = { ...row, slots: [row.slots[0]] };
    const gap = direction === "down" ? 15 : 10;
    const result = plan(source, { ...layout, rows: [source] }, { count: 1, labels: ["B"], gap, direction });
    assert.equal(result.ok, true);
    assert.equal(result.rows[0].slots[0].rect.x, x);
    assert.equal(result.rows[0].slots[0].rect.y, y);
  }
});
