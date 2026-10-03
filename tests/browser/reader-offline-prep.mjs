// staged-data: portal
// 準備離線使用 (#415): the real built site and Service Worker, not routed
// fixtures, because the point is what survives going offline.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const journey = await start("reader-offline-prep");
const PLAN_KEY = "event-map-planning-v1";
try {
  const page = await journey.page({ params: "&day=1" });
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ schemaVersion: 3, favoriteGroups: [],
    favorites: [{ eventId: "sample", circleId: "c-900001", groupId: null, memo: "離線備註", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
    visitPlans: [{ eventId: "sample", day: 1, circleId: "c-900001", status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: "2026-10-01T00:00:00.000Z" }] })), PLAN_KEY);
  // The page must be controlled by the worker before readiness can be judged.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "the reader is controlled by the Service Worker");
  await page.locator("[data-slot-code]").first().waitFor();

  await page.getByRole("tab", { name: "行程 1", exact: true }).click();
  await page.getByRole("button", { name: "準備離線使用", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "準備離線使用" });
  await dialog.getByText(/已就緒|尚未準備完成/).waitFor();
  if (await dialog.getByText(/尚未準備完成/).count()) await dialog.getByRole("button", { name: "準備離線使用", exact: true }).click();
  await dialog.getByText(/已就緒/).waitFor({ timeout: 20000 });
  await journey.capture(page, "reader-offline-prep-ready");
  await dialog.getByRole("button", { name: "關閉", exact: true }).click();

  // Offline from here: a reload must still open this day's map, favorites and plan.
  await page.context().setOffline(true);
  await page.reload();
  await page.locator("[data-slot-code]").first().waitFor();
  await page.getByRole("tab", { name: "行程 1", exact: true }).click();
  await page.getByRole("button", { name: "將 北風畫室 標示為已走訪", exact: true }).click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PLAN_KEY);
  assert.equal(stored.visitPlans[0].status, "visited", "marking visited works offline");
  assert.equal(stored.favorites[0].memo, "離線備註", "the plan stays in the same store");
  await journey.capture(page, "reader-offline-prep-offline");
  await page.context().setOffline(false);
  await page.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
