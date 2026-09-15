// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";

const journey = await start("map-authoring-guides");
journey.report.synthetic = true;
journey.report.productionWrites = 0;

try {
  for (const [surface, width, height] of [["organizer", 1000, 1600], ["circle", 1600, 1000]]) {
    const initial = { ...source, width, height, floor: { x: 0, y: 0, width, height }, rows: [], pillars: [], landmarks: [], accessPoints: [] };
    const { page, editor, state } = await openSurface(journey, surface, initial);
    const svg = editor.locator("svg[tabindex='0']");
    const guides = editor.getByRole("combobox", { name: "選取輔助線", exact: true });
    const picker = editor.getByRole("combobox", { name: "選取地圖元素", exact: true });
    const undo = editor.getByRole("button", { name: "復原上一步編輯" });
    const at = async (x, y) => { await svg.scrollIntoViewIfNeeded(); const b = await svg.boundingBox(); assert.ok(b.width > 100 && b.height > 100, "canvas retains usable dimensions"); return { x: b.x + x / width * b.width, y: b.y + y / height * b.height }; };
    const click = async (x, y) => { const p = await at(x, y); await page.mouse.click(p.x, p.y); };
    const drag = async (a, b, alt = false) => { const from = await at(...a), to = await at(...b); if (alt) await page.keyboard.down("Alt"); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up(); if (alt) await page.keyboard.up("Alt"); };
    const near = (value, expected) => assert.ok(Math.abs(value - expected) < .01, `${value} != ${expected}`);
    const placeGuide = async (axis, position) => {
      await editor.getByRole("button", { name: `新增${axis === "x" ? "垂直" : "水平"}輔助線`, exact: true }).click();
      await click(axis === "x" ? position : 20, axis === "y" ? position : 20);
      const field = editor.getByRole("spinbutton", { name: `輔助線 ${axis.toUpperCase()}`, exact: true });
      await field.fill(String(position)); await field.press("Tab");
      return guides.inputValue();
    };
    // Both aspect ratios use long vertical columns with opposite numbering and
    // a separate horizontal segment, all sharing a few manual outer guides.
    const top = height * .15, bottom = height * .75;
    const firstX = width * .2, rightX = width * .26, secondX = width * .34, secondRight = width * .4;
    const firstGuide = await placeGuide("x", firstX);
    if (surface === "organizer") {
      await page.getByRole("button", { name: "空白畫布", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "空白畫布會清掉畫面上的內容" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await editor.locator("[data-guide-id]").count(), 1);
      near(Number(await editor.getByRole("spinbutton", { name: "畫布寬", exact: true }).inputValue()), width);
      assert.equal(await undo.isEnabled(), true);
      await undo.click();
      assert.equal(await editor.locator("[data-guide-id]").count(), 0);
      await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
      assert.equal(await editor.locator("[data-guide-id]").count(), 1);
    }
    await placeGuide("x", rightX); await placeGuide("x", secondX); await placeGuide("x", secondRight);
    await placeGuide("y", top); await placeGuide("y", bottom);
    assert.equal(await editor.locator("[data-guide-id]").count(), 6);
    await guides.selectOption(firstGuide);
    await editor.getByRole("checkbox", { name: "鎖定輔助線位置", exact: true }).check();
    assert.equal(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).isDisabled(), true);
    await drag([firstX, height * .9], [firstX + width * .05, height * .9]);
    near(Number(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).inputValue()), firstX);
    const drawRow = async (startNumber, numberingStart, fromX, toX) => {
      await editor.getByRole("button", { name: "新增排／排段", exact: true }).click();
      await editor.getByRole("textbox", { name: "排標籤", exact: true }).fill("A");
      await editor.getByRole("textbox", { name: "起始編號", exact: true }).fill(String(startNumber));
      await editor.getByRole("textbox", { name: "結束編號", exact: true }).fill(String(startNumber + 3));
      await editor.getByRole("combobox", { name: "編號起點", exact: true }).selectOption(numberingStart);
      // Offset by two map units: within eight screen pixels in both fixtures.
      await drag([fromX + 2, top + 2], [toX - 2, bottom - 2]);
      await svg.press("Escape");
    };
    await drawRow(1, "top", firstX, rightX);
    await drawRow(5, "bottom", secondX, secondRight);
    await editor.getByRole("button", { name: "新增排／排段", exact: true }).click();
    await editor.getByRole("textbox", { name: "排標籤", exact: true }).fill("H");
    await editor.getByRole("textbox", { name: "結束編號", exact: true }).fill("4");
    await editor.getByRole("combobox", { name: "方向", exact: true }).selectOption("horizontal");
    await drag([width * .5, top + 2], [width * .9, top + height * .05]); await svg.press("Escape");
    await editor.getByRole("button", { name: "新增入口", exact: true }).click(); await click(secondX + 2, bottom + 2);
    await journey.capture(page, `${surface}-guides-opposite-columns`);
    const save = page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true });
    await save.click(); await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 1); assert.equal(state.authoring.guides.length, 6);
    const row = state.layout.rows.find(row => row.label === "A"); assert.equal(row.slots.length, 8);
    const first = row.slots.slice(0, 4), second = row.slots.slice(4);
    for (const [slots, left, right] of [[first, firstX, rightX], [second, secondX, secondRight]]) {
      const sorted = [...slots].sort((a, b) => a.rect.y - b.rect.y);
      near(sorted[0].rect.y, top); near(sorted.at(-1).rect.y + sorted.at(-1).rect.height, bottom);
      for (const slot of sorted) { near(slot.rect.x, left); near(slot.rect.width, right - left); }
      for (let i = 1; i < sorted.length; i++) near(sorted[i].rect.y, sorted[i - 1].rect.y + sorted[i - 1].rect.height);
    }
    assert.ok(row.slots.find(slot => slot.code === "A01").rect.y < row.slots.find(slot => slot.code === "A04").rect.y);
    assert.ok(row.slots.find(slot => slot.code === "A05").rect.y > row.slots.find(slot => slot.code === "A08").rect.y);
    near(state.layout.accessPoints[0].x, secondX); near(state.layout.accessPoints[0].y, bottom);
    assert.equal(state.layout.rows.find(row => row.label === "H").orientation, "horizontal");
    assert.equal(Object.hasOwn(state.layout, "authoring"), false);
    // Reload each host surface to prove parent state and save/read wiring.
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await guides.waitFor(); assert.equal(await editor.locator("[data-guide-id]").count(), 6);
    await guides.selectOption(firstGuide); assert.equal(await editor.getByRole("checkbox", { name: "鎖定輔助線位置", exact: true }).isChecked(), true);
    await editor.getByRole("checkbox", { name: "鎖定輔助線位置", exact: true }).uncheck();
    await drag([firstX, height * .9], [firstX - width * .05, height * .9]);
    near(Number(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).inputValue()), firstX - width * .05);
    await undo.click(); await guides.selectOption(firstGuide);
    near(Number(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).inputValue()), firstX);
    await editor.getByRole("button", { name: "刪除輔助線", exact: true }).click();
    assert.equal(await editor.locator("[data-guide-id]").count(), 5); await undo.click();
    assert.equal(await editor.locator("[data-guide-id]").count(), 6);
    await editor.getByRole("checkbox", { name: "顯示輔助線", exact: true }).uncheck();
    assert.equal(await editor.locator("[data-guide-id]").count(), 0);
    await editor.getByRole("checkbox", { name: "顯示輔助線", exact: true }).check();
    await editor.getByRole("button", { name: "新增出口", exact: true }).click();
    await page.keyboard.down("Alt"); await click(secondX + 2, bottom + 2); await page.keyboard.up("Alt");
    const inspector = editor.getByRole("complementary", { name: "選取元素屬性" });
    near(Number(await inspector.getByRole("spinbutton", { name: "X", exact: true }).inputValue()), secondX + 2);
    await journey.capture(page, `${surface}-guide-reopen-and-alt`);
    assert.match(await picker.inputValue(), /^access:/);
    await undo.click(); // Remove the temporary Alt-placed exit.
    const boxes = async codes => Promise.all(codes.map(async code => {
      const rect = svg.getByText(code, { exact: true }).locator("..").locator("rect");
      return Object.fromEntries(await Promise.all(["x", "y", "width", "height"].map(async name => [name, Number(await rect.getAttribute(name))])));
    }));
    await placeGuide("x", width * .08);
    await picker.selectOption("slot:0:0");
    const centreX = (firstX + rightX) / 2, span = bottom - top;
    await page.keyboard.down("Shift"); await click(centreX, top + span * 3 / 8); await page.keyboard.up("Shift");
    const groupBefore = await boxes(["A01", "A02"]);
    await drag([centreX, top + span / 8], [centreX + width * .08 - firstX + 2, top + span / 8]);
    const groupAfter = await boxes(["A01", "A02"]);
    for (let i = 0; i < 2; i++) { near(groupAfter[i].x, width * .08); near(groupAfter[i].y, groupBefore[i].y); near(groupAfter[i].width, groupBefore[i].width); }
    near(groupAfter[1].y - groupAfter[0].y, groupBefore[1].y - groupBefore[0].y);
    await undo.click();
    const newBottom = bottom + height * .06;
    await placeGuide("y", newBottom);
    await editor.getByRole("button", { name: "新增排／排段", exact: true }).click();
    await click(centreX, top + span / 8);
    await drag([rightX, bottom], [rightX + 2, newBottom - 2]);
    const resized = await boxes(["A01", "A02", "A03", "A04"]);
    near(resized[0].x, firstX); near(resized[0].y, top);
    near(resized[3].y + resized[3].height, newBottom);
    for (let i = 1; i < 4; i++) near(resized[i].y, resized[i - 1].y + resized[i - 1].height);
    await svg.press("Escape"); await undo.click();
    // Resizing the canvas keeps its private construction coordinates aligned,
    // and a single undo restores both the canvas and the guides.
    await editor.getByRole("spinbutton", { name: "畫布寬", exact: true }).fill(String(width * 2));
    await editor.getByRole("spinbutton", { name: "畫布寬", exact: true }).press("Tab");
    await guides.selectOption(firstGuide);
    near(Number(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).inputValue()), firstX * 2);
    await undo.click();
    near(Number(await editor.getByRole("spinbutton", { name: "畫布寬", exact: true }).inputValue()), width);
    await guides.selectOption(firstGuide);
    near(Number(await editor.getByRole("spinbutton", { name: "輔助線 X", exact: true }).inputValue()), firstX);
    await journey.capture(page, `${surface}-group-and-segment-guide-snap`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
