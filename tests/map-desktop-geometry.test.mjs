import assert from "node:assert/strict";
import test from "node:test";
import { availableMapRect, fitMapInRect, offsetMapPointInRect, resizeMapView } from "../app/map-viewport.ts";
import { mapLabelFontSize } from "../app/map-label-presentation.ts";

test("desktop fit contains the entire floor outside fixed tools; details only affect selection", () => {
  const viewport = { width: 1144, height: 828 };
  const tools = { top: { x: 16, y: 16, width: 1112, height: 72 }, bottom: { x: 16, y: 768, width: 346, height: 44 } };
  const rect = availableMapRect(viewport, tools);
  assert.deepEqual(rect, { x: 16, y: 104, width: 1112, height: 648 });
  const inset = { x: 18, y: 18 };
  const floor = { width: 1344.34, height: 950 };
  const fit = fitMapInRect(rect, floor, inset);
  assert.ok(fit);
  assert.ok(fit.offset.x + inset.x >= rect.x + 36 - 1e-8);
  assert.ok(fit.offset.y + inset.y >= rect.y + 36 - 1e-8);
  assert.ok(fit.offset.y + inset.y + floor.height * fit.zoom <= rect.y + rect.height - 36 + 1e-8);
  const safe = availableMapRect(viewport, { ...tools, detail: { x: 798, y: 16, width: 330, height: 736 } });
  assert.equal(safe.x + safe.width, 782);
  const point = { x: 900, y: 700 };
  const offset = offsetMapPointInRect(point, safe, fit.zoom, inset);
  assert.equal(offset.x + inset.x + point.x * fit.zoom, safe.x + safe.width / 2);
  assert.deepEqual(fitMapInRect(rect, floor, inset), fit);
});

test("invalid available space defers fit; manual resize preserves center at clamped zoom", () => {
  assert.equal(fitMapInRect(availableMapRect({ width: 0, height: 0 }), { width: 1200, height: 950 }, { x: 0, y: 0 }), null);
  const before = { width: 800, height: 600 }, after = { width: 1000, height: 800 }, inset = { x: 18, y: 18 };
  const current = { zoom: .8, offset: { x: -30, y: 40 } };
  const next = resizeMapView(current, before, after, 1, inset);
  assert.equal(next.zoom, 1);
  for (const [axis, dimension] of [["x", "width"], ["y", "height"]]) {
    assert.equal((after[dimension] / 2 - inset[axis] - next.offset[axis]) / next.zoom, (before[dimension] / 2 - inset[axis] - current.offset[axis]) / current.zoom);
  }
});

test("labels appear at the inclusive 8px boundary and remain inside their band", () => {
  const p = { screenScale: 1, targetPx: 12, minimumPx: 8, paddingPx: 2 };
  assert.equal(mapLabelFontSize({ width: 19.98, height: 30 }, "03", false, p), null);
  assert.equal(mapLabelFontSize({ width: 20, height: 30 }, "03", false, p), 8);
  assert.equal(mapLabelFontSize({ width: 40, height: 30 }, "03", false, p), 12);
  assert.equal(mapLabelFontSize({ width: 40, height: 30 }, "03", true, p), null);
  assert.equal(mapLabelFontSize({ width: 40, height: 30 }, "03", false, { ...p, screenScale: NaN }), null);
  for (const targetPx of [12, 13.44, 14.88]) for (const screenScale of [.5, 1, 2, 6]) for (const media of [false, true]) {
    const font = mapLabelFontSize({ width: 28.5, height: 18 }, "1234", media, { ...p, screenScale, targetPx });
    if (font !== null) {
      assert.ok(font * screenScale * 4 <= 28.5 * screenScale - 4 + 1e-8);
      assert.ok(font * screenScale * 1.2 <= 18 * (media ? .3 : 1) * screenScale - 4 + 1e-8);
    }
  }
});
