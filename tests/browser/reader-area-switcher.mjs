// staged-data: fixture
//
// The sample fixture has the shape every event published since areas became
// derived from the organizer's booth list has: one venue space, several area
// codes, and no code among them that means "all of them". Before the reader
// supplied one itself, such an event opened filtered to whichever area sorted
// first, drew the rest of the hall as empty slots, and offered no way back to
// the whole thing.
//
// So the regression this journey catches is a reader who can see one block of a
// hall and cannot get out of it. It is asserted through the map rather than the
// result list because the empty slots are what makes the state look broken: a
// booth with nobody on it and a booth filtered away are drawn the same.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-area-switcher");
// The label wraps the select, so its text content carries the option labels
// too and only the accessible name is "展區". Scoped to the visible copy of
// the tools: the reader renders a second, aria-hidden one for the other
// breakpoint.
const areaSelect = (page) => page.locator("[data-map-tools]:not([aria-hidden])")
  .getByRole("combobox", { name: "展區", exact: true });
/** Booths carrying a circle: the layout draws every slot either way. */
const occupied = (page) => page.locator('[data-slot-code][role="button"]');
const codes = (page) => occupied(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.slotCode).sort());
const area = (page) => new URL(page.url()).searchParams.get("area");

try {
  const page = await journey.mapPage();

  assert.equal(area(page), "ALL", "an event nobody has filtered opens on all of its areas");
  assert.deepEqual(await codes(page), ["S01", "S02"], "day 1 has a booth in each area and both are on the map");
  assert.deepEqual(await areaSelect(page).locator("option").allTextContents(), ["全區", "北區", "南區"],
    "all areas leads the switcher, ahead of the derived codes");
  assert.equal(await areaSelect(page).inputValue(), "ALL");
  await journey.capture(page, "area-all");

  await areaSelect(page).selectOption({ label: "南區" });
  await page.waitForTimeout(250);
  assert.equal(area(page), "south", "a chosen area is shareable");
  assert.deepEqual(await codes(page), ["S02"], "and it is the only area left on the map");
  await journey.capture(page, "area-south");

  // The way back is the point: reaching a single area was never the bug.
  await areaSelect(page).selectOption({ label: "全區" });
  await page.waitForTimeout(250);
  assert.equal(area(page), "ALL");
  assert.deepEqual(await codes(page), ["S01", "S02"]);

  // A link someone shared from a single area still opens there, and the
  // switcher it lands on still offers the way out.
  const shared = await journey.mapPage({ params: "&area=north" });
  assert.deepEqual(await codes(shared), ["S01"]);
  assert.equal(await areaSelect(shared).inputValue(), "north");
  await areaSelect(shared).selectOption({ label: "全區" });
  await shared.waitForTimeout(250);
  assert.deepEqual(await codes(shared), ["S01", "S02"]);
  await journey.capture(shared, "area-shared-link-widened");

  await page.close();
  await shared.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
