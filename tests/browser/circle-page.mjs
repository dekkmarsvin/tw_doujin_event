// staged-data: portal
//
// A circle's introduction page as a reader meets it from a shared link: the
// circle's own content read live, planning that lands in the map's store on
// the right day, and the page still whole when that content cannot be read.
//
// It needs the built site — the page only exists once the discovery build has
// written it — so it runs on the local portal. The circle's content is served
// by intercepting the public overlay, as the other reader journeys do, so the
// scenarios need no sign-in and no claim.
import assert from "node:assert/strict";
import { base, overridesRoute, routes, start } from "./support/journey.mjs";
import { png } from "./support/png.mjs";

const TWO_DAYS = "c-900001"; // 北風畫室, S01 on both days
const ONE_DAY = "c-900002"; // 南星工房, S02 on day 1
const pageOf = (circleId) => new URL(`/events/sample/circles/${circleId}/`, base).toString();
// Sale-sheet pages are hosted over https, so the journey answers that origin
// itself: the first page arrives, the second never does.
const SHEET = "https://pictures.test/sheet-1.jpg";
const LOST_SHEET = "https://pictures.test/sheet-2.jpg";
const sheetRoutes = async (target) => {
  await target.route(SHEET, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png(1200, 850, 0xe4) }));
  await target.route(LOST_SHEET, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "gone" }));
};
const authored = [{
  circleId: TWO_DAYS,
  updatedAt: "2026-08-20T00:00:00.000+08:00",
  fields: {
    pen: "北風",
    // Long enough to be the tallest card beside the short ones.
    saleInfo: ["新刊 B5／32P 200 元", "會場限定明信片", ...Array.from({ length: 14 }, (unused, index) => `既刊第 ${index + 1} 冊 A5／20P 150 元`)].join("\n"),
    referencedWorks: ["原創"],
    ageRatings: ["全年齡", "R18"],
    links: [{ provider: "X", kind: "social", url: "https://example.com/northwind" }],
    catalogImages: [
      { url: SHEET, previewUrl: SHEET, width: 1200, height: 850 },
      { url: LOST_SHEET, previewUrl: LOST_SHEET, width: 1200, height: 850 },
    ],
  },
}];

