// staged-data: fixture
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-selection-close");
const selectionParams = ["selectedCircle", "selectedBooth"];
const view = (page) => page.locator(".floor").evaluate((node) => getComputedStyle(node).transform);
const settle = (page) => page.waitForTimeout(250);

try {
  for (const width of [1440, 390]) {
    const desktop = width > 760;
    const page = await journey.mapPage({ viewport: { width, height: 900 }, params: "&query=S01&selectedBooth=S01" });
    const panel = desktop ? page.locator('aside[aria-label="已選社團詳情"]') : page.getByRole("region", { name: "已選社團摘要" });
    const openFull = () => page.getByRole("button", { name: desktop ? "開啟完整詳細資訊" : "查看完整資訊", exact: true });
    const cancel = () => desktop ? panel.getByRole("button", { name: "關閉攤位詳細資訊", exact: true }) : page.getByRole("button", { name: "取消選取", exact: true });
    await panel.waitFor();
    await settle(page);
    const selectedUrl = page.url();
    const selectedView = await view(page);

    for (const method of desktop ? ["button", "escape", "backdrop"] : ["handle"]) {
      await openFull().click();
      if (!desktop) {
        await page.locator('[data-embedded="true"]').waitFor();
        await page.getByRole("button", { name: "縮小工作面板", exact: true }).press("ArrowDown");
        await panel.waitFor();
        assert.equal(page.url(), selectedUrl);
        continue;
      }
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      if (method === "button") await dialog.getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).click();
      else if (method === "escape") await page.keyboard.press("Escape");
      else await page.locator('[class*="fullDetailBackdrop"]').click({ position: { x: 2, y: 2 } });
      await dialog.waitFor({ state: "hidden" });
      await settle(page);
      assert.equal(await panel.isVisible(), true, "full detail returns to its original surface");
      assert.equal(page.url(), selectedUrl);
      assert.equal(await openFull().evaluate((node) => node === document.activeElement), true, `${width} ${method}: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0,200))}`);
    }

    await cancel().click();
    await settle(page);
    for (const name of selectionParams) assert.equal(new URL(page.url()).searchParams.get(name), null);
    assert.equal(new URL(page.url()).searchParams.get("query"), "S01");
    assert.equal(new URL(page.url()).searchParams.get("area"), "north");
    assert.equal(await view(page), selectedView, "cancel does not pan or zoom");
    assert.equal(await panel.count(), 0);
    assert.equal(await page.locator('[data-layer="selected-slots"] [data-slot-code]').count(), 0);
    assert.equal(await page.locator('[class*="mobilePeekSummary"]').count(), 0);
    if (desktop) assert.equal(await page.locator('[data-map-tools]:not([aria-hidden])').getByText("選取攤位查看社團", { exact: true }).count(), 1);
    await journey.capture(page, `selection-cancel-${width}`);

    await page.goBack();
    await panel.waitFor();
    assert.equal(new URL(page.url()).searchParams.get("selectedBooth"), "S01");
    await page.goForward();
    await panel.waitFor({ state: "hidden" });
    await page.reload();
    await page.locator('[data-slot-code="S01"]').waitFor();
    await settle(page);
    for (const name of selectionParams) assert.equal(new URL(page.url()).searchParams.get(name), null, "one matching result does not undo a cancellation after reload");
    assert.equal(await panel.count(), 0);

    // Select from the actual SVG, whose selected node moves to another layer.
    await page.locator('[data-slot-code="S01"]').focus();
    await page.keyboard.press("Enter");
    await panel.waitFor();
    await cancel().focus();
    await page.keyboard.press("Escape");
    await settle(page);
    assert.equal(await panel.count(), 0);
    assert.equal(new URL(page.url()).searchParams.get("selectedBooth"), null);
    if (desktop) {
      assert.equal(await page.locator('[data-slot-code="S01"]').evaluate((node) => node === document.activeElement), true);
      assert.equal(await page.locator('[data-map-tools]:not([aria-hidden])').getByText("選取攤位查看社團", { exact: true }).count(), 1);
    }
    await page.setViewportSize({ width: desktop ? 390 : 1440, height: 900 });
    await settle(page);
    assert.equal(await page.locator('aside[aria-label="已選社團詳情"],section[aria-label="已選社團摘要"]').count(), 0);
    await journey.capture(page, `selection-cancel-breakpoint-${width}`);
    await page.close();
  }
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
