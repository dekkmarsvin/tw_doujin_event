// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";
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
  const { page, editor, state } = await openSurface(journey, "organizer", initial, { codes, authoring, background: Buffer.from(encodePng(ruledPlan())) });
  const panel = editor.getByRole("group", { name: "配置圖辨識", exact: true });
  const svg = editor.getByRole("img", { name: /^可編輯 SAMPLE 向量地圖/ });
  const booth = code => svg.locator(`[data-slot-code='${code}']`);
  await panel.getByRole("button", { name: "自動建立草稿（實驗）" }).click();
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
  assert.ok((await panel.getByRole("img").boundingBox()).width >= 400, "preview keeps a readable width");
  await page.setViewportSize({ width: 1600, height: 1100 });
  assert.equal(await booth("A01").count(), 0, "preview never changes the editor");
  assert.equal(state.saves, 0);
  await panel.getByRole("button", { name: "查看 A 排 · 16 攤", exact: true }).click();
  assert.notEqual(await panel.getByRole("img").getAttribute("viewBox"), "0 0 420 260");
  await panel.getByRole("checkbox", { name: "顯示推測編號" }).uncheck();
  assert.equal(await panel.getByRole("img").locator("text").count(), 0, "source numbers remain available for comparison");
  await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).check();
  await panel.getByRole("checkbox", { name: "已核對 B 排 · 16 攤", exact: true }).check();
  await journey.capture(page, "recognition-review");
  await panel.getByRole("button", { name: "採用已核對項目（2）" }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  assert.equal(await booth("Z01").count(), 1);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 1);
  await editor.getByRole("button", { name: "重做已復原的編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 A 排 · 16 攤", exact: true }).waitFor();
  assert.equal(await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole("checkbox", { name: "已核對 C 排 · 6 攤", exact: true }).isDisabled(), false);
  assert.ok(await panel.getByRole("checkbox", { name: "已核對 A 排 · 16 攤", exact: true }).getAttribute("aria-describedby"), "the disabled checkbox names its reason");
  await panel.getByText("A 排的 A01 已在地圖上；需要調整時請使用排段工具。", { exact: true }).waitFor();
  // A canvas edit retires the preview and says so instead of leaving the review prompt behind.
  // The locked guide runs over Z01's left side, so take hold of its right edge.
  const z01 = booth("Z01").locator("rect").first();
  await z01.click({ position: { x: (await z01.boundingBox()).width - 2, y: 4 } });
  await page.keyboard.press("ArrowRight");
  await panel.getByText("地圖已變更，請重新辨識。", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
  assert.equal(await svg.locator("[data-slot-code]").count(), 33);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  // Changing inputs discards old proposals, even though the map is unchanged.
  await panel.getByRole("textbox").fill("C01~C06");
  assert.equal(await panel.getByRole("button", { name: /採用已核對/ }).count(), 0);
  await panel.getByRole("button", { name: "框選辨識範圍" }).click();
  for (const [name, value] of [["左側", "190"], ["上緣", "10"], ["寬度", "140"], ["高度", "55"]]) await panel.getByRole("spinbutton", { name, exact: true }).fill(value);
  await panel.getByRole("button", { name: "辨識配置圖", exact: true }).click();
  await panel.getByRole("button", { name: "查看 C 排 · 6 攤", exact: true }).waitFor();
  await panel.getByRole("checkbox", { name: "已核對 C 排 · 6 攤", exact: true }).check();
  await panel.getByRole("button", { name: "採用已核對項目（1）" }).click();
  const rect = await booth("C01").locator("rect").evaluate(node => ({ x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")) }));
  assert.ok(rect.x >= 200 && rect.x < 320 && rect.y >= 20 && rect.y < 55, "cropped geometry returns to full-sheet coordinates");
  await page.getByRole("button", { name: "儲存地圖變更", exact: true }).click();
  await page.getByText("地圖已儲存，尚未公開。", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "自動建立草稿（實驗）" }).getAttribute("aria-expanded"), "true", "saving keeps the panel open");
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
  await journey.finish();
} catch (error) { await journey.abort(error); }
