// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";
// Keep classic scrollbars enabled to exercise their effect on fitted sizes.
const journey = await start("map-authoring-workspace", { showScrollbars: true });
try {
  for (const surface of ["organizer", "circle"]) {
    const initial = { ...structuredClone(source), width: 1200, height: 900, floor: { x: 0, y: 0, width: 1200, height: 900 }, pillars: [], landmarks: [], accessPoints: [], rows: [{ label: "A", orientation: "vertical", confidence: 1, slots: Array.from({ length: 16 }, (_, i) => ({ code: `A${String(i + 1).padStart(2, "0")}`, rect: { x: i < 8 ? 240 : 180, y: 200 + (i < 8 ? 7 - i : i - 8) * 55, width: 60, height: 55 } })) }] };
    const { page, editor, state } = await openSurface(journey, surface, initial, { failSaves: 1 });
    // A narrow inline editor points to full window; a wide one stays quiet. The Organizer editor sits between
    // workspace sidebars and is narrow on a laptop; the circle page caps its width, so it narrows later.
    const hint = page.getByText("畫布較小，建議展開全視窗。", { exact: true });
    await page.setViewportSize({ width: 1920, height: 1024 });
    assert.equal(await hint.isVisible(), false);
    await page.setViewportSize({ width: surface === "organizer" ? 1440 : 900, height: 1024 });
    assert.equal(await hint.isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 1024 });
    const picker = editor.getByRole("combobox", { name: "選取地圖元素" });
    const svg = editor.locator("svg[tabindex='0']");
    const count = () => svg.locator("[data-slot-code]").count();
    const expand = page.getByRole("button", { name: "展開全視窗", exact: true });
    await expand.click();
    assert.equal(await page.locator("dialog:modal").count(), 1);
    assert.equal(await hint.count(), 0, "full window needs no hint");
    // Keyboard order follows the screen: tool rail, booth list, then the canvas before the bars drawn beneath it.
    await picker.focus();
    await page.keyboard.press("Tab");
    assert.equal(await editor.getByRole("button", { name: "攤位清單", exact: true }).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await svg.evaluate(node => node === document.activeElement), true);
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
    const viewport = editor.locator("#map-layout-editor-canvas");
    const mapSize = () => svg.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    const sizeBeforePanels = await mapSize();
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    for (const name of ["攤位與排清單", "選取元素屬性"]) {
      const panel = editor.getByRole("complementary", { name, exact: true });
      const overlay = await panel.evaluate(node => {
        const panel = node.getBoundingClientRect(), canvas = node.parentElement.querySelector("#map-layout-editor-canvas").getBoundingClientRect();
        return { inside: panel.left >= canvas.left && panel.right <= canvas.right, onTop: node.contains(document.elementFromPoint(panel.left + panel.width / 2, panel.top + panel.height / 2)) };
      });
      assert.ok(overlay.inside && overlay.onTop, `${name} floats above the full-width canvas and receives pointer input`);
    }
    assert.deepEqual(await mapSize(), sizeBeforePanels, "opening the roster does not resize the map");
    await journey.capture(page, `${surface}-floating-map-panels`);
    const canvasBox = await viewport.boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    const geometryBeforeWheel = await svg.locator("[data-slot-code] rect").evaluateAll(nodes => nodes.map(node => ["x", "y", "width", "height"].map(name => node.getAttribute(name))));
    const pageScroll = await page.evaluate(() => scrollY), beforeWheelCenter = await center();
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => document.querySelector('svg[aria-label*="向量地圖"]')?.getAttribute("aria-label")?.endsWith("250%"));
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('svg[aria-label*="向量地圖"]')?.getAttribute("aria-label")?.endsWith("200%"));
    const afterWheelCenter = await center();
    assert.ok(Math.abs(beforeWheelCenter.x - afterWheelCenter.x) < .015 && Math.abs(beforeWheelCenter.y - afterWheelCenter.y) < .015, "successive wheel zooms preserve the viewed map point");
    assert.equal(await page.evaluate(() => scrollY), pageScroll, "canvas wheel zoom does not scroll the page");
    assert.deepEqual(await svg.locator("[data-slot-code] rect").evaluateAll(nodes => nodes.map(node => ["x", "y", "width", "height"].map(name => node.getAttribute(name)))), geometryBeforeWheel, "wheel zoom never edits booth geometry");
    const roster = editor.getByRole("complementary", { name: "攤位與排清單", exact: true });
    if (await roster.getByRole("combobox", { name: /^對照顯示/ }).count()) {
      await roster.getByRole("combobox", { name: /^對照顯示/ }).selectOption("unknown");
      const rosterBox = await roster.boundingBox();
      await page.mouse.move(rosterBox.x + rosterBox.width / 2, rosterBox.y + rosterBox.height / 2);
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(() => document.querySelector('aside[aria-label="攤位與排清單"]')?.scrollTop > 0);
    }
    assert.match(await svg.getAttribute("aria-label"), /200%/, "wheel in the roster scrolls the panel without zooming");
    const inspectorBox = await editor.getByRole("complementary", { name: "選取元素屬性", exact: true }).boundingBox();
    await page.mouse.move(inspectorBox.x + inspectorBox.width / 2, inspectorBox.y + inspectorBox.height / 2);
    await page.mouse.wheel(0, 120);
    assert.match(await svg.getAttribute("aria-label"), /200%/, "wheel in the inspector does not zoom the map");
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    assert.deepEqual(await mapSize(), sizeBeforePanels, "closing the roster does not resize the map");
    journey.report.checks.push(`${surface}: floating panels, canvas wheel zoom and independent panel scrolling`);
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
    const slotsBefore = await svg.locator("[data-slot-code]").evaluateAll(nodes => nodes.map(node => [node.dataset.slotCode, ...["x", "y", "width", "height"].map(name => node.querySelector("rect").getAttribute(name))]));
    const sidePicker = editor.getByRole("combobox", { name: "排標籤位置", exact: true });
    assert.equal(await sidePicker.inputValue(), "", "old maps use the original default");
    for (const side of ["above", "below", "left", "right"]) {
      await sidePicker.selectOption(side);
      const boxes = await svg.evaluate(node => {
        const label = node.querySelector('[data-row-label="A"] text').getBoundingClientRect().toJSON();
        const slots = [...node.querySelectorAll("[data-slot-code] rect")].map(item => item.getBoundingClientRect());
        return { label, booths: { left: Math.min(...slots.map(item => item.left)), right: Math.max(...slots.map(item => item.right)), top: Math.min(...slots.map(item => item.top)), bottom: Math.max(...slots.map(item => item.bottom)) } };
      });
      if (side === "above") assert.ok(boxes.label.bottom < boxes.booths.top);
      if (side === "below") assert.ok(boxes.label.top > boxes.booths.bottom);
      if (side === "left") assert.ok(boxes.label.right < boxes.booths.left);
      if (side === "right") assert.ok(boxes.label.left > boxes.booths.right);
      assert.deepEqual(await svg.locator("[data-slot-code]").evaluateAll(nodes => nodes.map(node => [node.dataset.slotCode, ...["x", "y", "width", "height"].map(name => node.querySelector("rect").getAttribute(name))])), slotsBefore, "row side changes no code or booth rectangle");
      await journey.capture(page, `${surface}-row-label-${side}`);
    }
    await sidePicker.selectOption("left");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    await picker.selectOption("slot:0:0");
    assert.equal(await sidePicker.inputValue(), "right");
    await editor.getByRole("button", { name: "重做已復原的編輯" }).click();
    await picker.selectOption("slot:0:0");
    assert.equal(await sidePicker.inputValue(), "left", "label side can be undone and redone");
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    await editor.getByRole("button", { name: "選取 A 排", exact: true }).click();
    await editor.getByRole("button", { name: "攤位清單", exact: true }).click();
    const undoBeforePreview = await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled();
    await editor.getByRole("button", { name: "複製多排", exact: true }).click();
    await editor.getByRole("spinbutton", { name: "邊緣間距", exact: true }).fill("48");
    // A–Z runs out at Z: say how far it reaches from B rather than asking for labels.
    await editor.getByRole("spinbutton", { name: "複製份數", exact: true }).fill("30");
    await editor.getByText("A–Z 從 B 起最多 25 排；請減少份數或改用自訂排名。", { exact: true }).waitFor();
    assert.equal(await editor.getByRole("button", { name: "加入", exact: true }).isDisabled(), true);
    await editor.getByRole("spinbutton", { name: "複製份數", exact: true }).fill("3");
    assert.equal(await count(), 16, "preview is not committed");
    assert.equal(await editor.locator("[data-row-copy-preview] rect").count(), 48);
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), undoBeforePreview, "copy preview adds no undo step");
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
    assert.deepEqual(state.layout.rows.map(row => row.labelSide), ["left", "left", "left", "left"], "copies and saving preserve each row side");
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await editor.waitFor();
    await expand.click();
    await picker.selectOption("slot:0:0");
    assert.equal(await sidePicker.inputValue(), "left", "saved side reopens");
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
  // A portrait map at the horizontal overflow boundary used to alternate
  // between two fitted sizes as the scrollbar appeared and disappeared.
  for (const surface of ["organizer", "circle"]) {
    const portrait = { ...structuredClone(source), width: 1280, height: 1807, floor: { x: 0, y: 0, width: 1280, height: 1807 } };
    const { page, editor } = await openSurface(journey, surface, portrait);
    await page.setViewportSize({ width: 2560, height: 1215 });
    await page.getByRole("button", { name: "展開全視窗", exact: true }).click();
    const svg = editor.locator("svg[tabindex='0']");
    const viewport = editor.locator("#map-layout-editor-canvas");
    const fit = await viewport.evaluate(node => {
      const box = node.getBoundingClientRect(), map = node.querySelector("svg").getBoundingClientRect();
      return map.left >= box.left && map.top >= box.top && map.right <= box.right && map.bottom <= box.bottom;
    });
    assert.equal(fit, true, "100% shows the whole portrait map");
    for (let step = 0; step < 5; step++) await editor.getByRole("button", { name: "放大編輯地圖" }).click();
    assert.match(await svg.getAttribute("aria-label"), /350%/);
    const resize = await viewport.evaluate(node => {
      const css = getComputedStyle(node), paddingX = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight), paddingY = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
      const targetHeight = (node.clientWidth - paddingX) * 1807 / (1280 * 3.5) + paddingY + 5;
      return Math.round(window.innerHeight + targetHeight - node.getBoundingClientRect().height);
    });
    await page.setViewportSize({ width: 2560, height: resize });
    const frames = await viewport.evaluate(async node => {
      for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
      const samples = [];
      for (let frame = 0; frame < 24; frame++) {
        await new Promise(requestAnimationFrame);
        const map = node.querySelector("svg").getBoundingClientRect();
        samples.push({ width: map.width, height: map.height, viewportWidth: node.clientWidth, viewportHeight: node.clientHeight });
      }
      return samples;
    });
    const first = frames[0];
    assert.ok(frames.every(frame => Object.keys(first).every(key => Math.abs(frame[key] - first[key]) < .1)), `idle map stays stable at the overflow boundary: ${JSON.stringify(frames)}`);
    const gutters = await viewport.evaluate(node => {
      const css = getComputedStyle(node), box = node.getBoundingClientRect();
      return { horizontal: box.height - node.clientHeight - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth), vertical: box.width - node.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth) };
    });
    assert.ok(Math.abs(gutters.horizontal) < 1 && Math.abs(gutters.vertical) < 1, "zoomed canvas reserves no scrollbar space");
    await editor.getByRole("combobox", { name: "選取地圖元素" }).selectOption("slot:0:0");
    await journey.capture(page, `${surface}-portrait-borderless-350`);
    journey.report.checks.push(`${surface}: portrait map fits at 100%, remains stable at 350% overflow boundary without scrollbar gutters`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); throw error; }
