// staged-data: portal
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { catalogRoute, output, overridesRoute, routes, start } from "./support/journey.mjs";
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
  // Circles without a sheet are counted once, in their own section's heading.
  await page.getByRole("heading", { name: "另有 1 個社團符合條件，但沒有提供品書", exact: true }).waitFor();
  assert.equal(await page.getByText(/沒有提供品書/).count(), 1);
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
  const firstControl = dialog.getByRole("combobox").first();
  const lastControl = dialog.getByRole("button", { name: "套用搜尋", exact: true });
  assert.equal(await firstControl.evaluate(node => node === document.activeElement), true, "opening moves focus into the dialog");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await lastControl.evaluate(node => node === document.activeElement), true, "reverse Tab wraps inside the dialog");
  await page.keyboard.press("Tab");
  assert.equal(await firstControl.evaluate(node => node === document.activeElement), true, "forward Tab wraps inside the dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
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

  // Phones switch views from the bottom bar: 探索 lands on the map at rest,
  // 行程 opens today's plan once, and the map's own 逛品書 comes back here.
  const phone = await journey.page({ params: "&view=browse", routes: content, viewport: { width: 390, height: 844 } });
  await ready(phone);
  const sheet = () => phone.locator("main.app-shell").getAttribute("data-mobile-sheet-level");
  assert.equal(await browseNav(phone).getByRole("link", { name: "逛品書", exact: true }).getAttribute("aria-current"), "page");
  await browseNav(phone).getByRole("link", { name: "行程", exact: true }).click();
  await phone.locator("[data-slot-code]").first().waitFor(); await phone.waitForTimeout(300);
  const dock = phone.getByRole("group", { name: "行動版工作區" });
  assert.equal(await dock.getByRole("button", { name: /^行程/ }).getAttribute("aria-pressed"), "true");
  assert.equal(await sheet(), "half", "行程 opens today's plan");
  assert.equal(await phone.evaluate(() => history.state?.readerMobilePanel), undefined, "the landing is used once");
  await journey.capture(phone, "catalog-browse-phone-plan");
  await dock.getByRole("link", { name: "逛品書", exact: true }).click(); await ready(phone);
  await browseNav(phone).getByRole("link", { name: "探索", exact: true }).click();
  await phone.locator("[data-slot-code]").first().waitFor(); await phone.waitForTimeout(300);
  assert.equal(await sheet(), "peek", "探索 returns to the map at rest");
  assert.equal(await dock.getByRole("button", { name: "探索", exact: true }).getAttribute("aria-pressed"), "true");
  await journey.capture(phone, "catalog-browse-phone-map");
  await phone.close();
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
  await failedStorage.getByRole("button", { name: "下載完整備份", exact: true }).click();
  // Playwright drops the download with its page, and the next page needs it.
  const backupPath = path.join(output, "planning-backup.json");
  await (await download).saveAs(backupPath);
  const exported = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(exported.planning.favorites[0].circleId, CIRCLE);
  await failedStorage.getByRole("button", { name: "關閉規劃資料管理", exact: true }).click();
  await journey.capture(failedStorage, "catalog-browse-storage-recovery");
  await failedStorage.close();

  // The backup carries the plan to another browser (#415): a fresh context
  // starts empty, previews the file, and only writes after 確認匯入.
  const otherDevice = await journey.page({ params: "&view=browse", routes: content });
  await ready(otherDevice);
  await otherDevice.getByRole("button", { name: "收藏 北風畫室", exact: true }).waitFor();
  await otherDevice.getByRole("button", { name: "資料管理", exact: true }).click();
  const chooser = otherDevice.waitForEvent("filechooser");
  await otherDevice.getByRole("button", { name: "匯入計畫…", exact: true }).click();
  await (await chooser).setFiles(backupPath);
  const preview = otherDevice.getByLabel("匯入預覽");
  await preview.getByText("收藏 1（新增 1）").waitFor();
  assert.equal(await otherDevice.evaluate(() => JSON.parse(localStorage.getItem("event-map-planning-v1") ?? "null")?.favorites?.length ?? 0), 0, "previewing writes nothing");
  await preview.getByRole("button", { name: "確認匯入", exact: true }).click();
  await otherDevice.getByText("已匯入：新增 1 筆。", { exact: true }).waitFor();
  await otherDevice.getByRole("button", { name: "關閉規劃資料管理", exact: true }).click();
  await otherDevice.getByRole("button", { name: "取消收藏 北風畫室", exact: true }).waitFor();
  await otherDevice.close();

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

  // Circles without a sheet load their next batch as the reader reaches the
  // end; a new scope starts again from the first batch at the top.
  const textIds = Array.from({ length: 60 }, (_, index) => `c-${900001 + index}`);
  const listed = await journey.page({ params: "&view=browse", routes: routes(catalogRoute("sample", (data) => {
    data.circles = textIds.map((id, index) => ({ id, name: index === 0 ? "北風畫室" : `文字社團 ${index}` }));
    data.placements = textIds.map((id, index) => ({ id: `p-${index}`, circleId: id, day: 1, area: "north", boothCode: `S${String(index + 1).padStart(3, "0")}`, status: "active", tone: "mint" }));
  }), overridesRoute("sample", [authored()]), sheetRoutes) });
  await ready(listed);
  const listedCards = () => listed.locator("article").count();
  const toEnd = () => listed.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.equal(await listedCards(), 25);
  await toEnd(); await listed.waitForFunction(() => document.querySelectorAll("article").length > 25);
  assert.equal(await listedCards(), 49, "one batch per arrival at the end");
  await toEnd(); await listed.waitForFunction(() => document.querySelectorAll("article").length === 60);
  assert.equal(await listed.getByRole("button", { name: "載入更多社團", exact: true }).count(), 0);
  await listed.getByRole("combobox", { name: "活動日期" }).selectOption("1"); await ready(listed);
  await listed.waitForFunction(() => scrollY === 0);
  await listed.waitForTimeout(300);
  assert.equal(await listedCards(), 25, "a new scope starts from the first batch");
  // A keyboard reader tabbing to the end reaches the button instead of
  // loading past it, and the button loads the next batch.
  const moreText = listed.getByRole("button", { name: "載入更多社團", exact: true });
  await listed.keyboard.press("Tab");
  await listed.locator("#without-catalog article").last().locator("a").last().focus();
  await listed.waitForTimeout(300);
  await listed.keyboard.press("Tab");
  assert.equal(await moreText.evaluate((button) => button === document.activeElement), true, "Tab reaches 載入更多社團");
  assert.equal(await listedCards(), 25, "keyboard focus near the end loads nothing ahead of the button");
  await listed.keyboard.press("Enter");
  await listed.waitForFunction(() => document.querySelectorAll("article").length === 49);
  await listed.close();

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
