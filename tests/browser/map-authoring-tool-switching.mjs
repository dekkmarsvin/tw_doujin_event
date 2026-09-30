// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
import { openSurface, openToolGroup } from "./support/map-authoring.mjs";
import { encodePng, ruledPlan } from "../support/map-recognition-fixture.mjs";

const journey = await start("map-authoring-tool-switching");
try {
  for (const surface of ["organizer", "circle"]) {
    for (const expanded of [false, true]) {
      // Experimental recognition is enabled only on the Organizer surface.
      const nextGroup = surface === "organizer" ? "辨識（實驗）" : "底圖與畫布";
      const { page, editor, state } = await openSurface(journey, surface, undefined, { background: Buffer.from(encodePng(ruledPlan())) });
      if (expanded) await page.getByRole("button", { name: "展開全視窗", exact: true }).click();
      const panel = editor.getByRole("group", { name: "配置圖辨識", exact: true });
      const canvas = editor.locator("svg[tabindex='0']");
      const picker = editor.getByRole("combobox", { name: "選取地圖元素" });
      await picker.selectOption("slot:0:0");
      await openToolGroup(editor, nextGroup);
      if (surface === "organizer") {
        assert.equal(await panel.getByRole("img", { name: "辨識草稿預覽" }).isVisible(), true, "first click opens the recognition image and controls");
        assert.equal(await panel.getByRole("button", { name: "辨識配置圖", exact: true }).isVisible(), true);
        assert.equal(await canvas.isVisible(), false);
      } else {
        assert.equal(await editor.getByRole("checkbox", { name: "顯示配置圖", exact: true }).isVisible(), true);
      }
      await editor.getByRole("button", { name: "選取", exact: true }).click();
      await canvas.waitFor({ state: "visible" }); // ResizeObserver refits the returning canvas.
      assert.equal(await picker.inputValue(), "slot:0:0", "mode switches preserve the selected map element");
      await openToolGroup(editor, "設施");
      await editor.getByRole("button", { name: "新增服務設施", exact: true }).click();
      await editor.getByRole("button", { name: "取消放置", exact: true }).waitFor();
      await openToolGroup(editor, nextGroup);
      assert.equal(await editor.getByRole("button", { name: "取消放置", exact: true }).count(), 0, "switching cancels pending facility placement");
      assert.equal(await editor.getByRole("button", { name: "新增服務設施", exact: true }).isVisible(), false);
      if (surface === "organizer") {
        assert.equal(await panel.getByRole("img", { name: "辨識草稿預覽" }).isVisible(), true);
        assert.equal(await editor.getByRole("complementary", { name: "選取元素屬性" }).isVisible(), false);
      }
      await journey.capture(page, `${surface}-${expanded ? "expanded" : "inline"}-${surface === "organizer" ? "recognition" : "background"}-after-facility`);
      await editor.getByRole("button", { name: nextGroup, exact: true }).click();
      await canvas.waitFor({ state: "visible" });
      assert.equal(await editor.getByRole("button", { name: "選取", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true, "switching tools does not mutate the draft");
      assert.equal(state.saves, 0);
      await page.close();
    }
  }
  await journey.finish();
} catch (error) { await journey.abort(error); throw error; }
