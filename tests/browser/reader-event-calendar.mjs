// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-event-calendar");
try {
  for (const width of [1440, 360]) {
    for (const [date, groups] of [
      ["2026-08-25", ["upcoming"]],
      ["2026-09-01", ["upcoming", "ongoing"]],
      ["2026-09-15", ["upcoming", "past"]],
      ["2026-10-02", ["ongoing", "past"]],
      ["2026-10-05", ["past"]],
    ]) {
      const page = await journey.page({ event: "", viewport: { width, height: 844 }, routes: (page) => page.clock.setFixedTime(new Date(`${date}T12:00:00+08:00`)) });
      await page.getByRole("heading", { name: "選擇活動" }).waitFor();
      assert.deepEqual(await page.locator("[data-event-group]").evaluateAll((nodes) => nodes.map((node) => node.dataset.eventGroup)), groups);
      assert.deepEqual(await page.locator("main a b").allTextContents(), ["第二範例活動", "範例創作市集"]);
      const past = page.locator('[data-event-group="past"] a').first();
      if (await past.count()) {
        assert.equal(await past.isEnabled(), true);
        await past.focus();
        assert.equal(await past.evaluate((node) => node === document.activeElement), true);
      }
      await journey.capture(page, `calendar-${width}-${date}`);
      if (await past.count()) {
        await past.click();
        await page.locator("[data-slot-code]").first().waitFor();
        assert.match(page.url(), /event=sample/);
      }
      await page.close();
    }
  }

  // Leaving the chooser open across midnight must not leave yesterday's group.
  const midnight = await journey.page({ event: "", routes: (page) => page.clock.install({ time: new Date("2026-09-02T23:59:45+08:00") }) });
  await midnight.getByRole("heading", { name: "舉辦中", exact: true }).waitFor();
  await midnight.clock.fastForward(60_000);
  await midnight.getByRole("heading", { name: "過往活動", exact: true }).waitFor();
  await journey.capture(midnight, "calendar-midnight-refresh");
  await midnight.close();

  for (const width of [1440, 390]) {
    const page = await journey.mapPage({ viewport: { width, height: 900 } });
    if (width <= 760) {
      await page.getByRole("button", { name: "探索", exact: true }).click();
      await page.getByRole("button", { name: /^篩選攤位/ }).click();
    }
    const region = page.getByRole("region", { name: "社團內容詳細搜尋" }).filter({ visible: true });
    const trigger = region.getByRole("button", { name: /詳細搜尋/ });
    await trigger.scrollIntoViewIfNeeded();
    const layout = await region.evaluate((node) => {
      const favorite = node.parentElement.querySelector(".favorite-only").getBoundingClientRect();
      const button = node.querySelector("button").getBoundingClientRect();
      return { background: getComputedStyle(node).backgroundColor, left: button.left - favorite.left, right: button.right - favorite.right };
    });
    assert.equal(layout.background, "rgba(0, 0, 0, 0)");
    assert.ok(Math.abs(layout.left) < 1 && Math.abs(layout.right) < 1, "search aligns with the favorite control");
    await journey.capture(page, `search-surface-${width}`);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "詳細搜尋條件" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
