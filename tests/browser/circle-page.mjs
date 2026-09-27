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
    saleInfo: "新刊 B5／32P 200 元\n會場限定明信片",
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
  assert.equal(await content.getByRole("link", { name: "開啟原圖" }).first().getAttribute("href"), SHEET);
  await content.getByText("第 2 張品書暫時無法顯示。", { exact: true }).waitFor();
  const firstHeading = await content.evaluate((section) => [...section.querySelectorAll("h3")].map((heading) => heading.textContent));
  assert.equal(firstHeading[0], "本次品書", "the sale sheet precedes the rest of the introduction");
  await journey.capture(page, "circle-page-desktop");

  // 2. Two days, so the reader picks one; nothing is added for a day they did
  //    not choose, and certainly not for "today".
  const planning = page.getByRole("region", { name: "收藏與行程" });
  const dayButtons = planning.getByRole("button", { name: /^加入 .*行程$/ });
  assert.equal(await dayButtons.count(), 2, "one plan action per day the circle is there");
  await planning.getByRole("button", { name: "收藏社團", exact: true }).click();
  await planning.getByRole("button", { name: "加入 9月2日（三）行程", exact: true }).click();
  await planning.getByText("已加入 9月2日（三）行程。", { exact: true }).waitFor();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("event-map-planning-v1")));
  assert.deepEqual(stored.visitPlans.map(({ eventId, day, circleId }) => [eventId, day, circleId]), [["sample", 2, TWO_DAYS]], "the plan is keyed exactly as the map keys it, numeric day included");
  assert.deepEqual(stored.favorites.map(({ eventId, circleId }) => [eventId, circleId]), [["sample", TWO_DAYS]]);

  // An unfavourite can be taken back with its record intact.
  await planning.getByRole("button", { name: "取消收藏", exact: true }).click();
  await planning.getByRole("button", { name: "復原收藏", exact: true }).click();
  await planning.getByRole("button", { name: "取消收藏", exact: true }).waitFor();

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

  // 4. One day only: the plan action names it and there is nothing to pick.
  const single = await journey.page({ url: pageOf(ONE_DAY), viewport: { width: 390, height: 844 }, routes: overridesRoute("sample", []) });
  const singlePlanning = single.getByRole("region", { name: "收藏與行程" });
  await singlePlanning.getByRole("button", { name: "加入 9月1日（二）行程", exact: true }).waitFor();
  assert.equal(await singlePlanning.getByRole("button", { name: /^加入 .*行程$/ }).count(), 1);
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
