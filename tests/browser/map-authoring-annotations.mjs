// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, openToolGroup, source } from "./support/map-authoring.mjs";

const journey = await start("map-authoring-annotations");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const initial = { ...structuredClone(source), width: 600, height: 400, floor: { x: 0, y: 0, width: 600, height: 400 },
  rows: [{ ...source.rows[0], slots: source.rows[0].slots.map((slot, index) => ({ ...slot, rect: { x: 200 + index * 100, y: 200, width: 60, height: 50 } })) }] };
const text = "社團入場 9:30–10:30\n一般入場 10:30–15:30";
let published;
try {
  for (const surface of ["organizer", "circle"]) {
    const { page, editor, state } = await openSurface(journey, surface, initial, { codes: ["S01", "S02"] });
    const svg = editor.locator("svg[tabindex='0']"), picker = editor.getByRole("combobox", { name: "選取地圖元素" });
    const point = async (x, y) => { await svg.scrollIntoViewIfNeeded(); const box = await svg.boundingBox(); return { x: box.x + x * box.width, y: box.y + y * box.height }; };
    const click = async (x, y) => { const at = await point(x, y); await page.mouse.click(at.x, at.y); };
    const activate = async name => { await openToolGroup(editor, "註記"); await editor.getByRole("button", { name, exact: true }).click(); };
    await activate("新增文字註記");
    await click(.1, .1);
    assert.equal(await svg.locator("[data-note-id]").count(), 0, "a click cannot guess a note's space");
    const from = await point(.1, .08), to = await point(.9, .25);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 });
    assert.equal(await svg.locator("[data-note-id]").count(), 0, "a preview has no saved note");
    await page.mouse.up();
    assert.equal(await picker.inputValue(), "note:0");
    await editor.getByRole("textbox", { name: "註記文字", exact: true }).fill(text);
    await editor.getByRole("textbox", { name: "註記文字", exact: true }).press("Tab");
    const width = Number(await editor.getByRole("spinbutton", { name: "寬", exact: true }).inputValue());
    await editor.getByRole("spinbutton", { name: "寬", exact: true }).fill(String(width - 20));
    await editor.getByRole("spinbutton", { name: "寬", exact: true }).press("Tab");
    const x = Number(await editor.getByRole("spinbutton", { name: "X", exact: true }).inputValue());
    await svg.press("ArrowRight");
    assert.ok(Number(await editor.getByRole("spinbutton", { name: "X", exact: true }).inputValue()) > x);
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    await picker.selectOption("note:0");
    assert.equal(Number(await editor.getByRole("spinbutton", { name: "X", exact: true }).inputValue()), x);
    await svg.press("Delete");
    assert.equal(await svg.locator("[data-note-id]").count(), 0);
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    assert.equal(await svg.locator("[data-note-id]").count(), 1);
    await activate("新增動線箭頭");
    await click(.1, .4);
    assert.equal(await editor.getByRole("button", { name: "完成箭頭（1 點）", exact: true }).isDisabled(), true);
    await svg.press("Escape");
    assert.equal(await svg.locator('[data-path-id]:not([data-path-id="preview"])').count(), 0, "Escape drops the pending path");
    await activate("新增動線箭頭");
    await click(.1, .4); await click(.3, .4); await click(.3, .7);
    assert.equal(await svg.locator('[data-path-id]:not([data-path-id="preview"])').count(), 0);
    await editor.getByRole("button", { name: "完成箭頭（3 點）", exact: true }).click();
    assert.equal(await picker.inputValue(), "path:0");
    const route = svg.locator("[data-path-id] > polyline").first();
    const before = await route.getAttribute("points");
    await editor.getByRole("spinbutton", { name: "箭頭頂點 1 X", exact: true }).fill("70");
    await editor.getByRole("spinbutton", { name: "箭頭頂點 1 X", exact: true }).press("Tab");
    assert.notEqual(await route.getAttribute("points"), before);
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    assert.equal(await route.getAttribute("points"), before);
    await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
    assert.notEqual(await route.getAttribute("points"), before);
    const save = page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true });
    await save.click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.layout.notes[0].text, text);
    assert.equal(state.layout.paths[0].points.length, 3);
    assert.deepEqual(state.layout.rows, initial.rows, "annotations never change the roster geometry");
    published = structuredClone(state.layout);
    await journey.capture(page, `${surface}-static-time-and-bent-arrow`);
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await editor.waitFor();
    await picker.selectOption("note:0");
    assert.equal(await editor.getByRole("textbox", { name: "註記文字", exact: true }).inputValue(), text);
    await editor.getByRole("spinbutton", { name: "Y", exact: true }).fill("200");
    await editor.getByRole("spinbutton", { name: "Y", exact: true }).press("Tab");
    await editor.getByRole("alert").filter({ hasText: /文字註記.*S01/ }).waitFor();
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    assert.equal(await editor.getByRole("alert").filter({ hasText: /文字註記.*S01/ }).count(), 0);
    await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
    await picker.selectOption("note:0");
    await editor.getByRole("alert").filter({ hasText: /文字註記.*S01/ }).waitFor();
    await save.click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 2, "an unfinished collision may be saved for later correction");
    await page.close();
  }
  for (const [width, height, scale] of [[1440, 900, "standard"], [390, 844, "extra"]]) {
    const page = await journey.mapPage({ event: "sample", viewport: { width, height }, routes: async page => {
      await page.addInitScript(value => localStorage.setItem("event-map-text-scale", value), scale);
      await page.route("**/data/events/sample/map.json", async route => {
        const response = await route.fetch(), map = await response.json();
        map.layout = published;
        await route.fulfill({ response, json: map });
      });
    } });
    await page.getByRole("button", { name: "查看全場", exact: true }).click();
    const note = page.locator("[data-note-id]"), path = page.locator("[data-path-id]");
    assert.equal(await note.getAttribute("aria-label"), text);
    assert.equal(await note.getAttribute("pointer-events"), "none");
    assert.equal(await path.getAttribute("pointer-events"), "none");
    const check = async () => {
      const measured = await page.locator("svg[role=group]").evaluate(svg => {
        const note = svg.querySelector("[data-note-id]").getBoundingClientRect();
        const booths = [...svg.querySelectorAll("[data-slot-code]")].map(node => node.getBoundingClientRect());
        return booths.every(box => !(note.left < box.right && note.right > box.left && note.top < box.bottom && note.bottom > box.top));
      });
      assert.equal(measured, true, "static times remain outside booths at this zoom and text scale");
    };
    await check();
    await journey.capture(page, `annotations-reader-${width}-${scale}-fit`);
    for (let step = 0; step < 20; step++) await page.getByRole("button", { name: "放大地圖", exact: true }).click();
    await check();
    await page.locator('[data-slot-code="S01"]').focus(); await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).searchParams.get("selectedBooth"), "S01");
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
