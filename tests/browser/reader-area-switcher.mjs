// staged-data: fixture
//
// The sample fixture has the shape every event published since areas became
// derived from the organizer's booth list has: one venue space and several area
// codes taken from that list. `pf45-rf14` published thirteen of them, each one
// row of one hall, and the reader opened filtered to whichever sorted first —
// the rest of the hall drawn as empty slots, with no way back to the whole
// thing.
//
// Two things are asserted here, and they are one decision seen from both sides:
// a reader inside a single hall sees all of it, and is offered no control for
// dividing it. Booth rows are not places a visitor navigates between, so a
// switcher listing them would be a control that does nothing. The area filter
// survives only where an event spans more than one venue space, which no
// fixture has; that case is covered in tests/event-url-state.test.mjs.
//
// It is asserted through the map because the empty slots are what made the old
// state look broken: a booth with nobody on it and a booth filtered away are
// drawn the same.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-area-switcher");
const tools = (page) => page.locator('[data-map-tools]:not([aria-hidden])');
/** Booths carrying a circle: the layout draws every slot either way. */
const codes = (page) => page.locator('[data-slot-code][role="button"]')
  .evaluateAll((nodes) => nodes.map((node) => node.dataset.slotCode).sort());
const area = (page) => new URL(page.url()).searchParams.get("area");

try {
  const page = await journey.mapPage();

  assert.equal(area(page), "ALL", "one hall has one reachable state: all of it");
  assert.deepEqual(await codes(page), ["S01", "S02"],
    "day 1 has a booth in each of the fixture's two area codes and both are on the map");
  assert.equal(await tools(page).getByRole("combobox", { name: "展區", exact: true }).count(), 0,
    "no area control, because there is nowhere for it to send the reader");
  await journey.capture(page, "area-single-space");

  // A link shared from the state this fixes still opens, and opens on the whole
  // hall rather than on the block it was captured in.
  const shared = await journey.mapPage({ params: "&area=north" });
  assert.equal(area(shared), "ALL");
  assert.deepEqual(await codes(shared), ["S01", "S02"]);
  await journey.capture(shared, "area-legacy-link-widened");

  await page.close();
  await shared.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
