// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";
const journey = await start("map-authoring-workspace");
try {
  for (const surface of ["organizer", "circle"]) {
    const initial = { ...structuredClone(source), width: 1200, height: 900, floor: { x: 0, y: 0, width: 1200, height: 900 }, pillars: [], landmarks: [], accessPoints: [], rows: [{ label: "A", orientation: "vertical", confidence: 1, slots: Array.from({ length: 16 }, (_, i) => ({ code: `A${String(i + 1).padStart(2, "0")}`, rect: { x: i < 8 ? 240 : 180, y: 200 + (i < 8 ? 7 - i : i - 8) * 55, width: 60, height: 55 } })) }] };
    const { page, editor, state } = await openSurface(journey, surface, initial, { failSaves: 1 });
    await page.setViewportSize({ width: 1440, height: 1024 });
    const picker = editor.getByRole("combobox", { name: "選取地圖元素" });
    const svg = editor.locator("svg[tabindex='0']");
    const count = () => svg.locator("[data-slot-code]").count();
    const expand = page.getByRole("button", { name: "展開全視窗", exact: true });
    await expand.click();
    assert.equal(await page.locator("dialog:modal").count(), 1);
    await editor.getByRole("button", { name: "放大編輯地圖" }).click();
    await editor.getByRole("button", { name: "放大編輯地圖" }).click();
    await picker.selectOption("slot:0:0");
    const center = () => editor.locator("#map-layout-editor-canvas").evaluate(node => {
      const svg = node.querySelector("svg").getBoundingClientRect(), box = node.getBoundingClientRect(), css = getComputedStyle(node);
      const l = parseFloat(css.paddingLeft), r = parseFloat(css.paddingRight), t = parseFloat(css.paddingTop), b = parseFloat(css.paddingBottom);
      return { x: (box.left + l + (node.clientWidth - l - r) / 2 - svg.left) / svg.width, y: (box.top + t + (node.clientHeight - t - b) / 2 - svg.top) / svg.height };
    });
    // Interior scroll position avoids the intentional clamping at map edges.
    await editor.locator("#map-layout-editor-canvas").evaluate(node => { node.scrollLeft = 250; node.scrollTop = 250; });
    const clipping = await editor.locator("#map-layout-editor-canvas").evaluate(node => {
      const bounds = node.getBoundingClientRect(), inspector = node.closest("section").querySelector("aside[aria-label=\"選取元素屬性\"]").getBoundingClientRect();
      return { canvasRight: bounds.right, panelLeft: inspector.left, overflow: getComputedStyle(node).overflowX };
    });
    assert.ok(clipping.canvasRight <= clipping.panelLeft && ["auto", "scroll", "hidden"].includes(clipping.overflow), "zoomed content is clipped before the inspector");
    const before = await center();
    await page.getByRole("button", { name: "返回地圖步驟", exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector("dialog:not(:modal)"));
    await expand.click();
    await page.waitForFunction(() => !!document.querySelector("dialog:modal"));
    // Wait for the observer's fitted size and the two animation-frame restoration.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const after = await center();
    assert.ok(Math.abs(before.x - after.x) < .015 && Math.abs(before.y - after.y) < .015, `view center preserved: ${JSON.stringify({ before, after })}`);
    assert.match(await svg.getAttribute("aria-label"), /200%/);
    assert.equal(await picker.inputValue(), "slot:0:0");
    await editor.getByRole("button", { name: "重設編輯地圖倍率" }).click();
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    await editor.getByRole("button", { name: "選取 A 排", exact: true }).click();
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    await editor.getByRole("button", { name: "複製多排", exact: true }).click();
    await editor.getByRole("spinbutton", { name: "邊緣間距", exact: true }).fill("48");
    assert.equal(await count(), 16, "preview is not committed");
    assert.equal(await editor.locator("[data-row-copy-preview] rect").count(), 48);
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true);
    await journey.capture(page, `${surface}-fullscreen-copy-preview`);
    await editor.getByRole("button", { name: "加入 3 排", exact: true }).click();
    assert.equal(await count(), 64);
    await page.getByRole("button", { name: "返回地圖步驟", exact: true }).click();
    assert.equal(await page.locator("dialog:modal").count(), 0);
    assert.equal(await expand.evaluate(node => node === document.activeElement), true);
    assert.equal(await count(), 64);
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    assert.equal(await count(), 16, "one undo removes all three rows after collapse");
    await editor.getByRole("button", { name: "重做已復原的編輯" }).click();
    await expand.click();
    const save = page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true });
    await save.click();
    await save.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("dialog")?.textContent.includes("儲存中") === false && document.querySelector("[inert]") === null);
    assert.equal(state.saves, 0);
    assert.equal(await count(), 64, "failed save keeps all edits and full-window state");
    assert.equal(await page.locator("dialog:modal").count(), 1);
    await save.click();
    await page.waitForFunction(() => document.querySelector("dialog")?.textContent.includes("目前沒有未儲存") || document.querySelector("dialog")?.textContent.includes("地圖已儲存"));
    assert.equal(state.saves, 1);
    assert.deepEqual(state.layout.rows.map(row => row.label), ["A", "B", "C", "D"]);
    await picker.selectOption("slot:0:0");
    await editor.getByRole("button", { name: "複製多排", exact: true }).click();
    assert.equal(await editor.getByRole("button", { name: "加入 3 排", exact: true }).isDisabled(), true, "duplicate labels cannot apply");
    await page.getByRole("button", { name: "返回地圖步驟", exact: true }).press("Escape");
    assert.equal(await editor.getByRole("region", { name: "複製多排預覽" }).count(), 0);
    assert.equal(await page.locator("dialog:modal").count(), 1, "first Escape cancels the inner preview");
    await svg.press("Escape");
    assert.equal(await page.locator("dialog:modal").count(), 0, "next Escape returns to the map step");
    if (surface === "organizer") {
      await picker.selectOption("slot:0:0");
      await svg.press("ArrowRight");
      await page.getByRole("button", { name: "關閉編輯器", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "尚有未儲存變更", exact: true });
      await confirm.waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await count(), 64, "cancel leaving preserves the dirty draft");
    }
    journey.report.checks.push(`${surface}: full-window, atomic copies, undo/redo across collapse, save failure/retry and Escape`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); throw error; }
