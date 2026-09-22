// staged-data: pinned
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-narrow-desktop");
journey.report.source = "local pinned FF47, not production";
journey.report.measurements = [];
const settle = page => page.waitForTimeout(200);
const measure = page => page.evaluate(() => {
  const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
  const text = selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return { size: parseFloat(style.fontSize), color: style.color, background: style.backgroundColor };
  };
  const map = rect(".map"), detail = rect('aside[aria-label="已選社團詳情"]');
  const tools = rect('[data-map-tools]:not([aria-hidden])'), controls = rect(".controls");
  return {
    map, detail, tools, controls, selected: rect('[data-layer="selected-slots"] [data-slot-code] rect'),
    transform: getComputedStyle(document.querySelector(".floor")).transform,
    safe: { width: detail.left - map.left - 32, height: controls.top - tools.bottom - 32 },
    metadata: text('[class*="placementMeta"]'), source: text('[class*="sourceSummary"] span'),
  };
});
const luminance = color => {
  const rgb = color.match(/[\d.]+/g).slice(0, 3).map(x => Number(x) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (color, background) => {
  const a = luminance(color), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

try {
  for (const [width, height] of [[761, 844], [1024, 768], [1050, 768], [1440, 900]]) {
    for (const scale of ["standard", "extra"]) {
      const narrow = width <= 1050;
      const page = await journey.mapPage({ event: "ff47", viewport: { width, height }, routes: async page => {
        await page.addInitScript(value => localStorage.setItem("event-map-text-scale", value), scale);
      } });
      const list = page.locator('#desktop-panel-explore [class*="resultList"]');
      await list.evaluate(node => { node.scrollTop = 350; });
      const scroll = await list.evaluate(node => node.scrollTop);
      assert.ok(scroll > 0);
      const buttons = list.locator('button[class*="resultMain"]');
      const index = await buttons.evaluateAll(nodes => nodes.findIndex(node => {
        const box = node.getBoundingClientRect(), list = node.closest('[class*="resultList"]').getBoundingClientRect();
        return box.top >= list.top && box.bottom <= list.bottom;
      }));
      assert.ok(index >= 0);
      const button = buttons.nth(index);
      await button.evaluate(node => node.focus({ preventScroll: true }));
      const before = await page.locator(".floor").evaluate(node => getComputedStyle(node).transform);
      await button.press("Enter");
      const back = page.getByRole("button", { name: "回搜尋", exact: true });
      const detail = page.locator('aside[aria-label="已選社團詳情"]');
      await detail.waitFor();
      await settle(page);
      const selected = await measure(page);
      assert.equal(selected.transform.split(",")[0], before.split(",")[0], "selection preserves zoom");
      assert.equal(await list.isVisible(), !narrow);
      assert.equal(await back.isVisible(), narrow);
      if (narrow) {
        assert.equal(selected.map.x, 0);
        assert.ok(selected.safe.width >= 360 && selected.safe.height >= 240, JSON.stringify(selected.safe));
        assert.equal(await back.evaluate(node => document.activeElement === node), true, "focus leaves the hidden search column");
      } else assert.equal(selected.map.x, 296, "wide desktop keeps its search column");
      assert.ok(selected.selected.left >= selected.map.left + 15 && selected.selected.right <= selected.detail.left - 15);
      assert.ok(selected.selected.top >= selected.tools.bottom + 15 && selected.selected.bottom <= selected.controls.top - 15);
      const minimumText = scale === "extra" ? 14.87 : 12;
      assert.ok(selected.metadata.size >= minimumText && selected.source.size >= minimumText);
      assert.ok(contrast(selected.metadata.color, "rgb(255, 255, 255)") >= 4.5);
      assert.ok(contrast(selected.source.color, "rgb(255, 250, 246)") >= 4.5);
      journey.report.measurements.push({ width, height, scale, ...selected });
      await journey.capture(page, `narrow-desktop-${width}-${scale}-selected`);

      await (narrow ? back : detail.getByRole("button", { name: "關閉攤位詳細資訊", exact: true })).click();
      await settle(page);
      assert.equal(await list.isVisible(), true);
      assert.equal(await list.evaluate(node => node.scrollTop), scroll);
      assert.equal(await button.evaluate(node => document.activeElement === node), true);
      assert.equal(new URL(page.url()).searchParams.get("selectedBooth"), null);
      assert.equal(await page.locator(".floor").evaluate(node => getComputedStyle(node).transform), selected.transform);
      if (narrow) {
        await page.goBack();
        await back.waitFor();
        await settle(page);
        assert.equal(await list.isVisible(), false, "history restores the selected layout");
        await page.getByRole("textbox", { name: "搜尋社團、攤位或作品" }).fill("Origin");
        await settle(page);
        assert.equal(await list.isVisible(), true, "typing a broader search reveals its results");
        await page.setViewportSize({ width: 1440, height: 900 });
        await settle(page);
        assert.equal(await list.isVisible(), true);
      }
      await page.close();
    }
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
