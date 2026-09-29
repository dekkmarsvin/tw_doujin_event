// staged-data: fixture
import assert from "node:assert/strict";
import { catalogRoute, overridesRoute, routes, start } from "./support/journey.mjs";

const journey = await start("catalog-browse-scroll");
const content = routes(catalogRoute("sample", (data) => {
  data.circles = Array.from({ length: 383 }, (_, i) => ({ id: `c-${900001 + i}`, name: `文字社團 ${i}` }));
  data.placements = data.circles.map((circle, i) => ({ ...data.placements[0], id: `p-${i}`, circleId: circle.id }));
}), overridesRoute("sample", []));

try {
  for (const width of [390, 820]) {
    const page = await journey.page({ params: "&view=browse", viewport: { width, height: 844 }, routes: content });
    await page.locator("article").first().waitFor();
    await page.waitForFunction(() => history.state?.catalogBrowse);
    await page.evaluate(() => {
      const replace = history.replaceState.bind(history);
      window.historyWrites = 0;
      window.rejectCheckpoint = false;
      history.replaceState = (state, ...args) => {
        if (state?.catalogBrowse) {
          window.historyWrites++;
          if (window.rejectCheckpoint || window.historyWrites > 100) {
            throw new DOMException("History rate limit", "SecurityError");
          }
        }
        return replace(state, ...args);
      };
    });
    // Many scroll events followed by an observer-driven React update used to
    // throw from effect cleanup, removing the entire application.
    for (let count = 24; count < 383; count += 24) {
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        for (let i = 0; i < 120; i++) window.dispatchEvent(new Event("scroll"));
      });
      await page.waitForFunction((previous) => document.querySelectorAll("article").length > previous, count);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => history.state?.catalogBrowse?.textShown >= 383 && Math.abs(history.state.catalogBrowse.y - scrollY) < 2);
    assert.ok(await page.evaluate(() => window.historyWrites < 40), "scroll bursts must be coalesced");
    assert.equal(await page.locator("article").count(), 383);
    await journey.capture(page, `catalog-browse-scroll-${width}`);

    // Leaving immediately, before the debounce fires, still checkpoints the
    // current position and batch for same-document Back navigation.
    const y = await page.evaluate(() => {
      window.scrollTo(0, 1300);
      document.querySelector('nav[aria-label="閱讀方式"] a').click();
      return 1300;
    });
    await page.locator("[data-slot-code]").first().waitFor();
    await page.goBack();
    await page.waitForFunction((expected) => document.querySelectorAll("article").length === 383 && Math.abs(scrollY - expected) < 20, y);

    // A checkpoint can still be denied by browser policy or other history
    // users. Exercise both the delayed save and immediate navigation save.
    await page.evaluate(() => {
      window.rejectCheckpoint = true;
      window.scrollTo(0, 1500);
    });
    await page.waitForTimeout(650);
    assert.equal(await page.locator("article").count(), 383);
    await page.getByRole("combobox", { name: "活動日期" }).selectOption("1");
    await page.waitForFunction(() => scrollY === 0 && document.querySelectorAll("article").length === 24);
    await page.waitForTimeout(650);
    assert.equal(await page.locator("article").count(), 24);
    await page.locator("article button").first().click();
    assert.equal(await page.locator("article button").first().getAttribute("aria-pressed"), "true");
    journey.report.checks.push({ width, rendered: 383, checkpointWrites: await page.evaluate(() => window.historyWrites), rejectedCheckpointSurvived: true });
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
