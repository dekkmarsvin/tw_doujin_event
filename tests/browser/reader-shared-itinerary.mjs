// staged-data: fixture
// A short link opened on another device (#415): adding it closes the preview,
// and the desktop 行程、收藏與顯示 settings are reachable in the rail.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-shared-itinerary");
const PLAN_KEY = "event-map-planning-v1";
const shareId = "A".repeat(22);
const snapshot = { version: 1, eventId: "sample", items: [{ circleId: "c-900001", day: 1 }, { circleId: "c-900002", day: 1 }] };
const routes = (page) => page.route(`**/api/shares/${shareId}`, (route) => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ snapshot, expiresAt: Date.now() + 86400000 }),
}));

try {
  const page = await journey.mapPage({ params: `&day=1&share=${shareId}`, routes });
  const preview = page.getByRole("dialog", { name: "分享的行程" });
  await preview.getByRole("button", { name: "加入我的行程", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PLAN_KEY);
  assert.deepEqual(stored.visitPlans.map((entry) => entry.circleId).sort(), ["c-900001", "c-900002"]);
  assert.ok(!page.url().includes("share="), "the consumed link leaves the address");

  await page.getByRole("tab", { name: "行程 2", exact: true }).click();
  await page.getByRole("button", { name: "行程、收藏與顯示", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "行程、收藏與顯示設定" });
  const apply = settings.getByRole("button", { name: "套用", exact: true });
  // The rail clips its first child; the last control must sit inside the visible rail.
  const reach = await apply.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { inside: box.bottom <= innerHeight, hit: node.contains(top) };
  });
  assert.deepEqual(reach, { inside: true, hit: true });
  await journey.capture(page, "reader-shared-itinerary-settings");
  await page.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
