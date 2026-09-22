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
    // #286 C: an unfilled shape stops taking the pointer on its interior under
    // the default `visiblePainted`, so the middle of a booth fell through to
    // the paper and a press there started a rubber band. Checked by a real
    // press on the centre, not through the element picker: the picker would go
    // on selecting the booth no matter what the canvas does with a pointer.
    const centreOf = async code => {
      const target = booth(code).locator("rect");
      await target.scrollIntoViewIfNeeded();
      const painted = await target.boundingBox();
      return { x: painted.x + painted.width / 2, y: painted.y + painted.height / 2 };
    };
    const centre = await centreOf("A01");
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-slot-code]")?.dataset.slotCode ?? null, [centre.x, centre.y]),
      "A01", "the centre of a traced booth still belongs to that booth");
    const beforePress = await boxOf("A01");
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    for (let step = 1; step <= 4; step += 1) { await page.mouse.move(centre.x + step * 6, centre.y + step * 4); }
    await page.mouse.up();
    const dragged = await boxOf("A01");
    assert.ok(dragged.x !== beforePress.x && dragged.y !== beforePress.y, "dragging the centre while tracing moves the booth instead of banding");
    await undo.click();
    assert.deepEqual(await boxOf("A01"), beforePress, "one undo takes the traced drag back");
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
    // The point has to come from the scroll container, not from the SVG: at
    // 800% the SVG is several thousand pixels across and its own centre sits
    // far outside the window, so a drag started there lands on nothing.
    const box = await viewport.boundingBox();
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const window = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(middle.x > 0 && middle.y > 0 && middle.x < window.width && middle.y < window.height,
      `the drag point must be on screen: ${JSON.stringify(middle)} in ${JSON.stringify(window)}`);
    assert.equal(await page.evaluate(point => {
      const element = document.elementFromPoint(point.x, point.y);
      return !!(element && element.closest("svg[tabindex]"));
    }, middle), true, "the drag point must land on the editor canvas");
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

    // #286 B: the frame used to be a stored copy, which no ordinary drag knew
    // to update. Dragging the segment and then typing a height re-cut it from
    // where the segment had been, throwing it back to the old X.
    const draggedFrom = await boxOf("A01");
    const grab = await (async () => {
      const frame = await svg.boundingBox();
      const scale = frame.width / Number(await svg.getAttribute("viewBox").then(value => value.split(" ")[2]));
      return { x: frame.x + (draggedFrom.x + draggedFrom.width / 2) * scale, y: frame.y + (draggedFrom.y + draggedFrom.height / 2) * scale, scale };
    })();
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(grab.x + step * 10 * grab.scale, grab.y);
    await page.mouse.up();
    const movedTo = await boxOf("A01");
    assert.ok(movedTo.x > draggedFrom.x, "the drag moved the segment");
    near(Number(await field("排段 X").inputValue()), movedTo.x, "the frame field follows a plain drag");
    await field("排段高").fill("400");
    await field("排段高").press("Tab");
    near((await boxOf("A01")).x, movedTo.x, "re-cutting after a drag keeps the dragged X");
    // Selecting elsewhere ends the segment rather than leaving a panel aimed at it.
    await picker.selectOption("slot:0:2");
    assert.equal(await panel.isVisible().catch(() => false), false, "the segment panel goes with the selection");
    await picker.selectOption("slot:0:0");
    await editor.getByRole("button", { name: "編輯整個排段", exact: true }).click();
    await panel.waitFor();
    await field("排段 X").fill("320");
    await field("排段 X").press("Tab");
    await field("排段高").fill("500");
    await field("排段高").press("Tab");

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

    // --- #286 A: a copy dragged across the lattice it came from -----------
    // The copy lands flush with its source, so the source's own booth edges are
    // the targets, one pitch apart. A reach wider than that pitch pinned the
    // copy for several frames at a time and then made it leap, which is what
    // the maintainer saw at 350%. Sampled every frame: the final rectangle
    // alone cannot tell a smooth drag from a stuck one.
    await picker.selectOption("slot:0:0");
    await editor.getByRole("button", { name: "新增排／排段", exact: true }).click();
    await editor.getByRole("textbox", { name: "排標籤", exact: true }).fill("Z");
    await editor.getByRole("textbox", { name: "起始編號", exact: true }).fill("1");
    await editor.getByRole("textbox", { name: "結束編號", exact: true }).fill("16");
    // One conversion for the whole block, taken from the painted canvas. The
    // viewBox is square and so is the element, so a single scale is honest
    // here; every press is still checked against the window before it is used.
    const toScreen = async (x, y) => {
      await svg.scrollIntoViewIfNeeded();
      const frame = await svg.boundingBox();
      const scale = frame.width / SIZE;
      const point = { x: frame.x + x * scale, y: frame.y + y * scale, scale };
      const view = page.viewportSize();
      assert.ok(point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height,
        `(${x}, ${y}) is off screen at ${JSON.stringify(point)} in ${JSON.stringify(view)}`);
      return point;
    };
    const dense = { x: 600, y: 150, width: 60, height: 400 };
    const from = await toScreen(dense.x, dense.y), to = await toScreen(dense.x + dense.width, dense.y + dense.height);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    // Placing a segment leaves the row panel open and its booths selected. The
    // tool has to be put away before the canvas goes back to moving things:
    // with it open a press on a booth grabs a segment instead of dragging it.
    await editor.getByRole("button", { name: "新增排／排段", exact: true }).click();
    const one = await toScreen(dense.x - 10, dense.y - 10), two = await toScreen(dense.x + dense.width + 10, dense.y + dense.height + 10);
    await page.mouse.move(one.x, one.y); await page.mouse.down(); await page.mouse.move(two.x, two.y, { steps: 8 }); await page.mouse.up();
    const copy = editor.getByRole("button", { name: /複製選取的 \d+ 格/ });
    await copy.click();
    const boundsOf = () => page.evaluate(() => {
      const picked = [...document.querySelectorAll("[data-slot-code]")].filter(node => node.className.baseVal.includes("selected")).map(node => node.querySelector("rect"));
      const value = (node, name) => Number(node.getAttribute(name));
      return picked.reduce((box, node) => ({
        x: Math.min(box.x, value(node, "x")), y: Math.min(box.y, value(node, "y")),
      }), { x: Infinity, y: Infinity });
    });
    const started = await boundsOf();
    assert.ok(Number.isFinite(started.x), "the copy lands selected");
    const grip = await toScreen(started.x + 30, started.y + 200);
    const step = 4;
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    const travel = [];
    let previous = started;
    for (let frame = 1; frame <= 18; frame += 1) {
      // Dragged back across the column it was copied from. Flush neighbours
      // share no width, so both the lattice and the overlap notice only come
      // into play once the two columns start to overlap.
      await page.mouse.move(grip.x - frame * grip.scale, grip.y + frame * step * grip.scale);
      const now = await boundsOf();
      travel.push(Number((now.y - previous.y).toFixed(3)));
      previous = now;
    }
    await page.mouse.up();
    const stalled = travel.filter(moved => moved === 0).length;
    let run = 0, longestStall = 0;
    for (const moved of travel) { run = moved === 0 ? run + 1 : 0; longestStall = Math.max(longestStall, run); }
    assert.ok(longestStall <= 2, `the copy tracks the pointer instead of sticking: ${travel.join(",")}`);
    assert.ok(stalled * 3 <= travel.length, `most frames move: ${stalled} of ${travel.length} stood still`);
    assert.ok(Math.max(...travel) <= step * 2, `no frame leaps after a snap: ${travel.join(",")}`);
    assert.ok(travel.every(moved => moved >= 0), "the copy never backs up against the drag");
    // --- #286 D: one top, one bottom, one set of dividers ------------------
    // The copy now sits lower than the column it came from and keeps its own
    // cell height, which is the state traced columns are in before correction.
    const cellsOf = () => page.evaluate(() => {
      const value = (node, name) => Number(node.getAttribute(name));
      // Scoped to the editable canvas: the contribution surface also renders
      // a read-only preview of the same booths, so the document as a whole
      // holds every cell twice.
      return [...document.querySelector(`svg[aria-label^="可編輯"]`).querySelectorAll("[data-slot-code]")]
        .filter(node => node.dataset.slotCode.startsWith("Z"))
        .map(node => {
          const rect = node.querySelector("rect");
          return { code: node.dataset.slotCode, x: value(rect, "x"), width: value(rect, "width"), y: value(rect, "y"), height: value(rect, "height") };
        });
    });
    const tilted = await cellsOf();
    const lefts = [...new Set(tilted.map(cell => cell.x))];
    assert.equal(lefts.length, 2, "two columns to line up");
    const spanOf = left => {
      const cells = tilted.filter(cell => cell.x === left);
      return { top: Math.min(...cells.map(cell => cell.y)), bottom: Math.max(...cells.map(cell => cell.y + cell.height)) };
    };
    const spans = lefts.map(spanOf);
    assert.ok(Math.abs(spans[0].top - spans[1].top) > 1 || Math.abs(spans[0].bottom - spans[1].bottom) > 1,
      `the columns must start out misaligned or there is nothing to correct: ${JSON.stringify(spans)}`);
    const edge = {
      left: Math.min(...tilted.map(cell => cell.x)) - 6,
      top: Math.min(...tilted.map(cell => cell.y)) - 6,
      right: Math.max(...tilted.map(cell => cell.x + cell.width)) + 6,
      bottom: Math.max(...tilted.map(cell => cell.y + cell.height)) + 6,
    };
    await svg.scrollIntoViewIfNeeded();
    const canvas = await svg.boundingBox();
    const view = page.viewportSize();
    const corner = (x, y) => ({ x: canvas.x + x * canvas.width / SIZE, y: canvas.y + y * canvas.height / SIZE });
    const start = corner(edge.left, edge.top), end = corner(edge.right, edge.bottom);
    for (const [name, point] of [["start", start], ["end", end]]) {
      assert.ok(point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height,
        `band ${name} is off screen at ${JSON.stringify(point)} in ${JSON.stringify(view)} (canvas ${JSON.stringify(canvas)})`);
    }
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
    const sync = editor.getByRole("button", { name: /同步上下邊界/ });
    assert.match(await sync.textContent(), /2 排 × 16 格/, "the control says what it will correct");
    await sync.click();
    assert.deepEqual(await cellsOf(), tilted, "opening a preview leaves the map alone");
    await editor.getByRole("button", { name: "套用上下邊界", exact: true }).click();
    const shared = { top: Math.min(...tilted.map(cell => cell.y)), bottom: Math.max(...tilted.map(cell => cell.y + cell.height)) };
    const after = await cellsOf();
    const was = new Map(tilted.map(cell => [cell.code, cell]));
    for (const cell of after) {
      near(cell.x, was.get(cell.code).x, `${cell.code} keeps its column`);
      near(cell.width, was.get(cell.code).width, `${cell.code} keeps its width`);
    }
    const grouped = new Map();
    for (const cell of after) grouped.set(cell.x, [...(grouped.get(cell.x) ?? []), cell]);
    const columns = [...grouped.values()].map(cells => cells.sort((a, b) => a.y - b.y));
    for (const cells of columns) {
      assert.equal(cells.length, 16);
      near(cells[0].y, shared.top, "every column starts on the shared top");
      near(cells[15].y + cells[15].height, shared.bottom, "and ends on the shared bottom");
      for (let index = 1; index < cells.length; index += 1) near(cells[index].y, cells[index - 1].y + cells[index - 1].height, "seamless");
    }
    for (let index = 0; index < 16; index += 1) near(columns[1][index].y, columns[0][index].y, `divider ${index} is shared`);
    // One correction across both columns is one history step.
    await undo.click();
    const undone = await cellsOf();
    for (const cell of undone) {
      near(cell.y, was.get(cell.code).y, `${cell.code} is back where it was`);
      near(cell.height, was.get(cell.code).height);
    }

    for (let step = 0; step < 2; step += 1) await undo.click();
    await picker.selectOption("slot:0:0");

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
  // Six independent columns, including two columns in one logical row, with
  // reverse numbering and untouched booths beyond the marquee.
  for (const surface of ["organizer", "circle"]) {
    const columns = Array.from({ length: 6 }, (_, col) => Array.from({ length: 10 }, (_, i) => ({
      code: `C${col}-${10 - i}`, rect: { x: 80 + col * 110, y: 100 + col * 2 + i * (25 + col), width: 35, height: 25 + col },
    })));
    const initial = { ...structuredClone(source), width: SIZE, height: SIZE,
      floor: { x: 10, y: 10, width: 980, height: 980 }, pillars: [], landmarks: [], accessPoints: [],
      rows: [{ label: "A", orientation: "vertical", slots: [...columns[0], ...columns[1]] },
        ...columns.slice(2).map((slots, i) => ({ label: `R${i}`, orientation: "vertical", slots })),
        { label: "untouched", orientation: "vertical", slots: [{ code: "outside", rect: { x: 850, y: 650, width: 40, height: 40 } }] }] };
    const { page, editor, state } = await openSurface(journey, surface, initial);
    const svg = editor.locator("svg[tabindex='0']");
    const snapshot = () => svg.locator("[data-slot-code]").evaluateAll(nodes => nodes.map(node => ({
      code: node.dataset.slotCode,
      ...Object.fromEntries(["x", "y", "width", "height"].map(name => [name, Number(node.querySelector("rect").getAttribute(name))])),
    })));
    const selectSix = async () => {
      await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      await page.mouse.move(box.x + 60 * box.width / SIZE, box.y + 80 * box.height / SIZE);
      await page.mouse.down();
      await page.mouse.move(box.x + 680 * box.width / SIZE, box.y + 430 * box.height / SIZE, { steps: 8 });
      await page.mouse.up();
      assert.match(await editor.getByRole("button", { name: /同步上下邊界/ }).textContent(), /6 排 × 10 格/);
    };
    const sync = editor.getByRole("button", { name: /同步上下邊界/ });
    const panel = editor.getByRole("region", { name: "同步上下邊界預覽" });
    const top = panel.getByRole("spinbutton", { name: "上界 Y" });
    const bottom = panel.getByRole("spinbutton", { name: "下界 Y" });
    const apply = panel.getByRole("button", { name: "套用上下邊界", exact: true });
    const undo = editor.getByRole("button", { name: "復原上一步編輯" });
    const redo = editor.getByRole("button", { name: "重做已復原的編輯" });
    const before = await snapshot();
    await selectSix();
    await sync.click();
    assert.equal(await top.inputValue(), "100");
    assert.equal(await bottom.inputValue(), "410");
    await top.fill("70");
    await bottom.fill("450");
    assert.deepEqual(await snapshot(), before);
    assert.equal(await undo.isDisabled(), true, "preview adds no history");
    assert.equal(await svg.locator("[data-shared-edge-preview]").evaluate(node => getComputedStyle(node).pointerEvents), "none");
    await panel.getByRole("button", { name: "取消預覽" }).click();
    assert.equal(await svg.locator("[data-shared-edge-preview]").count(), 0);
    assert.deepEqual(await snapshot(), before);
    assert.equal(state.saves, 0);

    await sync.click();
    for (const [value, reason] of [["", /數值/], ["410", /大於/], ["-1", /畫布/], ["409", /共同高度不足/]]) {
      await top.fill(value);
      assert.equal(await apply.isDisabled(), true);
      assert.match(await panel.getByRole("alert").textContent(), reason);
      assert.equal(await svg.locator("[data-shared-edge-preview]").count(), 0);
    }
    await top.fill("70");
    await bottom.fill("450");
    await editor.getByRole("combobox", { name: "選取地圖元素", exact: true }).selectOption("slot:0:0");
    assert.equal(await panel.count(), 0, "changing selection discards pending values");
    assert.deepEqual(await snapshot(), before);
    assert.equal(await undo.isDisabled(), true);

    await selectSix();
    await sync.click();
    assert.equal(await top.inputValue(), "100", "the abandoned custom values do not come back");
    await top.fill("70");
    await bottom.fill("450");
    const preview = await svg.locator("[data-shared-edge-preview] rect").evaluateAll(nodes =>
      nodes.map(node => Object.fromEntries(["x", "y", "width", "height"].map(name => [name, Number(node.getAttribute(name))]))));
    assert.equal(preview.length, 60);
    await panel.scrollIntoViewIfNeeded();
    await journey.capture(page, `${surface}-six-columns-preview`);
    await apply.click();
    const applied = await snapshot();
    assert.deepEqual(applied.slice(0, 60).map(({ x, y, width, height }) => ({ x, y, width, height })), preview, "the applied geometry matches the visible preview");
    assert.deepEqual(applied.map(cell => cell.code), before.map(cell => cell.code));
    assert.deepEqual(applied.at(-1), before.at(-1), "unselected booth unchanged");
    for (let col = 0; col < 6; col++) {
      for (let i = 0; i < 10; i++) {
        const index = col * 10 + i, cell = applied[index];
        near(cell.x, before[index].x);
        near(cell.width, before[index].width);
        near(cell.y, 70 + i * 38);
        near(cell.height, 38);
      }
    }
    await undo.click();
    assert.deepEqual(await snapshot(), before);
    assert.equal(await undo.isDisabled(), true, "one apply was exactly one history step");
    await redo.click();
    assert.deepEqual(await snapshot(), applied);
    // Saving while a second preview is open saves only the applied geometry.
    await selectSix();
    await sync.click();
    await top.fill("90");
    await bottom.fill("480");
    const save = page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true });
    await save.click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 1);
    const savedCells = state.layout.rows.flatMap(row => row.slots.map(slot => ({ code: slot.code, ...slot.rect })));
    assert.deepEqual(savedCells, applied);
    assert.deepEqual(state.layout.rows.map(row => row.label), initial.rows.map(row => row.label));
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await svg.waitFor();
    assert.deepEqual(await snapshot(), applied);
    assert.equal(await panel.count(), 0);
    await journey.capture(page, `${surface}-six-columns-reopened`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
