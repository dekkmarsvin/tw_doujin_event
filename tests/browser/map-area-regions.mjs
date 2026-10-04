import { openToolGroup } from "./support/map-authoring.mjs";
// staged-data: fixture
// Organizer polygon authoring and Reader overview/detail visibility use the
// same real renderer, with a synthetic map API and fixture catalog.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";

const journey = await start("map-area-regions");
journey.report.synthetic = true;
journey.report.productionWrites = 0;

try {
  const { page, editor, state } = await openSurface(journey, "organizer", source, { areaLabels: { A: "原創 插畫/手作" } });
  const svg = editor.locator("svg[tabindex='0']");
  const draw = async (points) => {
    await openToolGroup(editor, "區域");
    await editor.getByRole("button", { name: "新增展區範圍" }).click();
    assert.equal(await editor.getByRole("status").filter({ hasText: "在地圖上依序點選範圍的頂點" }).getByRole("combobox", { name: /^展區/ }).locator('option[value="A"]').innerText(), "原創 插畫/手作");
    await svg.scrollIntoViewIfNeeded();
    for (const [x, y] of points) {
      const box = await svg.boundingBox();
      await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
    }
    await editor.getByRole("button", { name: /完成範圍/ }).click();
  };
  await draw([[.05, .05], [.42, .05], [.42, .7], [.05, .6]]);
  // The property panel floats over the right of the canvas, so the second
  // piece is drawn where the map is still uncovered.
  await draw([[.48, .05], [.7, .05], [.7, .7]]);
  assert.equal(await svg.locator("polygon").count(), 2);
  await journey.capture(page, "organizer-area-two-pieces");
  await page.getByRole("button", { name: "儲存地圖變更", exact: true }).click();
  await page.getByText("地圖已儲存，尚未公開。", { exact: true }).waitFor();
  assert.equal(state.saves, 1);
  assert.deepEqual(state.layout.areaRegions.map((region) => [region.areaId, region.color]), [["A", "mint"], ["A", "mint"]]);
  assert.deepEqual(state.layout.rows, source.rows, "painting leaves booth geometry intact");
  await page.close();

  const map = { eventId: "sample", revision: 1, sourceName: "fixture area map", confidence: 1, updatedAt: "2026-01-01T00:00:00.000+08:00", layout: state.layout };
  const reader = await journey.mapPage({ routes: async (tab) => {
    await tab.route("**/data/events/sample/map.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map) }));
  } });
  const regions = reader.locator('svg [aria-label="展區範圍"] polygon');
  await regions.first().waitFor();
  assert.equal(await regions.count(), 2);
  assert.equal(await reader.locator('[data-slot-code="S01"][role="button"]').count(), 1);
  await journey.capture(reader, "reader-area-overview");
  for (let step = 0; step < 30 && await regions.count(); step++) await reader.getByRole("button", { name: "放大地圖", exact: true }).click();
  assert.equal(await regions.count(), 0, "regions disappear at detail zoom");
  await journey.capture(reader, "reader-area-detail");
  await reader.getByRole("button", { name: "查看全場", exact: true }).click();
  assert.equal(await regions.count(), 2, "zooming out restores the same regions");
  await reader.locator('[data-slot-code="S01"][role="button"]').click();
  assert.equal(new URL(reader.url()).searchParams.has("selectedCircle"), true, "regions do not intercept booth selection");
  await reader.close();
  const mobile = await journey.mapPage({ viewport: { width: 390, height: 844 }, routes: async (tab) => {
    await tab.route("**/data/events/sample/map.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map) }));
  } });
  const mobileRegions = mobile.locator('svg [aria-label="展區範圍"] polygon');
  await mobileRegions.first().waitFor();
  assert.equal(await mobileRegions.count(), 2);
  await journey.capture(mobile, "reader-area-mobile-overview");
  for (let step = 0; step < 30 && await mobileRegions.count(); step++) await mobile.getByRole("button", { name: "放大地圖", exact: true }).click();
  assert.equal(await mobileRegions.count(), 0, "mobile detail zoom hides overview regions");
  await journey.capture(mobile, "reader-area-mobile-detail");
  await mobile.getByRole("button", { name: "查看全場", exact: true }).click();
  assert.equal(await mobileRegions.count(), 2, "mobile zoom out restores regions");
  await mobile.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
