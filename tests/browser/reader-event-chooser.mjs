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
const mapEntry = (event) => `開啟攤位地圖：${event.name}`;

const journey = await start("reader-event-chooser");
try {
  // A returning reader can receive new HTML with the previous public header
  // stylesheet: /site-header.css is stale-while-revalidate. That older sheet
  // predates the action group introduced alongside the language switcher.
  for (const width of [1440, 390, 360]) {
    const page = await journey.page({ event: "", viewport: { width, height: 844 }, routes: async (page) => {
      await page.route("**/site-header.css", async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).split("\n").filter((line) => !line.includes(".site-header-actions")).join("\n");
        await route.fulfill({ response, body });
      });
    } });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    const language = await page.getByRole("banner").getByRole("combobox", { name: "介面語言" }).evaluate((node) => node.closest("label").getBoundingClientRect().toJSON());
    const login = await page.getByRole("link", { name: "登入", exact: true }).evaluate((node) => node.getBoundingClientRect().toJSON());
    (journey.report.headerActions ??= []).push({ width, language, login });
    await journey.capture(page, `chooser-stale-header-styles-${width}`);
    assert.ok(login.left - language.right >= 8 - 0.5, "language and login retain space with the previous stylesheet");
    assert.ok(Math.abs(login.top - language.top) < 1 && Math.abs(login.bottom - language.bottom) < 1, "language and login share their top and bottom edges");
    await page.close();
  }

  {
    const page = await journey.page({ event: "", params: "" });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();

    // Each published event offers its map, catalog browse and static introduction.
    assert.equal(await page.getByRole("main").getByRole("link").count(), events.length * 3, "three destinations per published event");
    for (const [index, event] of events.entries()) {
      // Every entry names its event, so each card's links stay distinct out of context.
      const entry = page.getByRole("link", { name: mapEntry(event), exact: true });
      await entry.waitFor();
      assert.equal(await page.locator(`a[href="/events/${event.id}/"]`).count(), 1, `${event.id} has one introduction link`);
      assert.equal(await page.locator(`a[href="?event=${event.id}&view=browse"]`).count(), 1, `${event.id} has a browse link`);
      const summary = `${["2026.09.01–02", "2026.10.01–04"][index]} · ${event.venue}`;
      assert.equal(await page.getByRole("listitem").filter({ has: entry }).getByText(summary, { exact: true }).isVisible(), true, `${event.id} must show its exact calendar dates and pinned venue`);
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
    assert.equal(await page.getByRole("main").getByRole("link").count(), events.length * 3, "the list survives a dead link");
    assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex");
    await journey.capture(page, "chooser-refuses-unknown-event");
    await page.locator('a[href="?event=sample&view=browse"]').click();
    await page.getByRole("heading", { name: "範例創作市集 逛品書", exact: true }).waitFor();
    assert.equal(await page.locator('meta[name="robots"]').count(), 0);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://map.kotoban.top/events/sample/");
    // Browse follows the map header: with several events the name leads back to the chooser.
    await page.getByRole("link", { name: /切換活動/ }).click();
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    await page.close();
  }

  {
    // The point of the chooser: pressing an entry opens that event, not another.
    const page = await journey.page({ event: "" });
    await page.getByRole("link", { name: mapEntry(events[1]), exact: true }).click();
    await page.locator("[data-slot-code]").first().waitFor();
    assert.match(page.url(), new RegExp(`event=${events[1].id}(&|$)`), "the chosen event is the one that opens");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), `https://map.kotoban.top/events/${events[1].id}/`);
    assert.equal(await page.locator('meta[name="robots"]').count(), 0);
    // #363: a link copied from the open map still unfurls with the brand card,
    // at the absolute address the sharing platform will fetch.
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), "https://map.kotoban.top/share-card.png");
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute("content"), "summary_large_image");
    await journey.capture(page, "chooser-opens-the-chosen-event");
    await page.close();
  }

  {
    // #523: a Japanese browser lands in Japanese with no `lang` in the URL; event names stay as registered.
    const page = await journey.page({ event: "", locale: "ja-JP", viewport: { width: 390, height: 844 } });
    await page.getByRole("heading", { name: "イベントを選択" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), "ja");
    assert.equal(await page.getByRole("link", { name: `配置マップを開く：${events[0].name}`, exact: true }).count(), 1, "the event name is not translated");
    assert.doesNotMatch(page.url(), /lang=/, "a browser default writes nothing into the URL");
    await journey.capture(page, "chooser-ja-390");
    await page.close();
  }

  {
    // A link's language shows this visit; an explicit switch replaces the URL in
    // place, keeps what the page was showing and is remembered.
    const page = await journey.page({ event: "unknown-event", params: "&lang=en", viewport: { width: 1440, height: 900 } });
    await page.getByRole("heading", { name: "Choose an event" }).waitFor();
    // The English tagline is the longest: just above the phone layout it gives
    // way to the actions instead of running underneath them.
    await page.setViewportSize({ width: 421, height: 900 });
    const tagline = await page.getByRole("banner").getByText("Doujin event booth map", { exact: true }).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { right: Math.min(box.right, box.left + node.clientWidth), overflowing: node.scrollWidth > node.clientWidth };
    });
    const actions = await page.locator(".site-header-actions").boundingBox();
    assert.ok(tagline.right <= actions.x, `the tagline stops before the actions at 421px: ${JSON.stringify({ tagline, actions })}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    const history = await page.evaluate(() => window.history.length);
    await page.getByRole("banner").getByRole("combobox", { name: "Language" }).selectOption("ja");
    await page.getByRole("heading", { name: "イベントを選択" }).waitFor();
    assert.equal(new URL(page.url()).search, "?event=unknown-event&lang=ja", "only the language changes in the URL");
    assert.equal(await page.evaluate(() => window.history.length), history, "switching adds no history entry");
    assert.equal(await page.getByRole("status").count(), 1, "the dead-link notice is still shown");
    assert.equal(await page.getByRole("link", { name: "ログイン", exact: true }).getAttribute("href"), "/circle?lang=ja");
    await page.getByRole("link", { name: `配置マップを開く：${events[0].name}`, exact: true }).click();
    await page.locator("[data-slot-code]").first().waitFor();
    assert.match(page.url(), /[?&]lang=ja(&|$)/, "the language travels with the reader");
    assert.equal(await page.evaluate(() => document.documentElement.lang), "ja");
    await page.getByRole("searchbox", { name: "サークル・スペース・作品を検索" }).or(page.getByRole("textbox", { name: "サークル・スペース・作品を検索" })).first().waitFor();
    await page.goto(new URL("/?event=unknown-event", page.url()).href);
    await page.getByRole("heading", { name: "イベントを選択" }).waitFor({ timeout: 5000 });
    await page.getByRole("banner").getByRole("combobox", { name: "表示言語" }).selectOption("zh-Hant");
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    assert.doesNotMatch(page.url(), /lang=/, "Traditional Chinese needs no parameter");
    await journey.capture(page, "chooser-back-to-zh-1440");
    await page.close();
  }

  {
    // #524: typing in browse rewrites the URL; the language stays in it, even
    // when the trimmed query (and so the browse key) does not change.
    const page = await journey.page({ event: "sample", params: "&view=browse&lang=ja", viewport: { width: 390, height: 844 } });
    const search = page.getByRole("textbox", { name: "作品・ジャンル・サークルを検索" });
    await search.waitFor();
    await search.fill(" ");
    await search.press("End");
    assert.match(page.url(), /[?&]lang=ja(&|$)/, "a blank query keeps the language");
    await search.fill("S0");
    assert.match(page.url(), /[?&]lang=ja(&|$)/, "a query keeps the language");
    assert.match(await page.getByRole("link", { name: /^イベントを切り替え|範例創作市集/ }).first().getAttribute("href"), /lang=ja/, "the event link keeps the language for a new tab");
    await page.close();
  }

  // #439: what a first visit sees at the top, on the narrowest phone and a
  // desktop: "登入" as its own button, never a menu item, whole at every width,
  // and shown without the page asking the server who is reading.
  for (const width of [320, 390, 1440]) {
    const asked = [];
    const page = await journey.page({ event: "", params: "", viewport: { width, height: 800 }, routes: async (target) => {
      target.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) asked.push(new URL(request.url()).pathname); });
      // Signed out, so the portal this leads to has only its sign-in to show.
      await target.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "尚未登入。" } }));
    } });
    await page.getByRole("heading", { name: "選擇活動" }).waitFor();
    const header = page.getByRole("banner");
    const login = header.getByRole("link", { name: "登入", exact: true });
    assert.equal(await login.getAttribute("href"), "/circle", "the chooser names no event to sign in to");
    assert.equal(await header.getByRole("link", { name: /場刊 Map/ }).getAttribute("href"), "/", "the brand leads home");
    const box = await login.boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `登入 is whole and pressable at ${width}px: ${JSON.stringify(box)}`);
    assert.equal(await header.evaluate((node) => node.scrollWidth <= node.clientWidth), true, `the header never scrolls sideways at ${width}px`);
    assert.equal(await header.getByText("同人展逛攤地圖", { exact: true }).isVisible(), width > 420, "only the narrowest phones drop the tagline");
    assert.deepEqual(asked, [], "the header asks the server nothing");
    await journey.capture(page, `chooser-header-${width}`);
    if (width === 390) {
      // Keyboard: the brand, the language, then 登入, then the page — and Enter follows it.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.equal(await header.getByRole("combobox", { name: "介面語言" }).evaluate((node) => node === document.activeElement), true, "the language is the second stop");
      await page.keyboard.press("Tab");
      assert.equal(await login.evaluate((node) => node === document.activeElement), true, "登入 is the third stop");
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.pathname === "/circle");
      await page.getByRole("heading", { name: "登入", exact: true }).waitFor();
      assert.doesNotMatch(await page.getByRole("banner").innerText(), /\d{4}\.\d{2}/, "signed out, the sign-in names no event of its own");
      assert.equal(await page.getByRole("navigation", { name: "工作區" }).getByRole("link", { name: /^主辦工作區/ }).getAttribute("href"), "/organizer",
        "the sign-in names the organizer workspace before asking for an email");
    }
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
    await page.getByRole("link", { name: mapEntry(events[1]), exact: true }).click();
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
