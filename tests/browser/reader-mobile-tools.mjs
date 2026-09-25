// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-mobile-tools");
const events = (process.env.TOOLS_TEST_EVENTS || "sample").split(",");
journey.report.source = `local staged events: ${events.join(", ")}, not production`;
journey.report.matrix = [];

// Checking the button centre alone misses a date/venue control covering its edge.
async function assertReachable(locator) {
  const result = await locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hits = [0.16, 0.5, 0.84].flatMap((x) => [0.16, 0.5, 0.84].map((y) => {
      const top = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
      return { reachable: node.contains(top), covering: top?.tagName };
    }));
    return { text: node.textContent, box: box.toJSON(), hits };
  });
  assert.ok(result.hits.every((hit) => hit.reachable), `${result.text} is covered: ${JSON.stringify(result)}`);
  return result.box;
}

try {
  for (const event of events) {
    for (const [width, height] of [[360, 640], [390, 844], [760, 390], [1440, 900]]) {
      for (const scale of ["standard", "large", "extra"]) {
        const page = await journey.mapPage({ event, viewport: { width, height }, routes: (page) => page.addInitScript((value) => localStorage.setItem("event-map-text-scale", value), scale) });
        const mobile = width <= 760;
        const menu = page.locator("details");
        const summary = menu.locator("summary");
        if (mobile) {
          // The open work panel also shares the map's stacking environment.
          await page.getByRole("button", { name: "探索", exact: true }).click();
          await page.getByRole("button", { name: "完整展開工作面板", exact: true }).click();
          await assertReachable(page.getByRole("button", { name: "縮小工作面板", exact: true }));
          await summary.click();
        }
        const name = `tools-${event}-${width}-${height}-${scale}`;
        const data = page.getByRole("button", { name: "資料管理", exact: true });
        const help = page.getByRole("button", { name: "使用說明", exact: true });
        const dataRect = await assertReachable(data);
        const helpRect = await assertReachable(help);
        await journey.capture(page, `${name}-menu`);

        await help.click();
        const helpDialog = page.getByRole("dialog", { name: "使用說明", exact: true });
        const panelRect = await helpDialog.evaluate((node) => node.getBoundingClientRect().toJSON());
        assert.ok(panelRect.left >= 0 && panelRect.right <= width && panelRect.top >= 0 && panelRect.bottom <= height, "help stays inside the viewport");
        const helpClose = helpDialog.getByRole("button", { name: "關閉使用說明" });
        await assertReachable(helpClose);
        // The portal opens on the event this link names, not on its own fallback.
        assert.equal(await helpDialog.getByRole("link", { name: "社團專區", exact: true }).getAttribute("href"), `/circle?event=${event}`);
        await journey.capture(page, `${name}-help`);
        const about = helpDialog.getByText("本頁是非官方同人展逛攤工具，不代表活動主辦單位。", { exact: true });
        await about.scrollIntoViewIfNeeded();
        await assertReachable(about);
        await helpClose.scrollIntoViewIfNeeded();
        await helpClose.click();
        assert.equal(await helpDialog.count(), 0);
        assert.equal(await help.evaluate((node) => node === document.activeElement), true);

        await data.click();
        const dataDialog = page.getByRole("dialog", { name: "規劃資料管理", exact: true });
        await dataDialog.waitFor();
        const dataClose = dataDialog.getByRole("button", { name: "關閉規劃資料管理" });
        await assertReachable(dataClose);
        await journey.capture(page, `${name}-data`);
        await dataClose.click();
        assert.equal(await dataDialog.count(), 0);
        if (mobile) {
          if (!await menu.evaluate((node) => node.open)) await summary.click();
          await help.focus();
          await page.keyboard.press("Escape");
          assert.equal(await menu.evaluate((node) => node.open), false);
          assert.equal(await summary.evaluate((node) => node === document.activeElement), true);
          await assertReachable(page.getByRole("button", { name: "縮小工作面板", exact: true }));
          await summary.click();
          await page.getByRole("button", { name: "探索", exact: true }).click();
          assert.equal(await menu.evaluate((node) => node.open), false);
        }
        journey.report.matrix.push({ event, width, height, scale, dataRect, helpRect, panelRect, screenshots: ["menu", "help", "data"].map((state) => `${name}-${state}.png`) });
        await page.close();
      }
    }
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