const journey = await start("circle-page");
try {
  // 1. What the circle wrote, without opening the map or signing in.
  const page = await journey.page({ url: pageOf(TWO_DAYS), routes: routes(overridesRoute("sample", authored), sheetRoutes) });
  const content = page.getByRole("region", { name: "社團介紹" });
  await content.getByText("新刊 B5／32P 200 元", { exact: false }).waitFor();
  const text = await content.innerText();
  assert.match(text, /北風/, "the pen name is shown");
  assert.match(text, /全年齡\s*R18/, "every stated rating is shown");
  assert.match(text, /由社團填寫 · 最後更新 2026\.08\.20/, "with who wrote it and when");
  assert.equal(await content.getByRole("link", { name: /X/ }).getAttribute("href"), "https://example.com/northwind");

  // The sale sheet comes first, whole, with the page itself one tap away;
  // a page whose bytes never arrive says so and leaves the others standing.
  await content.getByRole("heading", { name: "本次品書", exact: true }).waitFor();
  const sheet = content.getByRole("img", { name: "北風畫室 品書第 1 張" });
  await sheet.waitFor();
  await page.waitForFunction((address) => [...document.images].some((image) => image.src === address && image.complete && image.naturalWidth > 0), SHEET);
  // The page itself opens the original; there is no separate link beside it.
  const sheetLink = content.getByRole("link", { name: "開啟原圖：北風畫室 品書第 1 張", exact: true });
  assert.equal(await sheetLink.getAttribute("href"), SHEET);
  assert.equal(await sheetLink.getByRole("img").count(), 1, "the link is the picture");

  // One scale: a section heading, then a card's title, never smaller than the
  // buttons under them; a short card is not stretched to a long one's height.
  const hierarchy = await page.evaluate(() => {
    const size = (node) => parseFloat(getComputedStyle(node).fontSize);
    const byText = (selector, value) => [...document.querySelectorAll(selector)].find((node) => node.textContent.trim() === value);
    const card = (title) => byText("h3", title).parentElement.getBoundingClientRect().height;
    return {
      section: size(byText("h2", "社團介紹")), card: size(byText("h3", "本次品書")), button: size(byText("button", "收藏社團")),
      sale: card("販售資訊"), details: card("作者與作品"),
    };
  });
  assert.ok(hierarchy.section > hierarchy.card && hierarchy.card >= hierarchy.button, `heading ${hierarchy.section} > card title ${hierarchy.card} >= button ${hierarchy.button}`);
  assert.ok(hierarchy.details < hierarchy.sale - 40, `the short card keeps its own height (${hierarchy.details}px beside ${hierarchy.sale}px)`);
  await content.getByText("第 2 張品書暫時無法顯示。", { exact: true }).waitFor();
  const firstHeading = await content.evaluate((section) => [...section.querySelectorAll("h3")].map((heading) => heading.textContent));
  assert.equal(firstHeading[0], "本次品書", "the sale sheet precedes the rest of the introduction");
  await journey.capture(page, "circle-page-desktop");

  // 2. Two days, so the reader picks one: each day's card carries its own plan
  //    action, and nothing is added for a day they did not choose.
  const cards = page.locator("li.booth-card");
  assert.equal(await cards.count(), 2, "one card per day");
  const dayButtons = page.getByRole("button", { name: /^加入這天行程（/ });
  assert.equal(await dayButtons.count(), 2, "one plan action per day the circle is there");
  assert.equal(await cards.nth(1).getByRole("button", { name: "加入這天行程（9月2日（三））", exact: true }).count(), 1, "the action sits on its own day's card");
  const bar = page.getByRole("group", { name: "收藏與分享" });
  await bar.getByRole("button", { name: "收藏社團", exact: true }).click();
  await cards.nth(1).getByRole("button", { name: "加入這天行程（9月2日（三））", exact: true }).click();
  await bar.getByText("已加入 9月2日（三）行程。", { exact: true }).waitFor();
  await cards.nth(1).getByRole("button", { name: "從這天行程移除（9月2日（三））", exact: true }).waitFor();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("event-map-planning-v1")));
  assert.deepEqual(stored.visitPlans.map(({ eventId, day, circleId }) => [eventId, day, circleId]), [["sample", 2, TWO_DAYS]], "the plan is keyed exactly as the map keys it, numeric day included");
  assert.deepEqual(stored.favorites.map(({ eventId, circleId }) => [eventId, circleId]), [["sample", TWO_DAYS]]);

  // An unfavourite can be taken back with its record intact.
  await bar.getByRole("button", { name: "取消收藏", exact: true }).click();
  await bar.getByRole("button", { name: "復原收藏", exact: true }).click();
  await bar.getByRole("button", { name: "取消收藏", exact: true }).waitFor();

  // Sharing without a share sheet copies the page's own address.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await bar.getByRole("button", { name: "分享", exact: true }).click();
  await bar.getByText("已複製連結。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), pageOf(TWO_DAYS));

  // 3. The map agrees: same store, the chosen day, the right booth.
  await page.getByRole("link", { name: "在地圖查看" }).nth(1).click();
  await page.locator("[data-slot-code]").first().waitFor();
  const map = new URL(page.url());
  assert.deepEqual([map.searchParams.get("day"), map.searchParams.get("selectedCircle"), map.searchParams.get("selectedBooth")], ["2", TWO_DAYS, "S01"]);
  const details = page.locator('aside[aria-label="已選社團詳情"]');
  await details.getByRole("button", { name: "從行程移除", exact: true }).waitFor();
  await details.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  await journey.capture(page, "circle-page-map-agrees");
  await page.close();

  // 4. One day only: one card, one plan action, nothing to pick. On a phone
  //    the favourite and share actions stay at the foot of the screen.
  const single = await journey.page({ url: pageOf(ONE_DAY), viewport: { width: 390, height: 844 }, routes: overridesRoute("sample", []) });
  await single.getByRole("button", { name: "加入這天行程（9月1日（二））", exact: true }).waitFor();
  assert.equal(await single.getByRole("button", { name: /^加入這天行程（/ }).count(), 1);
  const footBar = await single.getByRole("group", { name: "收藏與分享" }).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { position: getComputedStyle(node).position, bottom: Math.round(innerHeight - box.bottom) };
  });
  assert.deepEqual(footBar, { position: "fixed", bottom: 0 }, "the bar is pinned to the foot of a phone screen");

  // 4b. A bar grown taller — here by a storage warning above its buttons —
  //     still leaves the page's last line reachable above it.
  const cramped = await journey.page({
    url: pageOf(ONE_DAY),
    viewport: { width: 390, height: 844 },
    routes: routes(overridesRoute("sample", []), (target) => target.addInitScript(() => {
      localStorage.setItem("event-map-planning-v1", JSON.stringify({ schemaVersion: 1 }));
    })),
  });
  const crampedBar = cramped.getByRole("group", { name: "收藏與分享" });
  await crampedBar.getByRole("alert").waitFor();
  await cramped.waitForFunction(() => document.documentElement.style.getPropertyValue("--circle-action-bar-height") !== "");
  await cramped.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const overlap = await cramped.evaluate(() => {
    const bar = document.querySelector('[aria-label="收藏與分享"]').getBoundingClientRect();
    const last = [...document.querySelectorAll("footer a")].at(-1).getBoundingClientRect();
    return { barHeight: Math.round(bar.height), gap: Math.round(bar.top - last.bottom) };
  });
  assert.ok(overlap.barHeight > 120, `the warning makes the bar taller than the old fixed allowance (${overlap.barHeight}px)`);
  assert.ok(overlap.gap >= 0, `the footer's last link clears the bar (${overlap.gap}px)`);
  await journey.capture(cramped, "circle-page-mobile-tall-bar");
  await cramped.close();
  // Nothing written is nothing shown: no empty section, no placeholder picture.
  assert.equal(await single.getByRole("heading", { name: "社團介紹" }).count(), 0, "a circle that wrote nothing has no content section");
  await journey.capture(single, "circle-page-mobile-no-content");
  await single.close();

  // 5. A failed read is said as such, keeps the official facts, and recovers.
  let failing = true;
  const flaky = await journey.page({
    url: pageOf(TWO_DAYS),
    viewport: { width: 390, height: 844 },
    routes: routes(async (target) => {
      await target.route("**/data/events/sample/overrides.json", (route) => (failing
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "circle-overrides/1", eventId: "sample", generatedAt: "2026-01-01T00:00:00.000+08:00", revision: 1, overrides: authored }) })));
    }),
  });
  await flaky.getByText("社團介紹暫時無法顯示。").waitFor();
  assert.equal(await flaky.getByRole("link", { name: "在地圖查看" }).count(), 2, "the official placements stay");
  await journey.capture(flaky, "circle-page-overlay-failed");
  failing = false;
  await flaky.getByRole("button", { name: "重新讀取", exact: true }).click();
  await flaky.getByText("新刊 B5／32P 200 元", { exact: false }).waitFor();
  await flaky.close();

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
