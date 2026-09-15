// staged-data: fixture
import assert from "node:assert/strict";
import { start, overridesRoute } from "./support/journey.mjs";
const run = await start("mobile-circle-sheet");
try {
  for (const [width, height] of [[360,640],[390,844],[430,932],[760,844]]) {
    for (const scale of ["standard", "large", "extra"]) {
      const page = await run.mapPage({ viewport: { width, height }, routes: async (page) => {
        await overridesRoute("sample", [{ circleId: "c-900001", updatedAt: "2026-01-01T00:00:00.000+08:00", fields: { saleInfo: "原創插畫集與旅行主題明信片，歡迎到攤位翻閱。".repeat(40) } }])(page);
        await page.addInitScript((scale) => localStorage.setItem("event-map-text-scale", scale), scale);
      } });
      const dock = page.getByRole("complementary", { name: "行動版工作面板" });
      const level = () => page.locator("main").getAttribute("data-mobile-sheet-level");
      const handle = dock.locator('button[class*="mobileSheetHandle"]');
      await dock.getByRole("button", { name: "探索", exact: true }).click();
      await page.getByRole("button", { name: "S01 北風畫室", exact: true }).click();
      assert.equal(await level(), "half");
      const url = page.url();
      const transform = await page.locator(".floor").evaluate((el) => el.style.transform);
      const prefix = `sheet-${width}-${height}-${scale}`;
      await run.capture(page, `${prefix}-02-summary`);
      await handle.press("ArrowDown");
      assert.equal(await level(), "peek");
      assert.ok(await handle.isVisible());
      await run.capture(page, `${prefix}-01-collapsed`);
      const dragTo = async (height) => {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, height, { steps: 12 });
        await page.mouse.up();
      };
      // Real pointer input from the collapsed grab line, up through the middle detent.
      const halfHeight = await dock.locator("[data-half-measure]").evaluate((el) => el.getBoundingClientRect().height);
      await dragTo(height - halfHeight + 5);
      assert.equal(await level(), "half");
      await dragTo(height * .18 + 5);
      assert.equal(await level(), "full");
      if (width === 390 && scale === "standard") {
        const cdp = await page.context().newCDPSession(page);
        const box = await handle.boundingBox();
        const x = Math.round(box.x + box.width / 2);
        const y = Math.round(box.y + 5);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let step = 1; step <= 12; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (height - halfHeight + 5 - y) * step / 12 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        assert.equal(await level(), "half", "touch drags full details back to summary");
        await handle.click();
        assert.equal(await level(), "full");
        await cdp.detach();
      }
      await dock.locator('[data-embedded="true"]').waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await run.capture(page, `${prefix}-03-full`);
      await dock.getByRole("button", { name: "收藏社團", exact: true }).click();
      const notes = dock.getByPlaceholder("記下想買的刊物、預算或提醒");
      await notes.fill("想買的刊物");
      const scroll = dock.locator('[class*="mobilePanel"]').filter({ has: page.getByPlaceholder("記下想買的刊物、預算或提醒") });
      assert.ok(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight));
      await handle.press("ArrowDown");
      assert.equal(await level(), "half");
      await dock.getByRole("button", { name: "查看完整資訊", exact: true }).click();
      assert.equal(await level(), "full");
      assert.equal(await notes.inputValue(), "想買的刊物");
      await handle.press("ArrowDown");
      await handle.press("ArrowDown");
      assert.equal(await level(), "peek");
      assert.equal(page.url(), url);
      assert.equal(await page.locator(".floor").evaluate((el) => el.style.transform), transform);
      await page.close();
    }
  }
  const desktop = await run.mapPage();
  await desktop.getByRole("button", { name: "S01 北風畫室", exact: true }).click();
  await desktop.getByRole("button", { name: "開啟完整詳細資訊", exact: true }).click();
  const dialog = desktop.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).click();
  assert.equal(await desktop.getByRole("button", { name: "開啟完整詳細資訊", exact: true }).evaluate((el) => el === document.activeElement), true);
  await run.capture(desktop, "sheet-desktop-unchanged");
  await desktop.close();
  await run.finish();
} catch (error) { await run.abort(error); }
