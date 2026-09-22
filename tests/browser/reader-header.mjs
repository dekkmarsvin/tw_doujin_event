// staged-data: pinned
// CI uses pinned FF47. To compare the two published events, stage --published
// and run against that server with HEADER_TEST_EVENTS=ff47,ch-20.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { start, output } from "./support/journey.mjs";

const events = (process.env.HEADER_TEST_EVENTS || "ff47").split(",");
const sizes = [[1706, 898], [1440, 900], [1024, 768], [761, 844], [760, 844], [390, 844], [360, 640]];
const scales = ["標準字級", "較大字級", "最大字級"];
const journey = await start("reader-header");
journey.report.source = `pinned events: ${events.join(", ")}`;
journey.report.matrix = [];
try {
  for (const event of events) {
    for (const [width, height] of sizes) {
      const page = await journey.mapPage({ event, viewport: { width, height } });
      for (const [index, scale] of scales.entries()) {
        if (width <= 760) await page.locator("summary").getByText("工具", { exact: true }).click();
        await page.getByRole("button", { name: scale, exact: true }).click();
        if (width <= 760) await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        const header = await page.locator(".topbar").evaluate((node) => {
          const rect = (el) => el?.getBoundingClientRect().toJSON();
          const h1 = node.querySelector("h1");
          const link = node.querySelector("a");
          const search = node.querySelector(".search");
          const scale = node.querySelector('[aria-label="網頁字體大小"]');
          const tools = Array.from(node.querySelectorAll("button")).filter((el) => ["資料管理", "使用說明"].includes(el.textContent));
          return {
            viewport: { width: innerWidth, height: innerHeight }, height: node.getBoundingClientRect().height,
            title: h1.textContent, titleRect: rect(h1), titleOverflow: h1.scrollWidth - h1.clientWidth,
            link: rect(link), search: rect(search), scale: rect(scale),
            toolHeights: tools.map((el) => el.getBoundingClientRect().height),
            toolRadii: tools.map((el) => getComputedStyle(el).borderRadius),
            scaleRadius: getComputedStyle(scale).borderRadius,
            meta: Array.from(node.querySelectorAll('[class*="eventMeta"] span')).map((el) => ({ text: el.textContent, box: rect(el), parent: rect(el.parentElement) })),
          };
        });
        assert.equal(header.titleOverflow, 0, "the event title is not clipped");
        if (header.link) {
          assert.ok(header.link.height >= 44);
          assert.ok(header.link.right <= header.search.left || header.link.bottom <= header.search.top, "the activity and search do not overlap");
        }
        if (width > 760) {
          assert.equal(header.meta.length, 2, "date and venue both remain visible");
          for (const item of header.meta) assert.ok(item.box.right <= item.parent.right + 1, `${item.text} fits its information row`);
          for (const height of header.toolHeights) assert.ok(Math.abs(header.scale.height - height) < 1, "tool exteriors share one height");
          for (const radius of header.toolRadii) assert.equal(radius, header.scaleRadius);
        }
        const name = `header-${event}-${width}-${height}-${index}`;
        await journey.capture(page, name);
        journey.report.matrix.push({ event, scale, screenshot: `${name}.png`, ...header });
      }
      await page.close();
    }
  }
  await writeFile(path.join(output, "header-matrix.json"), JSON.stringify(journey.report, null, 2));
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
