// staged-data: fixture
import assert from "node:assert/strict";
import { overridesRoute, pictureRoute, routes, start, thumbnailOverride } from "./support/journey.mjs";

const journey = await start("reader-detail-height");
try {
  const long = thumbnailOverride("c-900002");
  long[0].fields.saleInfo = "作品介紹與販售資訊。".repeat(160);
  for (const width of [1440, 1024, 761]) {
    const page = await journey.mapPage({ viewport: { width, height: 900 }, routes: routes(overridesRoute("sample", long), pictureRoute(true)) });
    const rail = page.getByRole("complementary", { name: "已選社團詳情" });
    const choose = async (name) => {
      await page.getByRole("link", { name: new RegExp(name) }).first().click();
      await rail.waitFor();
    };
    await choose("北風畫室");
    const shortBox = await rail.boundingBox();
    const close = rail.getByRole("button", { name: "關閉攤位詳細資訊" });
    const closeY = (await close.boundingBox()).y;
    assert.ok(shortBox.height < 500, "short content does not fill the map height");
    assert.equal(await rail.getByRole("link", { name: "認領／管理資料" }).getAttribute("href"), "/circle?event=sample&circle=c-900001");
    await journey.capture(page, `detail-short-${width}`);
    await close.click();
    await choose("南星工房");
    const longBox = await rail.boundingBox();
    assert.ok(longBox.height > shortBox.height + 100, "long content expands the panel");
    assert.equal(longBox.y, shortBox.y, "top anchor stays fixed");
    assert.equal((await close.boundingBox()).y, closeY, "a picture does not displace the close button");
    const content = rail.getByRole("region", { name: "社團內容" });
    const geometry = await content.evaluate((node) => ({ client: node.clientHeight, scroll: node.scrollHeight }));
    assert.ok(geometry.scroll > geometry.client, "long content scrolls inside its own region");
    const floorBefore = await page.locator('.floor').getAttribute("style");
    await journey.capture(page, `detail-long-top-${width}`);
    await content.press("End");
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="社團內容"]');
      return region.scrollTop + region.clientHeight >= region.scrollHeight - 1;
    });
    assert.equal((await close.boundingBox()).y, closeY, "scrolling preserves the close target");
    assert.equal(await page.locator('.floor').getAttribute("style"), floorBefore, "detail scrolling does not reposition or zoom the map");
    assert.ok((await rail.getByRole("link", { name: "認領／管理資料" }).boundingBox()).y < longBox.y + longBox.height, "claim entry remains reachable at the end");
    await journey.capture(page, `detail-long-${width}`);
    await close.click();
    await choose("北風畫室");
    assert.equal((await rail.boundingBox()).height, shortBox.height, "returning to short content shrinks the panel again");
    await close.press("Escape");
    await rail.waitFor({ state: "hidden" });
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
