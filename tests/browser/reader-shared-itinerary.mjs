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
  // A received URL selects this visit's language; preview preserves private
  // planning and only explicit acceptance imports the same minimal snapshot.
  const privatePlan = { schemaVersion: 3, favoriteGroups: [], favorites: [{ eventId: "sample", circleId: "c-900001", groupId: null, memo: "受信前の原文備註", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }], visitPlans: [] };
  for (const [locale, width, title, add] of [["en", 390, "Shared plan", "Add to my plan"], ["ja", 1440, "共有された巡回プラン", "巡回プランに追加"]]) {
    const receiver = await journey.mapPage({ params: `&day=1&share=${shareId}&lang=${locale}`, viewport: { width, height: 900 }, routes: async page => {
      await page.addInitScript(({ key, document }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(document)); }, { key: PLAN_KEY, document: privatePlan });
      await routes(page);
    } });
    const preview = receiver.getByRole("dialog", { name: title });
    await preview.getByRole("button", { name: add, exact: true }).waitFor();
    assert.deepEqual(await receiver.evaluate(key => JSON.parse(localStorage.getItem(key)), PLAN_KEY), privatePlan, "preview leaves private planning unchanged");
    await journey.capture(receiver, `reader-shared-plan-${locale}-${width}`);
    await preview.getByRole("button", { name: add, exact: true }).click();
    await preview.waitFor({ state: "hidden" });
    const after = await receiver.evaluate(key => JSON.parse(localStorage.getItem(key)), PLAN_KEY);
    assert.deepEqual(after.favorites, privatePlan.favorites);
    assert.deepEqual(after.visitPlans.map(({ circleId, day }) => ({ circleId, day })), snapshot.items);
    assert.equal(new URL(receiver.url()).searchParams.get("lang"), locale);
    assert.equal(new URL(receiver.url()).searchParams.has("share"), false);
    assert.ok(!JSON.stringify(after).includes('"lang"'), "locale is not part of the stored plan");
    await receiver.reload();
    await receiver.locator("[data-slot-code]").first().waitFor();
    assert.deepEqual(await receiver.evaluate(key => JSON.parse(localStorage.getItem(key)), PLAN_KEY), after);
    await receiver.close();
  }
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
