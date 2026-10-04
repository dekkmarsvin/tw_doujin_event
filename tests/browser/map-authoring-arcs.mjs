// staged-data: fixture
import assert from "node:assert/strict";
import path from "node:path";
import { start, output } from "./support/journey.mjs";
import { openSurface, openToolGroup, source } from "./support/map-authoring.mjs";

const journey = await start("map-authoring-arcs");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
try {
  const layout = { ...structuredClone(source), width: 1000, height: 700, rows: source.rows.map(row => ({ ...row, slots: row.slots.map((slot, i) => ({ ...slot, rect: { x: 60 + i * 50, y: 620, width: 50, height: 30 } })) })) };
  const { page, editor, state } = await openSurface(journey, "organizer", layout);
  const svg = editor.locator("svg[tabindex='0']");
  const click = async (x, y) => { await svg.scrollIntoViewIfNeeded(); const bounds = await svg.boundingBox(); await page.mouse.click(bounds.x + bounds.width * x / 1000, bounds.y + bounds.height * y / 700); };
  const curve = editor.getByRole("button", { name: "最後 3 點連成弧線", exact: true });

  // A curved stair around a pillar: three clicks for its outer edge, three back
  // along its inner edge.
  await openToolGroup(editor, "設施");
  await editor.getByRole("combobox", { name: "多邊形類型", exact: true }).selectOption("other");
  await editor.getByRole("button", { name: "描繪多邊形", exact: true }).click();
  await click(340, 470); await click(500, 600); await click(660, 470);
  await curve.click();
  await click(580, 450); await click(500, 520); await click(420, 450);
  await curve.click();
  await editor.getByRole("button", { name: /^完成多邊形（\d+ 點）$/ }).click();
  const stairs = svg.locator("[data-shape-id]").last();
  assert.ok((await stairs.getAttribute("points")).split(" ").length > 20, "both edges are drawn as smooth arcs");
  journey.report.checks.push("six clicks and two presses draw a curved band");

  await openToolGroup(editor, "設施");
  await editor.getByRole("button", { name: "描繪多邊形", exact: true }).click();
  await click(100, 100); await click(200, 100); await click(300, 100);
  await curve.click();
  await editor.getByRole("alert").filter({ hasText: "同一直線" }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "完成多邊形（3 點）", exact: true }).count(), 1, "points on one line stay as clicked");
  await svg.press("Escape");
  await openToolGroup(editor, "設施");
  await editor.getByRole("button", { name: "描繪多邊形", exact: true }).click();
  await click(100, 30); await click(200, 40); await click(300, 30);
  await editor.getByRole("button", { name: "3 點畫成圓形", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "超出畫布" }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "完成多邊形（3 點）", exact: true }).count(), 1, "a circle that leaves the canvas keeps the clicked points");
  await svg.press("Escape");
  await openToolGroup(editor, "設施");
  await editor.getByRole("button", { name: "描繪多邊形", exact: true }).click();
  await click(150, 150); await click(200, 100); await click(250, 150);
  await editor.getByRole("button", { name: "3 點畫成圓形", exact: true }).click();
  await editor.getByRole("button", { name: "完成多邊形（48 點）", exact: true }).click();
  // A circle a unit or so across: rounding lands neighbours together, and the
  // repeats are dropped so it still completes.
  const areas = await svg.locator("[data-shape-id]").count();
  await openToolGroup(editor, "設施");
  await editor.getByRole("button", { name: "描繪多邊形", exact: true }).click();
  await click(800, 300); await click(801, 300); await click(800, 301);
  await editor.getByRole("button", { name: "3 點畫成圓形", exact: true }).click();
  await editor.getByRole("button", { name: /^完成多邊形（\d+ 點）$/ }).click();
  assert.equal(await svg.locator("[data-shape-id]").count(), areas + 1, "a tiny circle completes instead of being refused");
  journey.report.checks.push("points on one line or a circle off the canvas keep the clicks with a reason; three points can also make a circle");

  await openToolGroup(editor, "註記");
  await editor.getByRole("button", { name: "新增動線箭頭", exact: true }).click();
  await click(380, 560); await click(500, 580); await click(620, 520);
  await curve.click();
  await editor.getByRole("button", { name: /^完成箭頭（\d+ 點）$/ }).click();
  await editor.screenshot({ path: path.join(output, "organizer-arcs.png") });

  await page.getByRole("button", { name: "儲存地圖變更", exact: true }).click();
  assert.equal(state.saves, 1);
  const [band, circle, tiny] = state.layout.landmarks.slice(-3);
  assert.ok(band.rect.points.length > 20 && circle.rect.points.length === 48);
  assert.ok(tiny.rect.points.length < 48, "the tiny circle dropped the points rounding put together");
  assert.ok(state.layout.paths.at(-1).points.length > 3, "an arrow can bend along a curve");
  journey.report.checks.push("curved areas and a curved arrow save as ordinary vertices");
  await journey.finish();
} catch (error) { await journey.abort(error); }
