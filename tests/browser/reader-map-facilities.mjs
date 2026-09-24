// staged-data: pinned
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

// Entrances, exits, row and area names stay readable on the fitted map, the
// facility list locates them, and a double tap on the empty map zooms in.
const journey = await start("reader-map-facilities");
journey.report.source = "local pinned FF47, not production";
journey.report.measurements = [];
const settle = page => page.waitForTimeout(250);
const MINIMUM = { access: 11, service: 11, row: 12, landmark: 11 };
const MAXIMUM = { access: 14, service: 14, row: 28, landmark: 16 };

// Screen size of every drawn marker name, badge and area, in CSS px.
const markers = page => page.evaluate(() => {
  const svg = document.querySelector("svg[role=group]");
  const box = node => node.getBoundingClientRect().toJSON();
  // Names carry a class; a badge's own pictogram text (WC) does not.
  const labels = [...svg.querySelectorAll("[data-marker] text[class]")].map(text => {
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
// A point on the map's own background: no booth, plan, control or panel.
const emptyPoint = page => page.evaluate(() => {
  const map = document.querySelector(".map");
  const box = map.getBoundingClientRect();
  for (let y = box.top + box.height * .3; y < box.bottom - 40; y += 17) {
    for (let x = box.right - 30; x > box.left + 20; x -= 23) if (document.elementFromPoint(x, y) === map) return { x, y };
  }
  throw new Error("no empty map background on screen");
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

    // The empty background: a press there closes the list and hands focus back
    // to 設施; two quick presses zoom one step there.
    await trigger.click();
    await panel.waitFor();
    const outside = await emptyPoint(page);
    await page.mouse.click(outside.x, outside.y);
    await settle(page);
    assert.equal(await panel.count(), 0, "a press outside closes the list");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "設施", `${context}: a press outside that focuses nothing returns focus to the trigger`);
    await trigger.click();
    await panel.waitFor();
    await panel.getByRole("button", { name: "大會總部，區域", exact: true }).click();
    await settle(page);
    const empty = await emptyPoint(page);
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

  // On a short phone with the results open, the zoom column still clears the
  // date and venue tools, so 設施 stays pressable; opening it folds the sheet.
  for (const scale of ["standard", "extra"]) {
    const page = await journey.mapPage({ event: "ff47", viewport: { width: 360, height: 640 }, routes: async page => {
      await page.addInitScript(value => localStorage.setItem("event-map-text-scale", value), scale);
    } });
    await page.getByRole("button", { name: "探索", exact: true }).click();
    await settle(page);
    const trigger = page.getByRole("button", { name: "設施", exact: true });
    const reachable = await trigger.evaluate(node => {
      const box = node.getBoundingClientRect();
      return [box.top + 2, box.top + box.height / 2, box.bottom - 2].every(y => node.contains(document.elementFromPoint(box.left + box.width / 2, y)));
    });
    assert.equal(reachable, true, `360x640 ${scale}: nothing covers 設施 with the sheet open`);
    const tools = await page.locator("[data-map-tools]").first().evaluate(node => node.getBoundingClientRect().bottom);
    const column = await page.locator(".controls").evaluate(node => node.getBoundingClientRect().top);
    assert.ok(column >= tools, `360x640 ${scale}: the zoom column starts below the tools (${column} ≥ ${tools})`);
    await journey.capture(page, `facilities-360-${scale}-sheet`);
    await trigger.click();
    await page.getByRole("group", { name: "場內設施" }).waitFor();
    await settle(page);
    assert.equal(await page.locator("[data-mobile-sheet-level]").first().getAttribute("data-mobile-sheet-level"), "peek", "opening the list folds the sheet");
    const title = page.getByRole("heading", { name: "場內設施", exact: true });
    assert.equal(await title.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.left + 4, box.top + box.height / 2)); }), true, `360x640 ${scale}: the list is not covered by the tools`);
    await journey.capture(page, `facilities-360-${scale}-list`);
    await page.close();
  }

  // Service points published with the map: badges named by type, grouped in the
  // list, and located like any other facility.
  {
    const services = [
      { id: "toilet-south", kind: "toilet", x: 180, y: 1400 },
      { id: "toilet-north", kind: "toilet", x: 2150, y: 300, label: "女廁" },
      { id: "desk", kind: "information", x: 400, y: 500, label: "大會服務台" },
    ];
    const page = await journey.mapPage({ event: "ff47", viewport: { width: 1440, height: 900 }, routes: async page => {
      await page.route("**/data/events/ff47/map.json", async route => {
        const response = await route.fetch();
        const map = await response.json();
        map.layout.servicePoints = services;
        await route.fulfill({ response, json: map });
      });
    } });
    await page.getByRole("button", { name: "查看全場", exact: true }).click();
    await settle(page);
    const badges = await page.locator('[data-marker^="service:"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute("role"), node.getAttribute("aria-label"), Math.round(node.querySelector("rect").getBoundingClientRect().width)]));
    assert.deepEqual(badges, [["img", "廁所", 21], ["img", "女廁，廁所", 21], ["img", "大會服務台", 21]], "each service point is a badge named by its type");
    checkBounds(await markers(page), 1, "1440x900 service points fitted");
    await page.getByRole("button", { name: "設施", exact: true }).click();
    const panel = page.getByRole("group", { name: "場內設施" });
    await panel.waitFor();
    const group = panel.getByRole("group", { name: "服務設施" });
    assert.deepEqual(await group.getByRole("button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))), ["廁所", "女廁，廁所", "大會服務台"], "toilets are listed together, an unnamed one by its type");
    assert.match(await panel.getByRole("group", { name: "圖例" }).innerText(), /廁所[\s\S]*服務台/);
    await journey.capture(page, "facilities-service-points-list");
    await group.getByRole("button", { name: "女廁，廁所", exact: true }).click();
    await settle(page);
    assert.equal(await page.locator('[data-marker="service:toilet-north"] [class*="locatedRing"]').count(), 1, "the located service point is ringed");
    await journey.capture(page, "facilities-service-points-located");
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
