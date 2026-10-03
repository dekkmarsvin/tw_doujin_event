import { openToolGroup } from "./support/map-authoring.mjs";
// staged-data: fixture
// Real shared editor through both control surfaces; synthetic API persistence.
// Authorization/version enforcement remains covered by handler and D1 tests.
import assert from "node:assert/strict";
import { PIXEL, start } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";

const journey = await start("map-authoring-placement");
journey.report.synthetic = true;
journey.report.productionWrites = 0;

try {
  for (const surface of ["organizer", "circle"]) {
    const { page, editor, state } = await openSurface(journey, surface);
    const svg = editor.locator("svg[tabindex='0']");
    const picker = editor.getByRole("combobox", { name: "選取地圖元素" });
    const count = () => picker.locator("option").count();
    const before = await count();
    const activate = async label => { await openToolGroup(editor, label === "排／排段" ? "攤位" : "設施"); await editor.getByRole("button", { name: `新增${label}`, exact: true }).click(); };
    const at = async (x, y) => { await svg.scrollIntoViewIfNeeded(); const b = await svg.boundingBox(); return { x: b.x + x * b.width, y: b.y + y * b.height }; };
    const click = async (x, y) => { const p = await at(x, y); await page.mouse.click(p.x, p.y); };
    const drag = async (from, to, cancel = false) => {
      const startingCount = await count();
      const a = await at(...from), b = await at(...to);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
      assert.equal(await count(), startingCount, "preview does not create a persistent element");
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
    };
    await activate("柱子");
    assert.equal(await count(), before);
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true);
    await drag([.25, .2], [.3, .3], true);
    assert.equal(await count(), before, "Escape during drag cancels creation");
    await activate("舞台"); await activate("出入口");
    assert.equal(await count(), before, "switching tools creates nothing");
    const cancelledPoint = await at(.4, .4);
    await page.mouse.move(cancelledPoint.x, cancelledPoint.y); await page.mouse.down();
    await svg.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await count(), before, "pointercancel creates nothing");
    await editor.getByRole("button", { name: "取消放置", exact: true }).click();
    await activate("柱子");
    await drag([.25, .2], [.3, .3]);
    assert.equal(await count(), before + 1);
    assert.match(await picker.inputValue(), /^pillar:/);
    assert.equal(await editor.getByRole("button", { name: "新增柱子", exact: true }).getAttribute("aria-pressed"), "false");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    assert.equal(await count(), before, "one undo removes the entire placement");
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true);
    await editor.getByRole("button", { name: "重做已復原的編輯" }).click();
    // An area has no size worth guessing: a click leaves the tool armed and
    // places nothing, and the outline has to be dragged.
    const beforeArea = await count();
    await activate("企業攤"); await click(.65, .25);
    assert.equal(await count(), beforeArea, "a click does not place a default-sized area");
    assert.equal(await editor.getByRole("button", { name: "新增企業攤", exact: true }).getAttribute("aria-pressed"), "true");
    await drag([.6, .2], [.7, .3]);
    assert.equal(await count(), beforeArea + 1);
    await activate("出入口"); await click(.75, .8);
    assert.match(await picker.inputValue(), /^access:/);
    // A service point is a click too; its type is chosen before placing and its
    // name is optional.
    await activate("服務設施");
    await editor.getByRole("status").getByRole("combobox", { name: "類型", exact: true }).selectOption({ label: "醫護站" });
    await click(.55, .8);
    assert.match(await picker.inputValue(), /^service:/);
    await editor.getByRole("textbox", { name: "名稱（選填）", exact: true }).fill("北側");
    for (const [type, x] of [["售票處", .35], ["更衣室", .4]]) {
      await activate("服務設施");
      await editor.getByRole("status").getByRole("combobox", { name: "類型", exact: true }).selectOption({ label: type });
      const previous = await count();
      await click(x, .8);
      assert.equal(await count(), previous + 1);
      assert.equal(await editor.getByRole("combobox", { name: "類型", exact: true }).inputValue(), type === "售票處" ? "ticket-office" : "changing-room");
      await editor.getByRole("button", { name: "復原上一步編輯" }).click();
      assert.equal(await count(), previous, `${type} placement is one undo step`);
      await editor.getByRole("button", { name: "重做已復原的編輯" }).click();
      assert.equal(await count(), previous + 1);
      await picker.selectOption(await picker.locator('option[value^="service:"]').last().getAttribute("value"));
    }
    await editor.getByRole("textbox", { name: "名稱（選填）", exact: true }).fill("簡易更衣室");
    await journey.capture(page, `${surface}-canvas-facility-placement`);
    if (surface === "circle") {
      // With unsaved changes 提交審閱 is held back by 儲存新版本; pressing it
      // leads there instead of doing nothing. Forced: Playwright will not
      // press an aria-disabled button, and that press is what is under test.
      await page.getByRole("button", { name: "提交審閱", exact: true }).click({ force: true });
      await page.waitForFunction(() => document.activeElement?.textContent === "儲存新版本");
      // The upload is held back by its empty fields: the press lands on the
      // first one and rings each that is still missing.
      await page.getByRole("button", { name: "上傳私人來源檔", exact: true }).click({ force: true });
      await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "date");
      assert.match(await page.getByLabel("來源檔", { exact: true }).getAttribute("class"), /calledOut/);
    }
    await page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true }).click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 1);
    const rect = state.layout.pillars.at(-1), region = state.layout.landmarks.at(-1).rect, point = state.layout.accessPoints.at(-1);
    const near = (value, expected) => assert.ok(Math.abs(value - expected) < .001, `${value} != ${expected}`);
    near(rect.x, source.width * .25); near(rect.y, source.height * .2);
    near(rect.width, source.width * .05); near(rect.height, source.height * .1);
    near(region.x + region.width / 2, source.width * .65); near(region.y + region.height / 2, source.height * .25);
    near(point.x, source.width * .75); near(point.y, source.height * .8); assert.equal(point.direction, "north");
    assert.equal(point.kind, "entrance"); assert.equal(point.label, "入口");
    const [service, tickets, changing] = state.layout.servicePoints.slice(-3);
    assert.equal(service.kind, "first-aid"); assert.equal(service.label, "北側");
    near(service.x, source.width * .55); near(service.y, source.height * .8);
    assert.equal(tickets.kind, "ticket-office"); assert.equal(tickets.label, undefined);
    near(tickets.x, source.width * .35); near(tickets.y, source.height * .8);
    assert.equal(changing.kind, "changing-room"); assert.equal(changing.label, "簡易更衣室");
    near(changing.x, source.width * .4); near(changing.y, source.height * .8);
    assert.deepEqual(state.layout.rows, source.rows, "facility placement preserves all booths");
    await page.reload();
    if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
    await editor.waitFor();
    await picker.selectOption(`service:${state.layout.servicePoints.length - 1}`);
    assert.equal(await editor.getByRole("combobox", { name: "類型", exact: true }).inputValue(), "changing-room");
    assert.equal(await editor.getByRole("textbox", { name: "名稱（選填）", exact: true }).inputValue(), "簡易更衣室", "saved service type and name reopen");
    await picker.selectOption(`service:${state.layout.servicePoints.length - 2}`);
    assert.equal(await editor.getByRole("combobox", { name: "類型", exact: true }).inputValue(), "ticket-office");
    // Returning from a facility tool to the existing continuous row/slot tools
    // must still place on release, preserve numbering, and cancel cleanly.
    await activate("舞台"); await activate("排／排段");
    await editor.getByRole("textbox", { name: "排標籤", exact: true }).fill("T");
    await editor.getByRole("textbox", { name: "結束編號", exact: true }).fill("2");
    const beforeRow = await count();
    await drag([.05, .03], [.1, .28]);
    assert.equal(await count(), beforeRow + 2);
    assert.equal(await editor.getByRole("textbox", { name: "起始編號", exact: true }).inputValue(), "3");
    await journey.capture(page, `${surface}-continuous-row-after-tool-switch`);
    await svg.press("Escape");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    assert.equal(await count(), beforeRow, "one undo removes the row segment");
    await openToolGroup(editor, "攤位");
    await editor.getByRole("button", { name: "手動畫攤位", exact: true }).click();
    await editor.getByRole("combobox", { name: "所屬排標籤", exact: true }).fill("T");
    await drag([.05, .03], [.1, .15], true);
    assert.equal(await count(), beforeRow, "manual slot cancellation leaves no element");
    for (const label of ["舞台", "其他區域"]) {
      await activate(label); await click(.45, .55);
      assert.equal(await count(), beforeRow, `a click places no ${label}`);
      await drag([.4, .5], [.5, .6]);
      assert.equal(await count(), beforeRow + 1);
      await editor.getByRole("button", { name: "復原上一步編輯" }).click();
      assert.equal(await count(), beforeRow);
    }
    for (const label of ["出入口", "服務設施"]) {
      await activate(label); await click(.45, .55);
      assert.equal(await count(), beforeRow + 1);
      await editor.getByRole("button", { name: "復原上一步編輯" }).click();
      assert.equal(await count(), beforeRow);
    }
    // The access tool keeps the type chosen for it, as the service tool does.
    await activate("出入口");
    await editor.getByRole("status").getByRole("combobox", { name: "類型", exact: true }).selectOption("both");
    await click(.45, .55);
    assert.equal(await editor.getByRole("textbox", { name: "顯示名稱", exact: true }).inputValue(), "出入口");
    assert.equal(await editor.getByRole("combobox", { name: "類型", exact: true }).inputValue(), "both");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    if (surface === "organizer") {
      // A plan still uploading when the canvas is cleared finishes on the
      // server, but must not put its image or its "已儲存" line back on the
      // blank canvas that replaced it.
      let release, uploading;
      const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { uploading = resolve; });
      await page.route("**/background", async route => {
        if (route.request().method() === "PUT") { uploading(); await gate; }
        await route.fallback();
      });
      const planInput = page.locator("input[type=file][accept*='image/png']");
      await planInput.setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: PIXEL });
      await started;
      // Uploads for one map share one stored object, so a second may not start
      // until the first has settled, or they could land in either order.
      assert.equal(await planInput.isDisabled(), true, "no second upload while one is in flight");
      await page.getByRole("button", { name: "空白畫布", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "清空重來", exact: true }).click();
      const uploaded = page.waitForResponse(response => response.url().endsWith("/background") && response.request().method() === "PUT");
      release(); await uploaded; await page.waitForTimeout(200);
      assert.equal(await svg.locator("image").count(), 0, "a stale upload does not bring its plan back");
      assert.equal(await page.getByText("配置圖已儲存。", { exact: true }).count(), 0, "a stale upload does not report itself");
      assert.equal(await planInput.isDisabled(), false, "the upload button returns once the upload settles");
    }
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
