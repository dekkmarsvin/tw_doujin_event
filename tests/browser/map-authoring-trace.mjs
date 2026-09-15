// staged-data: fixture
//
// Slice 3 of #279: looking at the plan while tracing it. The background
// controls, the tracing view, the thin selection overlay, the nudge step, 800%
// with panning, and editing a whole segment's frame by number — on both
// surfaces that embed `MapLayoutEditor`.
import assert from "node:assert/strict";
import { PIXEL, start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";

const journey = await start("map-authoring-trace");
journey.report.synthetic = true;
journey.report.productionWrites = 0;

const SIZE = 1000;
const column = { x: 200, y: 200, width: 60, height: 400 };
const codes = ["A01", "A02", "A03", "A04"];
const near = (value, expected, message) => assert.ok(Math.abs(value - expected) < .05, `${message ?? ""}: ${value} != ${expected}`);

function initialLayout() {
  return {
    ...source, width: SIZE, height: SIZE,
    floor: { x: 0, y: 0, width: SIZE, height: SIZE },
    rows: [{ label: "A", orientation: "vertical", confidence: 1, slots: codes.map((code, index) => ({
      code, rect: { ...column, y: column.y + index * (column.height / codes.length), height: column.height / codes.length },
    })) }],
    pillars: [], landmarks: [], accessPoints: [],
  };
}

try {
  for (const surface of ["organizer", "circle"]) {
    const { page, editor, state } = await openSurface(journey, surface, initialLayout());
    const svg = editor.locator("svg[tabindex='0']");
    const viewport = editor.locator("#map-layout-editor-canvas");
    const picker = editor.getByRole("combobox", { name: "選取地圖元素", exact: true });
    const undo = editor.getByRole("button", { name: "復原上一步編輯" });
    const zoomIn = editor.getByRole("button", { name: "放大編輯地圖", exact: true });
    const zoomOut = editor.getByRole("button", { name: "縮小編輯地圖", exact: true });
    const zoomLevel = editor.locator("output[aria-live='polite']");
    const tracing = editor.getByRole("checkbox", { name: "描摹模式", exact: true });
    const nudgeStep = editor.getByRole("combobox", { name: "微移步進", exact: true });
    const booth = code => svg.locator(`[data-slot-code="${code}"]`);
    const boxOf = async code => {
      const rect = booth(code).locator("rect");
      return Object.fromEntries(await Promise.all(["x", "y", "width", "height"].map(async name => [name, Number(await rect.getAttribute(name))])));
    };
    const styleOf = (code, property) => booth(code).locator("rect")
      .evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

    // --- The plan behind the vectors -------------------------------------
    const showBackground = editor.getByRole("checkbox", { name: "顯示配置圖", exact: true });
    const opacity = editor.getByRole("slider", { name: "配置圖透明度", exact: true });
    const resetOpacity = editor.getByRole("button", { name: "重設透明度", exact: true });
    if (surface === "organizer") {
      // No plan yet, so the controls that act on one are inert rather than lying.
      for (const control of [showBackground, opacity, resetOpacity]) assert.equal(await control.isDisabled(), true, "background controls stay disabled without a plan");
      await page.locator("input[type=file][accept*='image/png']").setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: PIXEL });
      await page.getByText("配置圖已儲存。", { exact: true }).waitFor();
      const plan = svg.locator("image");
      await plan.waitFor();
      for (const control of [showBackground, opacity, resetOpacity]) assert.equal(await control.isDisabled(), false);
      assert.equal(await opacity.inputValue(), "30");
      near(Number(await plan.evaluate(node => getComputedStyle(node).opacity)), .3, "default plan opacity");
      for (const value of ["0", "100", "64"]) {
        await opacity.fill(value);
        near(Number(await plan.evaluate(node => getComputedStyle(node).opacity)), Number(value) / 100, `opacity ${value}`);
      }
      await resetOpacity.click();
      assert.equal(await opacity.inputValue(), "30");
      // Hidden, not removed: the vectors keep the coordinates traced from it.
      await showBackground.uncheck();
      assert.equal(await plan.evaluate(node => getComputedStyle(node).visibility), "hidden");
      assert.equal(await plan.count(), 1);
      await showBackground.check();
      assert.equal(await plan.evaluate(node => getComputedStyle(node).visibility), "visible");
      assert.equal(await plan.evaluate(node => getComputedStyle(node).pointerEvents), "none", "the plan never takes a pointer");
      assert.equal(state.saves, 0, "looking at the plan is not an edit");
    } else {
      for (const control of [showBackground, opacity, resetOpacity]) assert.equal(await control.isDisabled(), true);
    }

    // --- Tracing view -----------------------------------------------------
    const filled = await styleOf("A01", "fill");
    assert.notEqual(filled, "none");
    await tracing.check();
    assert.equal(await styleOf("A01", "fill"), "none", "tracing leaves booths as outlines");
    assert.equal(await booth("A01").locator("text").isVisible(), false, "tracing hides the printed codes");
    await tracing.uncheck();
    assert.equal(await styleOf("A01", "fill"), filled);
    await booth("A01").locator("text").waitFor({ state: "visible" });

    // --- Selection no longer covers what is being traced ------------------
    const restingStroke = await styleOf("A02", "stroke-width");
    await picker.selectOption("slot:0:1");
    assert.equal(await styleOf("A02", "stroke-width"), restingStroke, "selection must not widen the traced stroke");
    assert.ok(Number.parseFloat(restingStroke) <= 1.5, `resting stroke ${restingStroke} is already thin`);
    const overlay = svg.locator("[data-selection-overlay='true'] rect");
    assert.equal(await overlay.count(), 1);
    assert.ok(Number.parseFloat(await overlay.first().evaluate(node => getComputedStyle(node).strokeWidth)) <= 1.5, "the selection ring stays thin");
    // A small knob to look past, a large invisible disc to hit.
    const handle = svg.locator("[data-resize-corner='se']");
    const knob = Number(await handle.locator("rect").getAttribute("width"));
    const hit = Number(await handle.locator("circle").getAttribute("r"));
    assert.ok(knob < hit, `knob ${knob} must be smaller than its hit radius ${hit}`);

    // --- Nudge step -------------------------------------------------------
    assert.deepEqual(await nudgeStep.locator("option").allInnerTexts(), ["0.1", "0.5", "1", "5", "10"]);
    const before = await boxOf("A02");
    for (const [step, shift, moved] of [["0.1", false, .1], ["0.1", true, 1], ["5", false, 5], ["10", true, 100]]) {
      await nudgeStep.selectOption(step);
      const from = await boxOf("A02");
      await svg.press(shift ? "Shift+ArrowRight" : "ArrowRight");
      near((await boxOf("A02")).x - from.x, moved, `step ${step}${shift ? " with Shift" : ""}`);
    }
    for (let step = 0; step < 4; step += 1) await undo.click();
    near((await boxOf("A02")).x, before.x, "undo returns every nudge");

    // --- 800% and panning -------------------------------------------------
    assert.equal(await zoomOut.isDisabled(), true);
    for (let step = 0; step < 20 && !await zoomIn.isDisabled(); step += 1) await zoomIn.click();
    assert.equal((await zoomLevel.textContent()).trim(), "800%", "the canvas reaches at least 800%");
    const scrolled = async () => viewport.evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }));
    await viewport.evaluate(node => node.scrollTo({ left: 400, top: 400 }));
    const anchored = await scrolled();
    const box = await svg.boundingBox();
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Space plus drag, and the middle button, both move the view rather than
    // the elements the pointer happens to start on.
    for (const pan of ["space", "middle"]) {
      const start = await scrolled();
      const geometry = await boxOf("A02");
      await svg.focus();
      if (pan === "space") await page.keyboard.down("Space");
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.down(pan === "space" ? {} : { button: "middle" });
      await page.mouse.move(middle.x - 120, middle.y - 90, { steps: 6 });
      await page.mouse.up(pan === "space" ? {} : { button: "middle" });
      if (pan === "space") await page.keyboard.up("Space");
      const after = await scrolled();
      assert.ok(after.left > start.left && after.top > start.top, `${pan} drag scrolls the canvas (${JSON.stringify(start)} -> ${JSON.stringify(after)})`);
      assert.deepEqual(await boxOf("A02"), geometry, `${pan} drag must not move a booth`);
    }
    assert.ok((await scrolled()).left > anchored.left);
    await journey.capture(page, `${surface}-trace-controls`);
    await editor.getByRole("button", { name: "重設編輯地圖倍率", exact: true }).click();
    assert.equal((await zoomLevel.textContent()).trim(), "100%");

    // --- The whole segment, by number -------------------------------------
    await picker.selectOption("slot:0:0");
    await editor.getByRole("button", { name: "編輯整個排段", exact: true }).click();
    const panel = editor.getByLabel("排段整體調整");
    await panel.waitFor();
    const field = name => panel.getByRole("spinbutton", { name, exact: true });
    for (const [name, expected] of [["排段 X", column.x], ["排段 Y", column.y], ["排段寬", column.width], ["排段高", column.height]]) {
      near(Number(await field(name).inputValue()), expected, name);
    }
    await field("排段 X").fill("320");
    await field("排段 X").press("Tab");
    await field("排段高").fill("500");
    await field("排段高").press("Tab");
    const recut = await Promise.all(codes.map(boxOf));
    near(recut[0].y, column.y, "the segment still starts where it did");
    near(recut[3].y + recut[3].height, column.y + 500, "and now ends at the height typed in");
    for (const slot of recut) { near(slot.x, 320, "every booth follows the frame"); near(slot.height, 125, "and is cut evenly"); }
    for (let index = 1; index < recut.length; index += 1) near(recut[index].y, recut[index - 1].y + recut[index - 1].height, "seamless");

    // Renumbering is the second, explicit step, and it re-cuts the same frame.
    await editor.getByRole("button", { name: "調整排段編號與方向", exact: true }).click();
    await editor.getByRole("textbox", { name: "排段結束編號", exact: true }).fill("5");
    await editor.getByRole("combobox", { name: "排段編號起點", exact: true }).selectOption("bottom");
    await editor.getByRole("button", { name: "套用排段編號與方向", exact: true }).click();
    const renumbered = await Promise.all(["A01", "A02", "A03", "A04", "A05"].map(boxOf));
    for (const slot of renumbered) near(slot.height, 100, "five booths share the same frame");
    assert.ok(renumbered[0].y > renumbered[4].y, "A01 is now at the bottom of the run");
    await editor.getByRole("button", { name: "結束排段調整", exact: true }).click();
    await undo.click();
    assert.deepEqual((await Promise.all(codes.map(boxOf))).map(slot => Math.round(slot.height)), [125, 125, 125, 125], "one undo takes back the renumbering");

    // --- Display settings are personal, not part of the draft -------------
    await tracing.check();
    await nudgeStep.selectOption("5");
    assert.equal(state.saves, 0, "nothing in the display toolbar advances a revision");
    const save = page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true });
    await save.click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 1);
    assert.equal(Object.hasOwn(state.layout, "preferences"), false, "display settings never reach the saved layout");
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await nudgeStep.waitFor();
    assert.equal(await tracing.isChecked(), true, "the tracing view is remembered in this browser");
    assert.equal(await nudgeStep.inputValue(), "5");
    await journey.capture(page, `${surface}-trace-reopened`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
