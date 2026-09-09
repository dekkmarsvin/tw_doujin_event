// Opt-in browser acceptance against staged FF47 data. No production writes.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation; the
// ordinary Node suite does not depend on browsers. See the validation record.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.MAP_TEST_URL || "http://127.0.0.1:5173";
const output = path.resolve(process.env.MAP_TEST_OUTPUT || "outputs/map-viewport");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const report = { browser: browser.version(), recordedAt: new Date().toISOString(), source: "local pinned FF47, not production", cases: [], errors: [] };
const pause = (page) => page.waitForTimeout(180);
const detail = (page) => page.locator('aside[aria-label="已選社團詳情"]');
const state = (page) => page.evaluate(() => {
  const rect = (node) => node?.getBoundingClientRect().toJSON();
  const floor = document.querySelector(".floor");
  const transform = new DOMMatrix(getComputedStyle(floor).transform);
  const map = document.querySelector(".map");
  const tools = [...document.querySelectorAll("[data-map-tools]")];
  const selected = document.querySelector('[data-layer="selected-slots"] [data-slot-code]');
  return {
    width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight,
    h1: document.querySelectorAll("h1").length, header: rect(document.querySelector(".topbar")), map: rect(map),
    floor: rect(floor), inset: { x: floor.offsetLeft, y: floor.offsetTop }, zoom: transform.a,
    offset: { x: transform.e, y: transform.f }, tools: tools.map(rect), controls: rect(document.querySelector(".controls")),
    detail: rect(document.querySelector('aside[aria-label="已選社團詳情"]')), selected: rect(selected?.querySelector("rect")),
    labelCount: document.querySelectorAll("[data-slot-code] text").length,
    activeSlot: document.activeElement?.getAttribute("data-slot-code"),
  };
});
async function open(width = 1440, height = 900, scale = "standard", setup) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript((value) => localStorage.setItem("event-map-text-scale", value), scale);
  if (setup) await setup(page);
  await page.goto(`${base}/?event=ff47`);
  await page.locator('[data-slot-code="A01"]').waitFor();
  await pause(page);
  return page;
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const measured = await state(page);
  assert.equal(measured.bodyWidth, measured.width, `${name}: horizontal page overflow`);
  assert.equal(measured.h1, 1, `${name}: unique heading`);
  report.cases.push({ name, ...measured });
  return measured;
}
// The available rect already keeps 16px from the map edges and the floating
// tools; the floor fills it on its binding axis instead of padding twice.
function assertFit(measured) {
  const rect = { top: measured.tools[1].bottom + 16, bottom: measured.controls.top - 16, left: measured.map.left + 16, right: measured.map.right - 16 };
  assert.ok(measured.floor.top >= rect.top - 1, "fit clears top tools");
  assert.ok(measured.floor.bottom <= rect.bottom + 1, "fit clears bottom tools");
  assert.ok(measured.floor.left >= rect.left - 1, "fit stays inside the left edge");
  assert.ok(measured.floor.right <= rect.right + 1, "fit stays inside the right edge");
  const slack = { x: rect.right - rect.left - (measured.floor.right - measured.floor.left), y: rect.bottom - rect.top - (measured.floor.bottom - measured.floor.top) };
  assert.ok(Math.min(slack.x, slack.y) < 1, "fit uses the whole available rect on its binding axis");
}
function assertPosition(measured) {
  assert.ok(measured.selected && measured.detail);
  const left = measured.map.left + 16;
  const right = measured.detail.left - 16;
  const top = measured.tools[0].bottom + 16;
  const bottom = measured.controls.top - 16;
  assert.ok(Math.abs(measured.selected.x + measured.selected.width / 2 - (left + right) / 2) < 1, "selected horizontal center");
  assert.ok(Math.abs(measured.selected.y + measured.selected.height / 2 - (top + bottom) / 2) < 1, "selected vertical center");
}

