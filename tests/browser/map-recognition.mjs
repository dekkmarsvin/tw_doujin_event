import { openToolGroup } from "./support/map-authoring.mjs";
// staged-data: fixture
import assert from "node:assert/strict";
import path from "node:path";
import { start, output } from "./support/journey.mjs";
import { openSurface, source } from "./support/map-authoring.mjs";
import { encodePng, ruledPlan } from "../support/map-recognition-fixture.mjs";

const luminance = rgb => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };

const journey = await start("map-recognition");
try {
  const initial = { ...structuredClone(source), width: 420, height: 260, floor: { x: 0, y: 0, width: 420, height: 260 }, rows: [{ label: "Z", orientation: "horizontal", confidence: 1, slots: [{ code: "Z01", rect: { x: 10, y: 10, width: 12, height: 12 } }] }] };
  const codes = ["Z01", ...["A", "B", "C"].flatMap(label => Array.from({ length: label === "C" ? 6 : 16 }, (_, i) => `${label}${String(i + 1).padStart(2, "0")}`))];
  const authoring = { guides: [{ id: "g1", axis: "x", position: 12, locked: true }] };
  const { page, editor, state } = await openSurface(journey, "organizer", initial, { codes, authoring, failSaves: 1, background: Buffer.from(encodePng(ruledPlan())) });
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.recognitionRuns = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.recognitionRuns++; }
      set onmessage(callback) {
        super.onmessage = event => {
          if (window.holdRecognition) window.releaseRecognition = () => callback(event);
          else callback(event);
        };
      }
    };
  });
  await openToolGroup(editor, "辨識（實驗）");
  const panel = editor.getByRole("group", { name: "配置圖辨識", exact: true });
  const svg = editor.locator("svg[tabindex=\"0\"]");
  const booth = code => svg.locator(`[data-slot-code='${code}']`);
  const preview = panel.getByRole("group", { name: "辨識草稿預覽", exact: true });
  await panel.locator("summary").filter({ hasText: "辨識用攤位清單" }).click();
  assert.equal((await panel.getByRole("textbox").inputValue()).split("\n").length, 39);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 A 排 · 16 攤", exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "採用已核對項目（0）" }).isDisabled(), true);
  // The Organizer page darkens hovered buttons; this panel's text must stay readable on top.
  const runButton = panel.getByRole("button", { name: "辨識配置圖", exact: true });
  await runButton.hover();
  await page.waitForTimeout(250);
  const [fg, bg] = await runButton.evaluate(node => { const style = getComputedStyle(node); return [style.color, style.backgroundColor]; });
  assert.ok(contrast(fg, bg) >= 4.5, `hovered button text ${fg} on ${bg}`);
  await page.mouse.move(0, 0);
  // Beside the workspace sidebars a laptop-width window leaves the panel narrow; the preview stacks instead of shrinking.
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.ok((await preview.boundingBox()).width >= 400, "preview keeps a readable width");
  await page.setViewportSize({ width: 1600, height: 1100 });
  // With the booth list folded, the preview takes the recognition tool's spare height instead of a fixed 430px box.
  const listSection = panel.locator("summary").filter({ hasText: "辨識用攤位清單" });
  const captureReview = async name => {
    const opened = await listSection.evaluate(node => node.parentElement.open);
    if (opened) await listSection.click();
    await panel.screenshot({ path: path.join(output, name) });
    if (opened) await listSection.click();
  };
  await listSection.click();
  assert.ok((await preview.boundingBox()).height > 430, "preview grows with the recognition tool");
  await listSection.click();
  assert.equal(await booth("A01").count(), 0, "preview never changes the editor");
  assert.equal(state.saves, 0);
  await panel.getByRole("button", { name: "查看 A 排 · 16 攤", exact: true }).click();
  assert.notEqual(await preview.getAttribute("viewBox"), "0 0 420 260");
  await panel.getByRole("checkbox", { name: "顯示推測編號" }).uncheck();
  assert.equal(await preview.locator("[data-inferred-code]").count(), 0, "source numbers remain available for comparison");
  assert.match(await preview.locator("text").first().textContent(), /待核對/, "review status survives hiding inferred numbers");
  assert.equal(await panel.getByText(/Z 排尚缺/).count(), 0, "an existing manual row is not requested again");
  await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).check();
  assert.equal(await preview.locator('[data-choice="row:0"]').getAttribute("data-review-state"), "selected");
  assert.equal(await preview.locator('[data-choice="row:1"]').getAttribute("data-review-state"), "pending");
  await journey.capture(page, "recognition-review");
  await panel.getByRole("button", { name: "採用已核對項目（1）" }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 17);
  const checkedA = panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true });
  assert.equal(await checkedA.isDisabled(), true);
  assert.equal(await checkedA.isChecked(), true);
  assert.equal(await preview.locator('[data-choice="row:0"]').getAttribute("data-review-state"), "adopted");
  assert.equal(await preview.locator('[data-choice="row:1"]').getAttribute("data-review-state"), "pending");
  assert.equal(await panel.getByText(/A 排的 A01 已在地圖上/).count(), 0, "adoption progress is distinct from a conflict");
  await panel.getByRole("button", { name: "查看全圖", exact: true }).click();
  const pageScroll = await page.evaluate(() => scrollY);
  await preview.getByRole("button", { name: "定位 B 排 · 16 攤，待核對", exact: true }).locator("rect").first().click();
  const viewB = panel.getByRole("button", { name: "查看 B 排 · 16 攤", exact: true });
  assert.ok(await viewB.evaluate(node => node === document.activeElement));
  assert.equal(await panel.getByRole("checkbox", { name: "已核對 B 排 · 16 攤", exact: true }).isChecked(), false, "pointing does not confirm a row");
  assert.equal(await page.evaluate(() => scrollY), pageScroll, "pointing scrolls only the checklist");
  await preview.getByRole("button", { name: "定位 B 排 · 16 攤，待核對", exact: true }).focus();
  await page.keyboard.press("Space");
  assert.ok(await viewB.evaluate(node => node === document.activeElement), "keyboard pointing has the same destination");
  await page.getByRole("button", { name: "展開全視窗", exact: true }).click();
  await page.getByRole("button", { name: "返回地圖步驟", exact: true }).click();
  assert.equal(await checkedA.isDisabled(), true, "workspace size changes keep review progress");
  await panel.getByRole("button", { name: "查看全圖", exact: true }).click();
  await panel.getByRole("checkbox", { name: "已核對 B 排 · 16 攤", exact: true }).check();
  await journey.capture(page, "recognition-first-batch");
  await captureReview("recognition-progress-panel.png");
  const firstSaveGate = Promise.withResolvers();
  const heldSave = async route => {
    if (route.request().method() === "PATCH") await firstSaveGate.promise;
    await route.fallback();
  };
  await page.route("**/maps/test-map", heldSave);
  await page.getByRole("button", { name: "儲存地圖變更", exact: true }).click();
  const nextBatch = panel.getByRole("button", { name: "採用已核對項目（1）", exact: true });
  await panel.getByText("儲存或讀取配置圖中，辨識與採用暫停，請稍候。", { exact: true }).waitFor();
  assert.equal(await nextBatch.isDisabled(), true, "a selected remaining row cannot land during save");
  await nextBatch.evaluate(node => node.click());
  assert.equal(await svg.locator("[data-slot-code]").count(), 17);
  firstSaveGate.resolve();
  await page.getByText("save_failed", { exact: true }).waitFor();
  assert.equal(await nextBatch.isEnabled(), true, "failed saving restores adoption without rerunning recognition");
  assert.equal(await checkedA.isDisabled(), true, "failed saving keeps adopted progress");
  await page.unroute("**/maps/test-map", heldSave);
  await nextBatch.evaluate(node => { node.click(); node.click(); });
  assert.equal(await page.evaluate(() => window.recognitionRuns), 1, "two batches use one Worker run");
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  assert.equal(await booth("Z01").count(), 1);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 17);
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0, "undo retires remaining recognition results");
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 1);
  await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 17);
  await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 A 排 · 16 攤", exact: true }).waitFor();
  assert.equal(await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole("checkbox", { name: "已核對 C 排 · 6 攤", exact: true }).isDisabled(), false);
  assert.ok(await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).getAttribute("aria-describedby"), "the disabled checkbox names its reason");
  await panel.getByText("A 排的 A01 已在地圖上；需要調整時請使用排段工具。", { exact: true }).waitFor();
  assert.equal(await preview.locator('[data-choice="row:0"]').getAttribute("data-review-state"), "conflict");
  await captureReview("recognition-conflicts-panel.png");
  // Editing only an authoring guide also retires proposals; layout identity alone is insufficient.
  await openToolGroup(editor, "輔助線");
  await editor.getByRole("combobox", { name: "選取輔助線", exact: true }).selectOption("g1");
  await editor.getByRole("checkbox", { name: "鎖定輔助線位置", exact: true }).uncheck();
  await openToolGroup(editor, "辨識（實驗）");
  await panel.getByText("地圖已變更，請重新辨識。", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  // A delayed job is also retired by an edit outside the recognition panel.
  await page.evaluate(() => { window.holdRecognition = true; });
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await page.waitForFunction(() => !!window.releaseRecognition);
  await openToolGroup(editor, "輔助線");
  await editor.getByRole("combobox", { name: "選取輔助線", exact: true }).selectOption("g1");
  await editor.getByRole("checkbox", { name: "鎖定輔助線位置", exact: true }).uncheck();
  await page.evaluate(() => { window.releaseRecognition(); window.releaseRecognition = null; window.holdRecognition = false; });
  await openToolGroup(editor, "辨識（實驗）");
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  // A canvas edit retires the preview and says so instead of leaving the review prompt behind.
  // The locked guide runs over Z01's left side, so take hold of its right edge.
  await editor.getByRole("button", { name: "辨識（實驗）", exact: true }).click();
  const z01 = booth("Z01").locator("rect").first();
  await z01.click({ position: { x: (await z01.boundingBox()).width - 2, y: 4 } });
  await page.keyboard.press("ArrowRight");
  await openToolGroup(editor, "辨識（實驗）");
  await panel.getByText("地圖已變更，請重新辨識。", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  // An empty list holds the run back and takes the reader to the list, even when it is folded away.
  const list = panel.locator("summary").filter({ hasText: "辨識用攤位清單" });
  await panel.getByRole("textbox").fill("");
  await list.click();
  // Playwright will not press an aria-disabled button, and that press is what is under test.
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click({ force: true });
  await panel.getByText("請輸入要辨識的攤位代碼或範圍。", { exact: true }).waitFor();
  assert.ok(await panel.getByRole("textbox").evaluate(node => node === document.activeElement), "the held-back run points to the list");
  // Blocks the list does not name are offered as unmatched blocks, and folding the panel keeps them.
  await panel.getByRole("textbox").fill(codes.filter(code => !code.startsWith("C")).join("\n"));
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 未配對區塊 1 · 6 格", exact: true }).waitFor();
  assert.equal(await preview.locator('[data-unmatched="true"]').count(), 1);
  assert.match(await preview.locator('[data-unmatched="true"] text').last().textContent(), /未配對/);
  await captureReview("recognition-unmatched-panel.png");
  const toggle = editor.getByRole("button", { name: "辨識（實驗）", exact: true });
  await toggle.click();
  await toggle.click();
  await panel.getByRole("button", { name: "查看 未配對區塊 1 · 6 格", exact: true }).waitFor();
  assert.equal(await panel.getByRole("textbox").inputValue(), codes.filter(code => !code.startsWith("C")).join("\n"), "switching tools preserves the open list and its edits");
  assert.equal(await panel.getByText(/已加入 \d+ 項/).count(), 0, "success feedback does not survive changing tools");
  // Deliver an intentionally retained message even after termination, to test the generation gate.
  await page.evaluate(() => { window.holdRecognition = true; });
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await page.waitForFunction(() => !!window.releaseRecognition);
  await panel.getByRole("textbox").fill("C01~C06");
  await page.evaluate(() => { window.releaseRecognition(); window.releaseRecognition = null; window.holdRecognition = false; });
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0, "late replies cannot revive an invalidated report");
  // Changing inputs discards old proposals, even though the map is unchanged.
  await panel.getByRole("textbox").fill("C01~C06");
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await panel.getByRole("button", { name: "框選辨識範圍" }).click();
  await panel.getByText(/只保留範圍內的攤位/).waitFor();
  for (const [name, value] of [["左側", "190"], ["上緣", "10"], ["寬度", "140"], ["高度", "55"]]) await panel.getByRole("spinbutton", { name, exact: true }).fill(value);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  await panel.getByRole("checkbox", { name: "已核對 C 排 · 6 攤", exact: true }).check();
  await panel.getByRole("button", { name: "採用已核對項目（1）" }).click();
  const rect = await booth("C01").locator("rect").evaluate(node => ({ x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")) }));
  assert.ok(rect.x >= 200 && rect.x < 320 && rect.y >= 20 && rect.y < 55, "cropped geometry returns to full-sheet coordinates");
  const saveGate = Promise.withResolvers();
  await page.route("**/maps/test-map", async route => {
    if (route.request().method() === "PATCH") await saveGate.promise;
    await route.fallback();
  });
  await page.getByRole("button", { name: "儲存地圖變更", exact: true }).click();
  const adoption = panel.getByRole("button", { name: /採用已核對/ });
  assert.equal(await adoption.isDisabled(), true);
  await panel.getByText("儲存或讀取配置圖中，辨識與採用暫停，請稍候。", { exact: true }).waitFor();
  saveGate.resolve();
  await page.getByText("地圖已儲存，尚未公開。", { exact: true }).waitFor();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true", "saving keeps the panel open");
  assert.equal(state.saves, 1);
  assert.equal(state.layout.rows.flatMap(row => row.slots).length, 39);
  assert.deepEqual(state.authoring, authoring);
  assert.deepEqual(state.layout.rows[0], initial.rows[0]);
  await journey.capture(page, "recognition-adopted-saved");
  await page.reload();
  await page.getByRole("button", { name: "第一天", exact: true }).click();
  await booth("C01").waitFor();
  assert.equal(await svg.locator("[data-slot-code]").count(), 39);
  await journey.capture(page, "recognition-reopened");
  await page.close();

  // Real reports, not fabricated warning strings: a partially drawn missing
  // row and a matched row with one unrecognized booth both keep exact codes.
  for (const sparse of [false, true]) {
    const manualCode = sparse ? "A09" : "Z01";
    const manual = { ...structuredClone(initial), rows: [{ ...initial.rows[0], label: sparse ? "Other" : "Z", slots: [{ ...initial.rows[0].slots[0], code: manualCode }] }] };
    const remaining = sparse ? codes.filter(code => code !== "Z01") : [...codes.filter(code => code !== "Z01"), ...Array.from({ length: 50 }, (_, i) => `Z${String(i + 1).padStart(2, "0")}`)];
    const surface = await openSurface(journey, "organizer", manual, { codes: remaining, background: Buffer.from(encodePng(ruledPlan({ blankTopLeftOfA: sparse }))) });
    await openToolGroup(surface.editor, "辨識（實驗）");
    const review = surface.editor.getByRole("group", { name: "配置圖辨識", exact: true });
    await review.getByRole("button", { name: "辨識配置圖", exact: true }).click();
    await review.getByRole("button", { name: sparse ? "查看 A 排 · 15 攤" : "查看 A 排 · 16 攤", exact: true }).waitFor();
    if (sparse) {
      assert.equal(await review.getByText(/A 排尚缺/).count(), 0, "a missing slot already drawn under another row name is not requested again");
    } else {
      await review.locator("summary").filter({ hasText: "辨識提醒" }).click();
      const missing = await review.locator("li").filter({ hasText: "Z 排尚缺" }).textContent();
      assert.ok(!missing.includes("Z01"));
      assert.ok(missing.includes("Z02") && missing.includes("Z50"), "one existing slot does not hide its whole row");
    }
    await journey.capture(surface.page, sparse ? "recognition-existing-missing-slot" : "recognition-partial-row-reminder");
    if (!sparse) await review.screenshot({ path: path.join(output, "recognition-missing-panel.png") });
    await surface.page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
