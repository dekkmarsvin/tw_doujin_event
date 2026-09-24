// staged-data: pinned
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

// Entrances, exits, row and area names stay readable on the fitted map, the
// facility list locates them, and a double tap on the empty map zooms in.
const journey = await start("reader-map-facilities");
journey.report.source = "local pinned FF47, not production";
journey.report.measurements = [];
const settle = page => page.waitForTimeout(250);
const MINIMUM = { access: 11, row: 12, landmark: 11 };
const MAXIMUM = { access: 14, row: 28, landmark: 16 };

// Screen size of every drawn marker name, badge and area, in CSS px.
const markers = page => page.evaluate(() => {
  const svg = document.querySelector("svg[role=group]");
  const box = node => node.getBoundingClientRect().toJSON();
  const labels = [...svg.querySelectorAll("[data-marker] text")].map(text => {
    const key = text.closest("[data-marker]").dataset.marker;
    return { key, kind: key.split(":")[0], text: text.textContent, px: parseFloat(getComputedStyle(text).fontSize) * text.getScreenCTM().a, box: box(text) };
  });
  const badges = [...svg.querySelectorAll('[data-marker^="access:"]')].map(group => ({
    label: group.getAttribute("aria-label"), shape: group.querySelector("circle, rect").tagName, size: box(group.querySelector("circle, rect")).width,
  }));
  // Area outlines and their name markers are drawn in the same order.
  const areas = [...svg.querySelectorAll('g[aria-label="非一般攤位區"] > g > rect')].map(box);
  const areaNames = [...svg.querySelectorAll('[data-marker^="landmark:"]')].flatMap((group, index) => group.querySelector("text") ? [{ name: box(group.querySelector("text")), area: areas[index] }] : []);
  return { labels, badges, areaNames, zoom: new DOMMatrix(getComputedStyle(document.querySelector(".floor")).transform).a, located: !!svg.querySelector('[class*="located"]') };
});
const overlapping = labels => {
  const pairs = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i].box, b = labels[j].box;
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) pairs.push([labels[i].text, labels[j].text]);
  }
  return pairs;
};
const checkBounds = (measured, scale, context) => {
  for (const label of measured.labels) {
    assert.ok(label.px >= MINIMUM[label.kind] * scale - .05, `${context}: ${label.text} is ${label.px}px`);
    assert.ok(label.px <= MAXIMUM[label.kind] * scale + .05, `${context}: ${label.text} is ${label.px}px`);
  }
  assert.deepEqual(overlapping(measured.labels), [], `${context}: names do not overlap`);
  for (const badge of measured.badges) assert.ok(Math.abs(badge.size - (badge.shape === "circle" ? 22 : 20)) < .5, `${context}: ${badge.label} badge is ${badge.size}px`);
  for (const { name, area } of measured.areaNames) assert.ok(name.left >= area.left - .5 && name.right <= area.right + .5, `${context}: an area name stays inside its area`);
};

