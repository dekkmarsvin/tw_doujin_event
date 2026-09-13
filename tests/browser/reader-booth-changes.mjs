// staged-data: fixture
//
// Replaces the SSR markup assertions in `tests/circle-details-component.test.mjs`
// for the two placement states a reader can be standing in front of. A move and
// a cancellation look almost the same in the markup and are completely
// different errands: one sends the reader to another booth, the other tells
// them to stop walking. The failure worth catching is a moved booth that offers
// no way onward, or a cancelled one that pretends there is somewhere to go.
//
// The fixtures carry no retired booths, so each scenario restates the small
// fixture catalog rather than editing what the repository ships.
import assert from "node:assert/strict";
import { catalogRoute, start } from "./support/journey.mjs";

const CIRCLE = "c-900001";
const placement = (id, boothCode, status) => ({ id, circleId: CIRCLE, day: 1, area: "north", boothCode, status, tone: "mint" });
const detailOf = (page) => page.locator('aside[aria-label="已選社團詳情"]');

const journey = await start("reader-booth-changes");
try {
  {
    // The circle holds both booths on the same day: the retired one and the one
    // it can actually be found at.
    const page = await journey.mapPage({
      routes: catalogRoute("sample", (data) => { data.placements = [placement("1-s01", "S01", "moved"), placement("1-s02", "S02", "active")]; }),
    });
    await page.locator('[data-slot-code="S01"]').click();
    const detail = detailOf(page);
    await detail.waitFor();

    const text = await detail.innerText();
    assert.match(text, /已移動攤位/, "a moved booth says so");
    assert.match(text, /已改到.*S02/, "and says where the circle went");
    await journey.capture(page, "booth-moved-detail");

    // The way onward has to actually go there. A label that names the new booth
    // while leaving the reader on the retired one is the regression.
    await page.getByRole("button", { name: /看新攤位/ }).click();
    await page.waitForTimeout(400);
    assert.match(await detail.innerText(), /S02/, "following the move opens the new booth");
    assert.doesNotMatch(await detail.innerText(), /已移動攤位/, "the new booth is not itself retired");
    assert.match(page.url(), /selectedBooth=S02(&|$)/, "the shared URL points at the booth the reader can walk to");
    await journey.capture(page, "booth-moved-followed");
    await page.close();
  }

  {
    const page = await journey.mapPage({
      routes: catalogRoute("sample", (data) => { data.placements = [placement("1-s01", "S01", "cancelled")]; }),
    });
    await page.locator('[data-slot-code="S01"]').click();
    const detail = detailOf(page);
    await detail.waitFor();

    assert.match(await detail.innerText(), /已取消參展/, "a cancelled booth says so");
    // No destination exists, so offering one would send the reader to a booth
    // that is not there.
    assert.equal(await page.getByRole("button", { name: /看新攤位/ }).count(), 0, "a cancellation offers no onward booth");
    await journey.capture(page, "booth-cancelled-detail");
    await page.close();
  }

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
