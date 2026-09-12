import assert from "node:assert/strict";
import test from "node:test";
import { mobileAvailableMapRect, availableMapRect, fitMapInRect, offsetMapPointInRect, resizeMapView } from "../app/map-viewport.ts";
import { MAP_MEDIA_LABEL_BAND, mapLabelFontSize } from "../app/map-label-presentation.ts";

test("desktop fit contains the entire floor outside fixed tools; details only affect selection", () => {
  const viewport = { width: 1144, height: 828 };
  const tools = { top: { x: 16, y: 16, width: 1112, height: 72 }, bottom: { x: 16, y: 768, width: 346, height: 44 } };
  const rect = availableMapRect(viewport, tools);
  assert.deepEqual(rect, { x: 16, y: 104, width: 1112, height: 648 });
  const inset = { x: 18, y: 18 };
  const floor = { width: 1344.34, height: 950 };
  const fit = fitMapInRect(rect, floor, inset);
  assert.ok(fit);
  assert.ok(fit.offset.x + inset.x >= rect.x - 1e-8);
  assert.ok(fit.offset.y + inset.y >= rect.y - 1e-8);
  assert.ok(fit.offset.y + inset.y + floor.height * fit.zoom <= rect.y + rect.height + 1e-8);
  // The floor uses the whole available rect on its binding axis, no inner padding.
  assert.ok(Math.abs(floor.height * fit.zoom - rect.height) < 1e-8);
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

test("labels always size to the available band and never leave it", () => {
  const p = { screenScale: 1, targetPx: 12, paddingPx: 2 };
  assert.equal(mapLabelFontSize({ width: 40, height: 30 }, "03", false, p), 12);
  assert.equal(mapLabelFontSize({ width: 20, height: 30 }, "03", false, p), 8);
  // Cramped overviews and media bands shrink the code, they never drop it.
  assert.ok(mapLabelFontSize({ width: 19.98, height: 30 }, "03", false, p) > 0);
  assert.ok(mapLabelFontSize({ width: 40, height: 30 }, "03", true, p) > 0);
  assert.equal(mapLabelFontSize({ width: 40, height: 30 }, "03", false, { ...p, screenScale: NaN }), null);
  for (const targetPx of [12, 13.44, 14.88]) for (const screenScale of [.5, 1, 2, 6]) for (const media of [false, true]) {
    const font = mapLabelFontSize({ width: 28.5, height: 18 }, "1234", media, { ...p, screenScale, targetPx });
    const band = { width: 28.5 * screenScale, height: 18 * (media ? MAP_MEDIA_LABEL_BAND : 1) * screenScale };
    assert.ok(font > 0);
    assert.ok(font * screenScale * 4 <= band.width + 1e-8);
    assert.ok(font * screenScale * 1.2 <= band.height + 1e-8);
    // Wherever the band can spare it, the 2px inset per side is still honoured.
    if (band.width >= 8) assert.ok(font * screenScale * 4 <= band.width - 4 + 1e-8);
    if (band.height >= 8) assert.ok(font * screenScale * 1.2 <= band.height - 4 + 1e-8);
  }
});


test("mobile selection stays above the sheet and left of controls without changing zoom", () => {
  const viewport = { width: 390, height: 730 };
  const top = { x: 12, y: 9, width: 366, height: 58 };
  const dock = { x: 0, y: 476, width: 390, height: 254 };
  const controls = { x: 334, y: 308, width: 44, height: 154 };
  const rect = mobileAvailableMapRect(viewport, { top, bottom: dock, controls });
  assert.deepEqual(rect, { x: 16, y: 83, width: 306, height: 377 });
  assert.ok(rect.height >= 240);
  const point = { x: 1250, y: 800 }, inset = { x: 10, y: 10 }, zoom = 1.6;
  const offset = offsetMapPointInRect(point, rect, zoom, inset);
  const screen = { x: point.x * zoom + offset.x + inset.x, y: point.y * zoom + offset.y + inset.y };
  assert.ok(screen.x < controls.x && screen.y < dock.y && screen.y > top.y + top.height);
  const collapsed = mobileAvailableMapRect(viewport, { top, bottom: { ...dock, y: 622 } });
  const fit = fitMapInRect(collapsed, { width: 1344, height: 950 }, inset);
  assert.ok(fit.offset.y + inset.y + 950 * fit.zoom <= collapsed.y + collapsed.height);
});

test("mobile geometry handles keyboard-sized viewports and absent controls", () => {
  const rect = mobileAvailableMapRect({ width: 360, height: 150 }, { top: { x: 12, y: 9, width: 336, height: 100 }, bottom: { x: 0, y: 80, width: 360, height: 210 } });
  assert.equal(rect.height, 0);
  assert.equal(fitMapInRect(rect, { width: 1344, height: 950 }, { x: 10, y: 10 }), null);
  assert.deepEqual(mobileAvailableMapRect({ width: 0, height: 0 }), { x: 0, y: 0, width: 0, height: 0 });
});