try {
  for (const [width, height, scale, factor] of [[1440, 900, "standard", 1], [390, 844, "standard", 1], [1440, 900, "extra", 1.24]]) {
    const context = `${width}x${height} ${scale}`;
    const page = await journey.mapPage({ event: "ff47", viewport: { width, height }, routes: async page => {
      await page.addInitScript(value => localStorage.setItem("event-map-text-scale", value), scale);
    } });
    await page.getByRole("button", { name: "查看全場", exact: true }).click();
    await settle(page);
    const fitted = await markers(page);
    assert.deepEqual(fitted.badges.map(badge => [badge.label, badge.shape]), [
      ["活動出口，出口", "rect"], ["快速入場／貴賓入口，入口", "circle"], ["電子福袋入口 2，入口", "circle"], ["電子福袋入口，入口", "circle"], ["一般入口，入口", "circle"],
    ], "all five access points are drawn, entrances round and the exit square");
    checkBounds(fitted, factor, `${context} fitted`);
    assert.ok(fitted.labels.some(label => label.kind === "access") && fitted.labels.some(label => label.kind === "row"), `${context}: the fitted map names access points and rows`);
    journey.report.measurements.push({ context, state: "fitted", zoom: fitted.zoom, labels: fitted.labels.map(({ key, px }) => ({ key, px: +px.toFixed(2) })) });
    await journey.capture(page, `facilities-${width}-${scale}-fitted`);

    const trigger = page.getByRole("button", { name: "設施", exact: true });
    await trigger.click();
    const panel = page.getByRole("group", { name: "場內設施" });
    await panel.waitFor();
    await settle(page);
    const names = await panel.getByRole("button").evaluateAll(nodes => nodes.map(node => node.textContent));
    assert.deepEqual(names, ["活動出口", "快速入場／貴賓入口", "電子福袋入口 2", "電子福袋入口", "一般入口", "蜜瓜書店", "東域", "舞台", "虎之穴", "大會總部", "售票處", "其他區域"]);
    assert.equal(await panel.getByRole("button", { name: "活動出口", exact: true }).evaluate(node => node === document.activeElement), true, "opening moves focus to the first entry");
    assert.match(await panel.getByRole("group", { name: "圖例" }).innerText(), /企業攤/, "a shared name is explained in the legend");
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    await journey.capture(page, `facilities-${width}-${scale}-list`);
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await panel.count(), 0);
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true, "Escape returns focus to the trigger");

    const before = await markers(page);
    const url = page.url();
    await trigger.click();
    await panel.getByRole("button", { name: "大會總部，區域", exact: true }).click();
    await settle(page);
    const located = await markers(page);
    assert.equal(await panel.count(), 0, "choosing an entry closes the list");
    assert.equal(located.zoom, before.zoom, "locating keeps the zoom");
    assert.equal(page.url(), url, "locating leaves the URL alone");
    assert.equal(located.located, true, "the located area is outlined");
    const outline = await page.locator('svg [class*="locatedArea"]').evaluate(node => node.getBoundingClientRect().toJSON());
    const map = await page.locator(".map").evaluate(node => node.getBoundingClientRect().toJSON());
    assert.ok(outline.left >= map.left && outline.right <= map.right && outline.top >= map.top && outline.bottom <= map.bottom, `${context}: the located area is on screen`);
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await journey.capture(page, `facilities-${width}-${scale}-located`);

    // The empty paper beside the plan: two quick presses zoom one step there.
    const empty = { x: map.left + 20, y: (outline.top + outline.bottom) / 2 };
    await page.mouse.dblclick(empty.x, empty.y);
    await settle(page);
    const zoomed = await markers(page);
    assert.equal(zoomed.located, false, "the next map operation clears the outline");
    assert.ok(Math.abs(zoomed.zoom - (before.zoom + .1)) < .011, `${context}: a double tap zooms one step (${before.zoom} → ${zoomed.zoom})`);

    for (let step = 0; step < 40 && (await markers(page)).zoom < 5.999; step++) await page.getByRole("button", { name: "放大地圖", exact: true }).click();
    await settle(page);
    const close = await markers(page);
    assert.ok(close.zoom > 5.99);
    checkBounds(close, factor, `${context} 600%`);
    journey.report.measurements.push({ context, state: "600%", labels: close.labels.map(({ key, px }) => ({ key, px: +px.toFixed(2) })) });
    await page.close();
  }

  // A double tap on a booth still selects it and does not zoom.
  const page = await journey.mapPage({ event: "ff47", viewport: { width: 1440, height: 900 } });
  const booth = page.locator('[data-slot-code="A01"]');
  const zoom = (await markers(page)).zoom;
  const target = await booth.evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  await page.mouse.dblclick(target.x, target.y);
  await settle(page);
  assert.equal((await markers(page)).zoom, zoom, "a double tap on a booth does not zoom");
  assert.equal(new URL(page.url()).searchParams.get("selectedBooth"), "A01", "it selects the booth");
  await page.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
