// staged-data: fixture
//
// Exercises published entries and unknown-event handling on the reader's first
// screen; calendar edge cases and the empty state remain in the component suite.
// What matters here is not that the markup
// contains a name, but that a reader arriving from a stale or mistyped link is
// told the link is dead and is left holding the list — and is never quietly
// dropped into a different event, which is the failure a catalogue link would
// cause silently.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start } from "./support/journey.mjs";

const fixture = async (eventId) => {
  const read = async (file) => JSON.parse(await readFile(new URL(`../../fixtures/events/${eventId}/${file}`, import.meta.url), "utf8"));
  const [event, references] = await Promise.all([read("event.json"), read("reference-records.json")]);
  const venue = references.find((record) => record.schema === "venue/1" && record.id === event.venueAssignments[0].venueId);
  assert.ok(venue, `${eventId} must have its own pinned venue reference`);
  return { ...event, venue: venue.name };
};
// Read from the fixtures rather than restated here, so adding a fixture event
// or renaming one cannot leave this journey asserting a name nobody ships.
const events = await Promise.all(["sample", "sample-two"].map(fixture));

const journey = await start("reader-event-chooser");
try {
  {
    const page = await journey.page({ event: "", params: "" });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();

    // Each published event offers its map and its static introduction.
    assert.equal(await page.getByRole("link").count(), events.length * 2, "two destinations per published event");
    for (const [index, event] of events.entries()) {
      const entry = page.getByRole("link", { name: new RegExp(event.name) });
      await entry.waitFor();
      assert.equal(await page.locator(`a[href="/events/${event.id}/"]`).count(), 1, `${event.id} has one introduction link`);
      const summary = `${["26.09.01-02", "26.10.01-04"][index]} · ${event.venue}`;
      assert.equal(await entry.getByText(summary, { exact: true }).isVisible(), true, `${event.id} must show its exact calendar dates and pinned venue`);
      assert.equal(await entry.getAttribute("href"), `?event=${encodeURIComponent(event.id)}`, `${event.id} must have its own addressable link`);
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
    assert.equal(await page.getByRole("link").count(), events.length * 2, "the list survives a dead link");
    assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex");
    await journey.capture(page, "chooser-refuses-unknown-event");
    await page.close();
  }

  {
    // The point of the chooser: pressing an entry opens that event, not another.
    const page = await journey.page({ event: "" });
    await page.getByRole("link", { name: new RegExp(events[1].name) }).click();
    await page.locator("[data-slot-code]").first().waitFor();
    assert.match(page.url(), new RegExp(`event=${events[1].id}(&|$)`), "the chosen event is the one that opens");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), `https://map.kotoban.top/events/${events[1].id}/`);
    assert.equal(await page.locator('meta[name="robots"]').count(), 0);
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
    await page.getByRole("link", { name: new RegExp(events[1].name) }).click();
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
