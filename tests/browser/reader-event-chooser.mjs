// staged-data: fixture
//
// Replaces the SSR string assertions in `tests/event-chooser-component.test.mjs`
// with the reader's own first screen. What matters here is not that the markup
// contains a name, but that a reader arriving from a stale or mistyped link is
// told the link is dead and is left holding the list — and is never quietly
// dropped into a different event, which is the failure a catalogue link would
// cause silently.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start } from "./support/journey.mjs";

const fixture = async (eventId) => JSON.parse(await readFile(new URL(`../../fixtures/events/${eventId}/event.json`, import.meta.url), "utf8"));
// Read from the fixtures rather than restated here, so adding a fixture event
// or renaming one cannot leave this journey asserting a name nobody ships.
const events = await Promise.all(["sample", "sample-two"].map(fixture));

const journey = await start("reader-event-chooser");
try {
  {
    const page = await journey.page({ event: "", params: "" });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();

    // One entry per published event, and nothing else to press: an extra button
    // here is an unpublished event reaching a reader.
    assert.equal(await page.getByRole("button").count(), events.length, "one entry per published event");
    for (const event of events) {
      const entry = page.getByRole("button", { name: new RegExp(event.name) });
      await entry.waitFor();
      const text = await entry.innerText();
      assert.match(text, new RegExp(event.dateRangeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${event.id} must say when it is`);
      assert.ok(text.length > event.name.length, `${event.id} must offer more than a bare name`);
    }
    await journey.capture(page, "chooser-lists-published-events");
    await page.close();
  }

  {
    const unknown = "not-a-real-event-9z";
    const page = await journey.page({ event: unknown });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();

    // Said as status, not colour: a reader who cannot see the panel at all has
    // to be told the link failed.
    const status = page.getByRole("status");
    assert.equal(await status.count(), 1, "the dead link is reported once, as a status");
    assert.match(await status.innerText(), /目前無法開啟/, "the reader is told the link cannot be opened");

    // Naming the id back invites reading it as a real event, and echoing an
    // arbitrary URL parameter into the page is how that text becomes a vector.
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), new RegExp(unknown), "the unknown id is not echoed to the reader");
    assert.ok(!(await page.content()).includes(unknown), "the unknown id does not reach the markup either");

    // The way forward is still the list, and it is still only the real events.
    assert.equal(await page.getByRole("button").count(), events.length, "the list survives a dead link");
    await journey.capture(page, "chooser-refuses-unknown-event");
    await page.close();
  }

  {
    // The point of the chooser: pressing an entry opens that event, not another.
    const page = await journey.page({ event: "" });
    await page.getByRole("button", { name: new RegExp(events[1].name) }).click();
    await page.locator("[data-slot-code]").first().waitFor();
    assert.match(page.url(), new RegExp(`event=${events[1].id}(&|$)`), "the chosen event is the one that opens");
    await journey.capture(page, "chooser-opens-the-chosen-event");
    await page.close();
  }

  for (const width of [1440, 390]) {
    const page = await journey.mapPage({ viewport: { width, height: 844 }, params: "&query=S01&selectedBooth=S01" });
    await page.waitForTimeout(250);
    const original = page.url();
    const switchBox = await page.getByRole("link", { name: /切換活動/ }).boundingBox();
    assert.ok(switchBox.height >= 44, "the event name offers a full-height press target");
    await page.getByRole("link", { name: /切換活動/ }).click();
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    assert.equal(new URL(page.url()).search, "", "switching returns to a clean chooser");
    await page.goBack();
    await page.locator("[data-slot-code]").first().waitFor();
    await page.waitForTimeout(250);
    assert.equal(page.url(), original, "Back restores the original event and selection");
    await page.goForward();
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    await page.getByRole("button", { name: new RegExp(events[1].name) }).click();
    await page.locator("[data-slot-code]").first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get("event"), events[1].id);
    for (const name of ["query", "selectedCircle", "selectedBooth"]) assert.equal(new URL(page.url()).searchParams.get(name), null, `${name} does not cross events`);
    await journey.capture(page, `chooser-switches-without-stale-state-${width}`);
    await page.close();
  }

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
