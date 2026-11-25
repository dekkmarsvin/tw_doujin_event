// staged-data: multi
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;
const base = process.env.MAP_TEST_URL || "http://127.0.0.1:5173";
const output = path.resolve(process.env.MAP_TEST_OUTPUT || "outputs/reader-venue-overview");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const pause = (page, ms = 180) => page.waitForTimeout(ms);

try {
  // 1. Desktop 900x768 (narrow desktop with detail rail open, wheel momentum vs paused scroll, keyboard switch & Back)
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 768 }, reducedMotion: "reduce", locale: "zh-TW" });
    await page.goto(`${base}/?event=sample-multi`);
    await page.locator('[data-slot-code="A01"]').waitFor();
    await page.locator('button:has-text("設施")').waitFor();
    await pause(page);

    // Select booth A01 to open details rail.
    await page.locator('[data-slot-code="A01"]').click();
    const detail = page.locator('aside[aria-label="已選社團詳情"]');
    await detail.waitFor();
    const selectedUrl = page.url();
    assert.ok(selectedUrl.includes("selectedCircle="), "selecting A01 records selectedCircle in URL");

    // Zoom in twice so wheel zoom-out starts above minimum.
    await page.locator('button[aria-label="放大地圖"]').click();
    await page.locator('button[aria-label="放大地圖"]').click();
    await pause(page, 120);

    // Continuous momentum burst out past minimum should stop at indoor fit and NOT open overview.
    const mapBox = await page.locator(".map").boundingBox();
    const wheelPoint = { clientX: mapBox.x + mapBox.width * 0.35, clientY: mapBox.y + mapBox.height * 0.55 };
    for (let i = 0; i < 12; i += 1) {
      await page.evaluate(({ clientX, clientY }) => {
        document.querySelector(".map").dispatchEvent(new WheelEvent("wheel", { deltaY: 160, clientX, clientY, bubbles: true, cancelable: true }));
      }, wheelPoint);
      await pause(page, 40);
    }
    assert.equal(await page.locator('[data-venue-overview="sample-campus"]').count(), 0, "momentum burst stops at indoor fit");

    // Pause > 280ms, then start a fresh wheel zoom-out gesture to enter overview.
    await pause(page, 340);
    await page.evaluate(({ clientX, clientY }) => {
      document.querySelector(".map").dispatchEvent(new WheelEvent("wheel", { deltaY: 150, clientX, clientY, bubbles: true, cancelable: true }));
    }, wheelPoint);
    const overview = page.locator('[data-venue-overview="sample-campus"]');
    await overview.waitFor();

    const overviewBox = await overview.boundingBox();
    const detailBox = await detail.boundingBox();
    assert.ok(overviewBox.x + overviewBox.width <= detailBox.x + 1, "overview clears open desktop detail rail");
    assert.equal(await page.locator('button:has-text("設施")').count(), 0, "facility trigger hidden while overview is open");

    // Wheel-up while focus is inside overview closes overview and restores focus to overview trigger.
    await pause(page, 60);
    await page.evaluate(({ clientX, clientY }) => {
      document.querySelector(".map").dispatchEvent(new WheelEvent("wheel", { deltaY: -150, clientX, clientY, bubbles: true, cancelable: true }));
    }, wheelPoint);
    await pause(page, 120);
    assert.equal(await overview.count(), 0, "wheel-up closes overview");
    const afterWheelOverviewFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assert.equal(afterWheelOverviewFocus, "園區總覽", "wheel exit from overview focus returns focus to overview trigger");

    // Re-enter overview, move focus into detail rail, then wheel-up -> focus stays inside detail rail.
    await page.locator('button[aria-label="園區總覽"]').click();
    await overview.waitFor();
    await detail.locator("button").first().focus();
    await page.evaluate(({ clientX, clientY }) => {
      document.querySelector(".map").dispatchEvent(new WheelEvent("wheel", { deltaY: -150, clientX, clientY, bubbles: true, cancelable: true }));
    }, wheelPoint);
    await pause(page, 120);
    assert.equal(await overview.count(), 0, "wheel-up from detail focus closes overview");
    assert.equal(
      await page.evaluate(() => Boolean(document.querySelector('aside[aria-label="已選社團詳情"]')?.contains(document.activeElement))),
      true,
      "wheel exit preserves focus when reader moved focus to detail rail",
    );

    // Re-enter overview, move keyboard focus inside detail rail, press Escape -> closes overview WITHOUT clearing selection.
    await page.locator('button[aria-label="園區總覽"]').click();
    await overview.waitFor();
    await detail.locator("button").first().focus();
    await page.keyboard.press("Escape");
    await pause(page, 120);
    assert.equal(await overview.count(), 0, "Escape from detail rail closes overview");
    assert.equal(await detail.isVisible(), true, "Escape while overview open keeps selected circle detail");
    assert.equal(page.url(), selectedUrl, "Escape closing overview preserves selected URL");
    const afterEscFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assert.equal(afterEscFocus, "園區總覽", "focus returns to visible zoom-out/overview trigger");

    // Re-enter overview, switch space via keyboard Enter, assert focus moves to enabled visible control.
    await page.locator('button[aria-label="園區總覽"]').click();
    await overview.waitFor();
    const hallB = page.locator('[data-overview-venue-space="hall-b"]');
    await hallB.focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-slot-code="B01"]').waitFor();
    await pause(page, 120);
    assert.equal(await overview.count(), 0, "Enter on hall-b closes overview");
    assert.equal(await page.locator("select").last().inputValue(), "hall-b");
    const afterSwitchFocus = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, disabled: Boolean(el.disabled), visible: el.getClientRects().length > 0 } : null;
    });
    assert.equal(afterSwitchFocus?.visible, true, "focus lands on visible control after keyboard space switch");
    assert.equal(afterSwitchFocus?.disabled, false, "focus target is enabled");

    // Browser Back restores hall-a + selected circle and keeps overview closed.
    await page.goBack();
    await page.locator('[data-slot-code="A01"]').waitFor();
    await pause(page, 150);
    assert.equal(await overview.count(), 0, "Back closes overview");
    assert.equal(await detail.isVisible(), true, "Back restores original circle selection");
    await page.close();
  }

  // 2. Mobile 390x844 (pan at fit + button enter/exit centered above half sheet + unassigned inert + full dock Escape + pinch enter)
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce", locale: "zh-TW" });
    await page.goto(`${base}/?event=sample-multi`);
    await page.locator('[data-slot-code="A01"]').waitFor();
    await pause(page);

    // Select A01 -> half sheet + mobile booth marker + facility button visible.
    await page.locator('[data-slot-code="A01"]').click();
    await pause(page, 150);
    const marker = page.locator('[class*="mobileMapSelection"]');
    const facilityBtn = page.locator('button:has-text("設施")');
    assert.equal(await marker.isVisible(), true, "mobile booth marker visible indoors");
    assert.equal(await facilityBtn.isVisible(), true, "facility button visible indoors");

    // Capture indoor fit zoom, then pan the floor at minimum zoom.
    const fitState = await page.evaluate(() => {
      const floor = document.querySelector(".floor");
      const transform = new DOMMatrix(getComputedStyle(floor).transform);
      return { zoom: transform.a, offsetX: transform.e, offsetY: transform.f };
    });
    const mapBox = await page.locator(".map").boundingBox();
    const panX = mapBox.x + mapBox.width * 0.4;
    const panY = mapBox.y + mapBox.height * 0.25;
    await page.mouse.move(panX, panY);
    await page.mouse.down();
    await page.mouse.move(panX + 120, panY + 90, { steps: 4 });
    await page.mouse.up();
    await pause(page, 120);

    // Enter overview via button at minimum zoom.
    await page.locator('button[aria-label="園區總覽"]').click();
    const overview = page.locator('[data-venue-overview="sample-campus"]');
    await overview.waitFor();
    assert.equal(await marker.count(), 0, "mobile booth marker hidden in overview");
    assert.equal(await facilityBtn.count(), 0, "facility button hidden in overview");

    // Unassigned warehouse has no button role/tabindex and clicking it is a no-op.
    const unassigned = page.locator('[data-overview-building="building-unassigned"]');
    assert.equal(await unassigned.getAttribute("role"), null);
    assert.equal(await unassigned.getAttribute("tabindex"), null);
    const unassignedBox = await unassigned.boundingBox();
    await page.mouse.click(unassignedBox.x + unassignedBox.width / 2, unassignedBox.y + unassignedBox.height / 2);
    await pause(page, 100);
    assert.equal(await overview.isVisible(), true, "clicking unassigned building leaves overview open");

    // Exit overview via + button -> indoor floor returns cleanly centered in visible rect above half dock.
    await page.locator('button[aria-label="返回場地地圖"]').click();
    await pause(page, 180);
    assert.equal(await overview.count(), 0, "+ exits overview");
    const exitMetrics = await page.evaluate(() => {
      const floor = document.querySelector(".floor").getBoundingClientRect();
      const transform = new DOMMatrix(getComputedStyle(document.querySelector(".floor")).transform);
      const map = document.querySelector(".map").getBoundingClientRect();
      const tools = document.querySelector("[data-map-tools]").getBoundingClientRect();
      const dock = document.querySelector('aside[aria-label="行動版工作面板"]').getBoundingClientRect();
      const controls = document.querySelector(".controls").getBoundingClientRect();
      const visibleLeft = map.left + 16;
      const visibleRight = Math.min(map.right - 16, controls.left - 12);
      const visibleTop = tools.bottom + 16;
      const visibleBottom = dock.top - 16;
      return {
        zoom: transform.a,
        sheetLevel: document.querySelector(".app-shell").getAttribute("data-mobile-sheet-level"),
        floorCenterX: floor.left + floor.width / 2,
        floorCenterY: floor.top + floor.height / 2,
        visibleCenterX: (visibleLeft + visibleRight) / 2,
        visibleCenterY: (visibleTop + visibleBottom) / 2,
      };
    });
    assert.ok(Math.abs(exitMetrics.zoom - fitState.zoom) < 0.005, "exit preserves fit zoom");
    assert.equal(exitMetrics.sheetLevel, "half", "exit preserves half sheet level");
    assert.ok(Math.abs(exitMetrics.floorCenterX - exitMetrics.visibleCenterX) < 2, "indoor floor centered horizontally above half sheet");
    assert.ok(Math.abs(exitMetrics.floorCenterY - exitMetrics.visibleCenterY) < 2, "indoor floor centered vertically above half sheet");

    // Enter overview, expand dock to full via keyboard ArrowUp on handle, then press Escape -> focus falls back to visible handle.
    await page.locator('button[aria-label="園區總覽"]').click();
    await overview.waitFor();
    const handle = page.locator('aside[aria-label="行動版工作面板"] > button').first();
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await pause(page, 120);
    assert.equal(await page.locator(".app-shell").getAttribute("data-mobile-sheet-level"), "full");
    await page.keyboard.press("Escape");
    await pause(page, 120);
    assert.equal(await overview.count(), 0, "Escape closes overview even when dock is full");
    const fullEscFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    assert.ok(fullEscFocus.includes("工作面板"), "focus returns to visible mobile sheet handle when controls are hidden");

    // Collapse sheet back to peek, then verify two-finger pinch zoom-out from fit enters overview and stays stable after pointerup.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await pause(page, 150);
    const pinchArea = await page.evaluate(() => {
      const map = document.querySelector(".map").getBoundingClientRect();
      const tools = document.querySelector("[data-map-tools]").getBoundingClientRect();
      return {
        y: Math.round(tools.bottom + 24),
        x1: Math.round(map.left + 40),
        x2: Math.round(map.left + 260),
      };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: pinchArea.x1, y: pinchArea.y, id: 1 },
        { x: pinchArea.x2, y: pinchArea.y, id: 2 },
      ],
    });
    await pause(page, 40);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: pinchArea.x1 + 35, y: pinchArea.y, id: 1 },
        { x: pinchArea.x2 - 35, y: pinchArea.y, id: 2 },
      ],
    });
    await pause(page, 40);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: pinchArea.x1 + 65, y: pinchArea.y, id: 1 },
        { x: pinchArea.x2 - 65, y: pinchArea.y, id: 2 },
      ],
    });
    await pause(page, 60);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await overview.waitFor();
    await pause(page, 150);
    assert.equal(await overview.isVisible(), true, "two-finger pinch from fit enters overview and stays stable after pointerup");

    // Raise mobile sheet from peek to half while overview is open, then press Escape -> indoor floor recenters above half dock.
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await pause(page, 120);
    assert.equal(await page.locator(".app-shell").getAttribute("data-mobile-sheet-level"), "half");
    await page.keyboard.press("Escape");
    await pause(page, 150);
    assert.equal(await overview.count(), 0, "Escape after sheet change exits overview");
    const recenterMetrics = await page.evaluate(() => {
      const floor = document.querySelector(".floor").getBoundingClientRect();
      const map = document.querySelector(".map").getBoundingClientRect();
      const tools = document.querySelector("[data-map-tools]").getBoundingClientRect();
      const dock = document.querySelector('aside[aria-label="行動版工作面板"]').getBoundingClientRect();
      const controls = document.querySelector(".controls").getBoundingClientRect();
      const visibleLeft = map.left + 16;
      const visibleRight = Math.min(map.right - 16, controls.left - 12);
      const visibleTop = tools.bottom + 16;
      const visibleBottom = dock.top - 16;
      return {
        sheetLevel: document.querySelector(".app-shell").getAttribute("data-mobile-sheet-level"),
        floorCenterX: floor.left + floor.width / 2,
        floorCenterY: floor.top + floor.height / 2,
        visibleCenterX: (visibleLeft + visibleRight) / 2,
        visibleCenterY: (visibleTop + visibleBottom) / 2,
      };
    });
    assert.equal(recenterMetrics.sheetLevel, "half");
    assert.ok(Math.abs(recenterMetrics.floorCenterX - recenterMetrics.visibleCenterX) < 2, "exit after sheet raise centers horizontally");
    assert.ok(Math.abs(recenterMetrics.floorCenterY - recenterMetrics.visibleCenterY) < 2, "exit after sheet raise centers vertically");
    await page.close();
  }
} finally {
  await browser.close();
}
