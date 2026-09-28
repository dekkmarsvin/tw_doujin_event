// staged-data: portal
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogRoute, overridesRoute, routes, start } from "./support/journey.mjs";
import { png } from "./support/png.mjs";

const CIRCLE = "c-900001";
const PREVIEW = "https://pictures.test/preview.jpg";
const FULL = "https://pictures.test/full.jpg";
const authored = (id = CIRCLE, index = 0) => ({ circleId: id, updatedAt: "2026-09-01T00:00:00+08:00", fields: {
  referencedWorks: ["原創", "賽馬娘"], ageRatings: ["全年齡", "R18"],
  catalogImages: [{ url: FULL, previewUrl: `${PREVIEW}?n=${index}`, width: 800, height: 1200 }],
} });
const sheetRoutes = async (page) => {
  await page.route("https://pictures.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png(640, 960, 0xe4) }));
};
const content = routes(overridesRoute("sample", [authored()]), sheetRoutes);
const browseNav = (page) => page.getByRole("navigation", { name: "閱讀方式" });
const ready = (page, count = 1) => page.getByRole("heading", { name: `${count} 個社團有品書`, exact: true }).waitFor();
const journey = await start("catalog-browse");
try {
  const page = await journey.page({ params: "&view=browse", routes: content });
  await ready(page);
  assert.equal(await page.locator("article").count(), 2);
  assert.equal(await page.getByRole("combobox", { name: "活動日期" }).inputValue(), "");
  const card = page.locator(`article[data-circle-id="${CIRCLE}"]`);
  assert.equal(await card.getByRole("link", { name: /在地圖查看/ }).count(), 2);
  await card.getByText("全年齡", { exact: true }).waitFor();
  await card.getByText("R18", { exact: true }).waitFor();
  await card.getByRole("button", { name: "收藏 北風畫室", exact: true }).click();
  await card.getByRole("button", { name: "取消收藏 北風畫室", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("event-map-planning-v1")).visitPlans.length), 0);
  // Existing detail search remains draft until applied, and closing restores focus.
  await page.getByRole("button", { name: /詳細搜尋/ }).click();
  const dialog = page.getByRole("dialog", { name: "詳細搜尋條件" });
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: /詳細搜尋/ }).evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press("Enter"); await dialog.waitFor();
  await dialog.getByRole("button", { name: "只看 R18", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has("r18"), false);
  await dialog.getByRole("button", { name: "套用搜尋", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("r18"), "include");
  await page.getByRole("button", { name: "全部清除", exact: true }).click();
  // Same-document view transitions and native history preserve public scope.
  await page.getByRole("combobox", { name: "活動日期" }).selectOption("2");
  await browseNav(page).getByRole("link", { name: "地圖", exact: true }).click();
  await page.locator("[data-slot-code]").first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("day"), "2");
  assert.equal(new URL(page.url()).searchParams.has("view"), false);
  await page.goBack(); await ready(page);
  assert.equal(await page.getByRole("combobox", { name: "活動日期" }).inputValue(), "2");
  await page.goForward(); await page.locator("[data-slot-code]").first().waitFor();
  await browseNav(page).getByRole("link", { name: "逛品書", exact: true }).click(); await ready(page);
  assert.equal(await page.getByRole("combobox", { name: "活動日期" }).inputValue(), "2");
  // A map selection must not leave its circle canonical on the browse view.
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  assert.equal(canonical, "https://map.kotoban.top/events/sample/");
  await journey.capture(page, "catalog-browse-desktop");
  for (const width of [390, 760, 761, 1050, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await journey.capture(page, `catalog-browse-${width}`);
  }
  // Circle page is a distinct document; its planning writes reappear on return.
  await card.getByRole("link", { name: /完整品書/ }).click();
  await page.getByRole("heading", { name: "本次品書", exact: true }).waitFor();
  await page.getByRole("button", { name: "加入這天行程（9月2日（三））", exact: true }).click();
  await page.goBack(); await ready(page);
  await card.getByRole("link", { name: /在地圖查看/ }).click();
  await page.locator("[data-slot-code]").first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("day"), "2");
  assert.equal(new URL(page.url()).searchParams.get("selectedCircle"), CIRCLE);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("event-map-planning-v1")).visitPlans[0].day), 2);
  await page.waitForFunction(() => document.querySelector('link[rel="canonical"]').href.includes("/circles/c-900001/"));
  await browseNav(page).getByRole("link", { name: "逛品書", exact: true }).click(); await ready(page);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://map.kotoban.top/events/sample/");
  assert.equal(await page.locator('meta[name="robots"][content*="noindex"]').count(), 0);
  await page.close();

  // Failed storage stays in the event owner, including undo and the export surface.
  const failedStorage = await journey.page({ params: "&view=browse", routes: async (target) => {
    await target.addInitScript(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === "event-map-planning-v1") throw new DOMException("full", "QuotaExceededError");
      return set.call(this, key, value);
    }; });
    await content(target);
  } });
  await ready(failedStorage);
  await failedStorage.getByRole("button", { name: "收藏 北風畫室", exact: true }).click();
  await browseNav(failedStorage).getByRole("link", { name: "地圖", exact: true }).click();
  await failedStorage.locator("[data-slot-code]").first().waitFor();
  await failedStorage.getByText("儲存異常，請開啟資料管理", { exact: true }).waitFor();
  await browseNav(failedStorage).getByRole("link", { name: "逛品書", exact: true }).click(); await ready(failedStorage);
  await failedStorage.getByRole("button", { name: "取消收藏 北風畫室", exact: true }).click();
  await browseNav(failedStorage).getByRole("link", { name: "地圖", exact: true }).click();
  await failedStorage.getByRole("button", { name: "復原收藏", exact: true }).click();
  await browseNav(failedStorage).getByRole("link", { name: "逛品書", exact: true }).click(); await ready(failedStorage);
  await failedStorage.getByRole("button", { name: "取消收藏 北風畫室", exact: true }).waitFor();
  await failedStorage.getByRole("button", { name: "資料管理", exact: true }).click();
  const download = failedStorage.waitForEvent("download");
  await failedStorage.getByRole("button", { name: "匯出 JSON", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(exported.planning.favorites[0].circleId, CIRCLE);
  await failedStorage.getByRole("button", { name: "關閉規劃資料管理", exact: true }).click();
  await journey.capture(failedStorage, "catalog-browse-storage-recovery");
  await failedStorage.close();

  let fail = true;
  const flaky = await journey.page({ params: "&view=browse", routes: async (target) => {
    await content(target);
    await target.route("**/overrides.json", (route) => fail ? route.fulfill({ status: 500, body: "unavailable" }) : route.fallback());
  } });
  await flaky.getByText("社團填寫的內容暫時無法讀取", { exact: true }).waitFor();
  assert.equal(await flaky.getByText("0 個社團有品書", { exact: true }).count(), 0);
  fail = false;
  await flaky.getByRole("button", { name: "重新讀取", exact: true }).click(); await ready(flaky);
  await flaky.close();
  let baseFail = true;
  const baseRetry = await journey.page({ params: "&view=browse", routes: async (target) => {
    await content(target);
    await target.route("**/circles.json", (route) => baseFail ? route.fulfill({ status: 503, body: "unavailable" }) : route.fallback());
  } });
  await baseRetry.getByText("活動資料暫時無法讀取", { exact: true }).waitFor();
  assert.equal(await baseRetry.getByText("0 個社團有品書", { exact: true }).count(), 0);
  baseFail = false;
  await baseRetry.getByRole("button", { name: "重新讀取", exact: true }).click(); await ready(baseRetry);
  await baseRetry.close();
  const broken = await journey.page({ params: "&view=browse", routes: async (target) => {
    await content(target);
    await target.route("https://pictures.test/**", (route) => route.abort());
  } });
  await broken.getByText("品書預覽暫時無法顯示，查看出展頁", { exact: true }).waitFor();
  await broken.getByRole("button", { name: "收藏 北風畫室", exact: true }).click();
  await broken.close();
  const empty = await journey.page({ params: "&view=browse", routes: overridesRoute("sample", []) });
  await ready(empty, 0);
  await empty.getByRole("heading", { name: "這場目前還沒有社團提供品書" }).waitFor();
  assert.equal(await empty.locator("article").count(), 2);
  await empty.getByRole("textbox", { name: "搜尋作品、題材或社團" }).fill("does-not-exist");
  await empty.getByRole("heading", { name: "沒有符合條件的社團" }).waitFor();
  await journey.capture(empty, "catalog-browse-empty");
  await empty.getByRole("button", { name: "全部清除", exact: true }).click(); await ready(empty, 0);
  await empty.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  });
  await empty.getByRole("button", { name: "分享", exact: true }).click();
  assert.match(await empty.getByRole("textbox", { name: /請複製分享文字與連結/ }).inputValue(), /view=browse/);
  await empty.close();

  const ids = Array.from({ length: 300 }, (_, index) => `c-${900001 + index}`);
  const counts = { base: 0, overlay: 0, preview: 0, full: 0 };
  const large = await journey.page({ params: "&view=browse&work=原創&favorite=1&favoriteGroup=private", viewport: { width: 390, height: 844 }, routes: async (target) => {
    target.on("request", (request) => {
      const url = request.url();
      if (url.includes("/circles.json")) counts.base++;
      if (url.includes("/overrides.json")) counts.overlay++;
      if (url.startsWith(PREVIEW)) counts.preview++;
      if (url === FULL) counts.full++;
    });
    await routes(catalogRoute("sample", (data) => {
      data.circles = ids.map((id, index) => ({ id, name: index === 0 ? "北風畫室" : index === 1 ? "很長的社團名稱需要完整換行顯示而不是被截斷的品書攤位" : `測試社團 ${index}` }));
      data.placements = ids.map((id, index) => ({ id: `p-${index}`, circleId: id, day: 1, area: "north", boothCode: `S${String(index + 1).padStart(3, "0")}`, status: "active", tone: "mint" }));
    }), overridesRoute("sample", ids.map((id, index) => authored(id, index))), sheetRoutes)(target);
  } });
  await ready(large, 300);
  assert.equal(await large.locator("article").count(), 24);
  assert.ok(counts.preview < 24, `first screen lazily loads images: ${counts.preview}`);
  assert.equal(counts.full, 0);
  journey.report.checks.push({ firstEntry: { ...counts } });
  await large.setViewportSize({ width: 1440, height: 900 });
  await journey.capture(large, "catalog-browse-300-desktop");
  await large.setViewportSize({ width: 390, height: 844 });
  // Sharing copies only public criteria and opens identically in a fresh context.
  await large.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copiedShare = text; } } });
  });
  await large.getByRole("button", { name: "分享", exact: true }).click();
  await large.getByText("已複製分享文字與連結。", { exact: true }).waitFor();
  const shared = await large.evaluate(() => window.__copiedShare.split("\n").at(-1));
  assert.equal(new URL(shared).searchParams.has("favorite"), false);
  assert.equal(new URL(shared).searchParams.has("favoriteGroup"), false);
  const fresh = await journey.page({ url: shared, routes: content }); await ready(fresh);
  assert.equal(new URL(fresh.url()).searchParams.get("work"), "原創"); await fresh.close();
  await large.getByRole("button", { name: /載入更多品書/ }).click();
  assert.equal(await large.locator("article").count(), 48);
  journey.report.checks.push({ afterMore: { ...counts } });
  // Keyboard activation avoids moving the viewport to the first link.
  await large.evaluate(() => window.scrollTo(0, 1300));
  await large.waitForFunction(() => history.state?.catalogBrowse?.y > 1000);
  const beforeY = await large.evaluate(() => scrollY);
  await large.locator(`article[data-circle-id="${CIRCLE}"] a`).first().evaluate((link) => link.click());
  await large.getByRole("heading", { name: "本次品書", exact: true }).waitFor();
  journey.report.checks.push({ circlePage: { ...counts } });
  await large.goBack(); await ready(large, 300);
  await large.waitForFunction((y) => Math.abs(scrollY - y) < 20, beforeY);
  assert.equal(await large.locator("article").count(), 48);
  journey.report.checks.push({ returned: { ...counts }, restoredY: await large.evaluate(() => scrollY) });
  await journey.capture(large, "catalog-browse-restored");
  await large.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