try {
  for (const [width, height] of (process.env.MAP_TEST_SKIP_MATRIX ? [] : [[1440, 900], [1920, 1080], [1024, 768], [760, 768], [761, 768], [1050, 768], [1051, 768]])) {
    for (const scale of ["standard", "large", "extra"]) {
      const page = await open(width, height, scale);
      const prefix = `${width}-${height}-${scale}`;
      const overview = await capture(page, `${prefix}-explore`);
      if (width > 760) {
        assertFit(overview);
        assert.equal(overview.map.x, width > 1050 ? 296 : 248);
        assert.equal(overview.map.bottom, height);
        await page.getByRole("tab", { name: "行程 0", exact: true }).click();
        await pause(page);
        const plan = await capture(page, `${prefix}-plan`);
        assert.equal(plan.zoom, overview.zoom);
        assert.deepEqual(plan.offset, overview.offset);
        assert.equal(await page.getByRole("button", { name: "開始導航", exact: true }).getAttribute("aria-pressed"), "false");
        await page.getByRole("tab", { name: "探索", exact: true }).click();
        // The result remains a 44px target even when the map slot is tiny.
        await page.getByRole("button", { name: "A01 OriginZero", exact: true }).click();
        await pause(page);
        const selected = await capture(page, `${prefix}-selected`);
        assert.equal(selected.zoom, overview.zoom, "selection does not zoom");
        assertPosition(selected);
        assert.ok(selected.tools[0].right <= selected.detail.left - 16 + 1);
        assert.ok(selected.tools[0].height <= selected.map.height * .3 + 1);
      } else {
        assert.equal(await page.getByRole("tablist", { name: "行動版工作區" }).getByRole("tab").count(), 4);
        for (const name of ["展開工作面板", "完整展開工作面板", "縮小工作面板"]) {
          await page.getByRole("button", { name, exact: true }).click();
          await pause(page);
        }
        assert.equal(await page.locator("main").getAttribute("data-mobile-sheet-level"), "half");
        await page.getByRole("tab", { name: /^結果/ }).click();
        assert.equal(await page.locator("main").getAttribute("data-mobile-sheet-level"), "peek");
      }
      await page.close();
    }
  }

  const page = await open();
  const initial = await state(page);
  const results = page.locator('#desktop-panel-explore [class*="resultList"]');
  await results.evaluate((node) => { node.scrollTop = 350; });
  const scrollTop = await results.evaluate((node) => node.scrollTop);
  await page.getByRole("tab", { name: "探索", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#desktop-tab-plan").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await results.evaluate((node) => node.scrollTop), scrollTop, "explore scroll survives tab switch");
  const source = results.locator('button[class*="resultMain"]').filter({ hasText: /^A01/ }).first();
  await source.click();
  await pause(page);
  const selectedUrl = page.url();
  const selectedView = await state(page);
  await detail(page).getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).click();
  await pause(page);
  assert.equal(page.url(), selectedUrl);
  assert.equal(await detail(page).count(), 0);
  assert.deepEqual((await state(page)).offset, selectedView.offset);
  assert.equal(await source.evaluate((node) => node === document.activeElement), true);
  await source.click();
  await detail(page).getByRole("button", { name: "加入今日行程", exact: true }).click();
  await pause(page);
  const planning = await page.evaluate(() => localStorage.getItem("event-map-planning-v1"));
  await page.getByRole("button", { name: "查看全場", exact: true }).click();
  await pause(page);
  assert.equal(page.url(), selectedUrl);
  assert.equal(await page.evaluate(() => localStorage.getItem("event-map-planning-v1")), planning);
  assert.equal((await state(page)).zoom, initial.zoom);
  assertFit(await state(page));
  await source.click();
  await pause(page);
  await detail(page).getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await detail(page).count(), 0);
  await page.getByRole("tab", { name: "行程 1", exact: true }).click();
  await page.getByRole("button", { name: "開始導航", exact: true }).click();
  await page.getByRole("tab", { name: "探索", exact: true }).click();
  assert.equal(await page.locator(".controls").getByRole("button", { name: "退出導航模式", exact: true }).count(), 1);
  await page.getByRole("textbox", { name: "搜尋社團、攤位或作品" }).fill("Origin");
  assert.equal(await page.locator(".controls").getByRole("button", { name: "退出導航模式", exact: true }).count(), 0);
  assert.equal(await page.locator("#desktop-tab-explore").getAttribute("aria-selected"), "true");
  await page.getByRole("textbox", { name: "搜尋社團、攤位或作品" }).fill("");
  await page.getByRole("button", { name: "查看全場", exact: true }).click();
  await page.getByRole("button", { name: "放大地圖", exact: true }).click();
  await page.getByRole("button", { name: "放大地圖", exact: true }).click();
  const manual = await state(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await pause(page);
  const resized = await state(page);
  for (const axis of ["x", "y"]) {
    const dimension = axis === "x" ? "width" : "height";
    const before = (manual.map[dimension] / 2 - manual.inset[axis] - manual.offset[axis]) / manual.zoom;
    const after = (resized.map[dimension] / 2 - resized.inset[axis] - resized.offset[axis]) / resized.zoom;
    assert.ok(Math.abs(before - after) < .01, "resize preserves manual center");
  }
  report.cases.push({ name: "state-and-resize", passed: true });
  await page.close();

  // Catalog arrival must not undo a gesture made while a shared URL resolves.
  for (const manualGesture of [false, true]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const delayed = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    delayed.setDefaultTimeout(10000);
    delayed.on("pageerror", (error) => report.errors.push(error.message));
    await delayed.route("**/circles.json", async (route) => { await gate; await route.continue(); });
    await delayed.goto(selectedUrl);
    await delayed.locator(".floor").waitFor();
    await pause(delayed);
    if (manualGesture) {
      const bounds = await delayed.locator(".map").boundingBox();
      await delayed.mouse.move(bounds.x + 400, bounds.y + 350);
      await delayed.mouse.down();
      await delayed.mouse.move(bounds.x + 470, bounds.y + 400, { steps: 5 });
      await delayed.mouse.up();
      await pause(delayed);
    }
    const before = await state(delayed);
    release();
    await detail(delayed).waitFor();
    await pause(delayed);
    const after = await state(delayed);
    assert.equal(after.zoom, before.zoom, "late URL selection retains current zoom");
    if (manualGesture) assert.deepEqual(after.offset, before.offset, "late URL selection cannot undo manual pan");
    else assertPosition(after);
    report.cases.push({ name: `late-url-manual-${manualGesture}`, passed: true });
    await delayed.close();
  }

  // Selecting a result while map geometry is pending is also a deferred request.
  let releaseMap;
  const mapGate = new Promise((resolve) => { releaseMap = resolve; });
  const loadingMap = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  loadingMap.setDefaultTimeout(10000);
  await loadingMap.route("**/map.json", async (route) => { await mapGate; await route.continue(); });
  await loadingMap.goto(`${base}/?event=ff47`);
  await loadingMap.getByRole("button", { name: "A01 OriginZero", exact: true }).click();
  releaseMap();
  await loadingMap.locator(".floor").waitFor();
  await pause(loadingMap);
  assertPosition(await state(loadingMap));
  report.cases.push({ name: "selection-before-map", passed: true });
  await loadingMap.close();

  const keyboard = await open();
  await keyboard.getByRole("button", { name: "A01 OriginZero", exact: true }).click();
  await pause(keyboard);
  await keyboard.locator('[data-slot-code="A01"]').focus();
  await keyboard.keyboard.press("ArrowLeft");
  await pause(keyboard);
  const focused = (await state(keyboard)).activeSlot;
  assert.ok(focused && focused !== "A01");
  assert.equal(await keyboard.locator('[data-map-tools]:not([aria-hidden])').getByText(`已選取 ${focused}`, { exact: true }).count(), 1);
  assert.equal(await keyboard.locator('.floor [tabindex="0"]').count(), 1);
  await keyboard.keyboard.press("Enter");
  await pause(keyboard);
  assert.equal((await state(keyboard)).activeSlot, focused, "Enter retains SVG roving focus after foreground move");
  await detail(keyboard).getByRole("button", { name: "開啟完整詳細資訊", exact: true }).click();
  assert.equal(await keyboard.getByRole("dialog").count(), 1);
  assert.equal(await keyboard.getByRole("dialog").evaluate((node) => node.parentElement.parentElement === document.body), true);
  await keyboard.keyboard.press("Escape");
  assert.equal(await keyboard.getByRole("dialog").count(), 0);
  assert.equal(await detail(keyboard).count(), 1, "Escape closes top dialog alone");
  await keyboard.getByRole("textbox", { name: "搜尋社團、攤位或作品" }).fill("no-such-circle-xyz");
  await detail(keyboard).getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).click();
  await pause(keyboard);
  assert.ok((await state(keyboard)).activeSlot || await keyboard.locator("#desktop-tab-explore").evaluate((node) => node === document.activeElement));
  report.cases.push({ name: "keyboard-focus-and-dialog", passed: true });
  await keyboard.close();

  const history = await open();
  await history.getByRole("button", { name: "放大地圖", exact: true }).click();
  await history.getByRole("button", { name: "A01 OriginZero", exact: true }).click();
  await pause(history);
  const beforeDay = await state(history);
  await history.getByRole("tab", { name: /^DAY 2/ }).click();
  await history.locator(".floor").waitFor();
  await pause(history);
  const afterDay = await state(history);
  assert.equal(afterDay.zoom, beforeDay.zoom, "shared map day switch preserves zoom");
  assert.deepEqual(afterDay.offset, beforeDay.offset, "shared map day switch preserves position");
  assert.equal(await detail(history).count(), 0);
  await history.goBack();
  await detail(history).waitFor();
  await pause(history);
  assert.equal((await state(history)).zoom, beforeDay.zoom, "history restore does not refit");
  assertPosition(await state(history));
  await history.goForward();
  await history.locator(".floor").waitFor();
  await pause(history);
  assert.equal(await detail(history).count(), 0);
  report.cases.push({ name: "shared-day-and-history", passed: true });
  await history.close();

  const [eventData, mapData, catalogData] = await Promise.all(["event.json", "map.json", "circles.json"].map(async (file) => (await fetch(`${base}/data/events/ff47/${file}`)).json()));
  const venueSpaceId = eventData.venueAssignments[0].venueSpaceId;
  const manifest = { schema: "event-map-manifest/1", eventId: "ff47", maps: eventData.days.map((day) => ({ periodKey: String(day.id), venueSpaceId, path: `maps/${day.id}/${venueSpaceId}.json` })) };
  const scoped = await open(1440, 900, "standard", async (scopedPage) => {
    await scopedPage.route("**/map-manifest.json", (route) => route.fulfill({ json: manifest }));
    await scopedPage.route("**/maps/*/*.json", (route) => {
      const map = structuredClone(mapData);
      if (route.request().url().includes("/maps/2/")) map.layout.width *= 2;
      return route.fulfill({ json: map });
    });
  });
  await scoped.getByRole("button", { name: "放大地圖", exact: true }).click();
  const previousScope = await state(scoped);
  await scoped.getByRole("tab", { name: /^DAY 2/ }).click();
  await scoped.locator(`.floor svg[viewBox="0 0 ${mapData.layout.width * 2} ${mapData.layout.height}"]`).waitFor();
  await pause(scoped);
  const nextScope = await state(scoped);
  assert.ok(nextScope.zoom < previousScope.zoom, "different artifact initializes independently even at equal revisions");
  assertFit(nextScope);
  let releaseOldMap;
  const oldMapGate = new Promise((resolve) => { releaseOldMap = resolve; });
  await scoped.route("**/maps/1/*.json", async (route) => { await oldMapGate; await route.fulfill({ json: mapData }); });
  await scoped.getByRole("tab", { name: /^DAY 1/ }).click();
  await scoped.getByRole("tab", { name: /^DAY 3/ }).click();
  await scoped.locator(".floor").waitFor();
  await pause(scoped);
  const thirdScope = await state(scoped);
  releaseOldMap();
  await pause(scoped);
  assert.equal(new URL(scoped.url()).searchParams.get("day"), "3");
  assert.deepEqual((await state(scoped)).offset, thirdScope.offset, "stale scoped response cannot reposition current map");
  await scoped.close();
  report.cases.push({ name: "synthetic-scoped-map-and-stale-response", passed: true });

  const zero = await open();
  const beforeZero = await state(zero);
  await zero.locator(".map").evaluate((node) => { node.style.width = "0px"; });
  await zero.getByRole("button", { name: "A01 OriginZero", exact: true }).click();
  await zero.getByRole("button", { name: "A03 MAI", exact: true }).click();
  await pause(zero);
  assert.deepEqual((await state(zero)).offset, beforeZero.offset, "zero geometry defers positioning");
  await zero.locator(".map").evaluate((node) => { node.style.width = ""; });
  await pause(zero);
  assert.equal(new URL(zero.url()).searchParams.get("selectedBooth"), "A03");
  assertPosition(await state(zero));
  await zero.close();
  report.cases.push({ name: "zero-geometry-last-selection", passed: true });

  const failure = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  failure.setDefaultTimeout(10000);
  let fail = true;
  await failure.route("**/map.json", (route) => fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  await failure.goto(`${base}/?event=ff47`);
  await failure.getByRole("button", { name: "重新讀取地圖", exact: true }).waitFor();
  assert.equal(await failure.locator(".floor").count(), 0);
  await failure.screenshot({ path: path.join(output, "synthetic-map-error.png") });
  fail = false;
  await failure.getByRole("button", { name: "重新讀取地圖", exact: true }).click();
  await failure.locator(".floor").waitFor();
  await pause(failure);
  assertFit(await state(failure));
  await failure.close();
  report.cases.push({ name: "map-error-and-retry", passed: true });

  const dayOne = [...new Set(catalogData.placements.filter((item) => String(item.day) === "1").map((item) => item.circleId))].slice(0, 60);
  assert.equal(dayOne.length, 60);
  const longPlanning = { schemaVersion: 3, favoriteGroups: [], favorites: [], visitPlans: dayOne.map((circleId, index) => ({ eventId: "ff47", day: 1, circleId, status: index === 0 ? "next" : "planned", routeOrder: index, purchaseMemo: "驗收購買項目", budget: 300, updatedAt: "2026-09-09T00:00:00.000Z" })) };
  const long = await open(761, 768, "extra", async (longPage) => {
    await longPage.addInitScript((document) => localStorage.setItem("event-map-planning-v1", JSON.stringify(document)), longPlanning);
    await longPage.route("**/circles.json", (route) => {
      const catalog = structuredClone(catalogData);
      catalog.circles.find((circle) => circle.id === dayOne[0]).name = "用於驗收長社團名稱的文字與購買資訊".repeat(6);
      return route.fulfill({ json: catalog });
    });
  });
  await long.getByRole("tab", { name: "行程 60", exact: true }).click();
  const itinerary = long.locator("#desktop-panel-plan ol");
  assert.equal(await itinerary.evaluate((node) => node.scrollHeight > node.clientHeight), true);
  await itinerary.evaluate((node) => { node.scrollTop = 550; });
  const planScroll = await itinerary.evaluate((node) => node.scrollTop);
  await long.getByRole("tab", { name: "探索", exact: true }).click();
  await long.getByRole("tab", { name: "行程 60", exact: true }).click();
  assert.equal(await itinerary.evaluate((node) => node.scrollTop), planScroll);
  await itinerary.locator('button[class*="planMain"]').first().click();
  await pause(long);
  await capture(long, "synthetic-long-plan-name-761-extra");
  await long.close();
  report.cases.push({ name: "synthetic-long-plan-scroll", passed: true });

  const storage = await open(761, 768, "extra", async (storagePage) => {
    await storagePage.addInitScript(() => localStorage.setItem("event-map-planning-v1", '{"schemaVersion":999}'));
  });
  assert.equal(await storage.getByText("儲存異常，請開啟資料管理", { exact: true }).filter({ visible: true }).count(), 1);
  await capture(storage, "synthetic-storage-error-761-extra");
  await storage.getByRole("button", { name: "資料管理", exact: true }).click();
  assert.equal(await storage.getByRole("dialog").count(), 1);
  await storage.close();
  report.cases.push({ name: "synthetic-storage-error", passed: true });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, process.env.MAP_TEST_SKIP_MATRIX ? "browser-state-report.json" : "browser-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`Passed ${report.cases.length} browser captures/checks. Report: ${output}`);
