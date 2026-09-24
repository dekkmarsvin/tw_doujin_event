// staged-data: pinned
// CI uses pinned FF47. To compare the two published events, stage --published
// and run against that server with HEADER_TEST_EVENTS=ff47,ch-20.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { start, output } from "./support/journey.mjs";

const events = (process.env.HEADER_TEST_EVENTS || "ff47").split(",");
const sizes = [[1706, 898], [1440, 900], [1024, 768], [761, 844], [760, 844], [390, 844], [360, 640], [320, 568]];
const scales = ["標準字級", "較大字級", "最大字級"];
const journey = await start("reader-header");
journey.report.source = `local staged events: ${events.join(", ")}, not production`;
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
            brandIcon: rect(node.querySelector(".brand>span")), brandTitle: rect(node.querySelector(".brand b")),
            event: rect(node.querySelector(".event")), toolsMenu: rect(node.querySelector("summary")),
            switch: rect(node.querySelector('[class*="eventSwitch"]')),
            toolHeights: tools.map((el) => el.getBoundingClientRect().height),
            toolRadii: tools.map((el) => getComputedStyle(el).borderRadius),
            scaleRadius: getComputedStyle(scale).borderRadius,
            meta: Array.from(node.querySelectorAll('[class*="eventMeta"] span')).map((el) => ({ text: el.textContent, box: rect(el), parent: rect(el.parentElement) })),
          };
        });
        assert.equal(header.titleOverflow, 0, "the event title is not clipped");
        if (width <= 760) {
          const centre = (box) => box.top + box.height / 2;
          assert.ok(Math.abs(centre(header.brandIcon) - centre(header.brandTitle)) < 1, "brand icon aligns with the title independently of event navigation");
          assert.equal(header.brandIcon.width, 34, "brand icon cannot shrink");
          assert.ok(header.brandTitle.right <= header.event.left && header.event.right <= header.toolsMenu.left, "event uses the space between brand and tools");
          assert.ok(header.event.top < header.brandIcon.bottom && header.event.top < header.toolsMenu.bottom, "event shares the first row with brand and tools");
          assert.ok(header.event.bottom <= header.search.top && header.toolsMenu.bottom <= header.search.top, "search follows the entire top row");
          if (header.switch) assert.ok(header.switch.right <= header.event.right && header.switch.bottom <= header.event.bottom, "switch prompt fits inside the event link, clear of tools");
          // Stress only layout: a wrapped name must not move the brand or
          // overlap search. Restore the staged name before interaction/screenshots.
          const wrapped = await page.locator(".topbar").evaluate((node) => {
            const title = node.querySelector("h1");
            const original = title.textContent;
            title.textContent = "長活動名稱換行驗證".repeat(12);
            const result = {
              icon: node.querySelector(".brand>span").getBoundingClientRect().toJSON(),
              title: node.querySelector(".brand b").getBoundingClientRect().toJSON(),
              event: node.querySelector(".event").getBoundingClientRect().toJSON(),
              name: title.getBoundingClientRect().toJSON(),
              nameOverflow: title.scrollWidth - title.clientWidth,
              tools: node.querySelector("summary").getBoundingClientRect().toJSON(),
              search: node.querySelector(".search").getBoundingClientRect().toJSON(),
              overflow: document.body.scrollWidth - innerWidth,
            };
            title.textContent = original;
            return result;
          });
          assert.equal(wrapped.icon.top, header.brandIcon.top, "wrapping event name does not move icon");
          assert.equal(wrapped.title.top, header.brandTitle.top, "wrapping event name does not move brand title");
          assert.ok(wrapped.name.height > header.titleRect.height, "stress name actually wraps");
          assert.equal(wrapped.nameOverflow, 0, "wrapped title is not clipped");
          assert.ok(wrapped.title.right <= wrapped.event.left && wrapped.name.right <= wrapped.tools.left, "long name stays between brand and tools");
          assert.ok(wrapped.event.bottom <= wrapped.search.top, "wrapped event remains above search");
          assert.equal(wrapped.overflow, 0, "wrapped event fits the viewport");
        }
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
