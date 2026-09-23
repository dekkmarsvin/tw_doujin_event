// staged-data: portal
import assert from "node:assert/strict";
import { ADMIN, CIRCLE, clearMail, signIn } from "./support/portal.mjs";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-review-notifications");
try {
  await clearMail();
  const admin = await signIn(journey, ADMIN, "circle");
  await admin.goto(`${base}/admin`);
  const panel = admin.locator("#review-notifications");
  const enabled = panel.getByRole("checkbox", { name: "接收待審通知" });
  const cadence = panel.getByLabel("通知頻率");
  const save = panel.getByRole("button", { name: "儲存設定", exact: true });
  await enabled.waitFor();
  const initial = await admin.evaluate(async () => (await fetch("/api/admin/notification-preferences")).json());
  if (!initial.enabled) { await enabled.check(); await save.click(); await panel.getByText("通知設定已儲存。", { exact: true }).waitFor(); }
  const chosen = initial.cadence === "daily" ? "hourly" : "daily";
  await cadence.selectOption(chosen); await save.click();
  await panel.getByText("通知設定已儲存。", { exact: true }).waitFor();
  await admin.reload(); await enabled.waitFor();
  assert.equal(await cadence.inputValue(), chosen);
  await enabled.uncheck(); assert.equal(await cadence.isDisabled(), true);
  await save.click(); await panel.getByText("通知設定已儲存。", { exact: true }).waitFor();
  await admin.reload(); await enabled.waitFor();
  assert.equal(await enabled.isChecked(), false); assert.equal(await cadence.inputValue(), chosen);
  await journey.capture(admin, "notifications-desktop-disabled");

  await enabled.focus(); await admin.keyboard.press("Space");
  assert.equal(await enabled.isChecked(), true);
  await cadence.selectOption("five_minutes"); await save.click();
  await panel.getByText("通知設定已儲存。", { exact: true }).waitFor();
  await admin.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await journey.capture(admin, "notifications-mobile");

  // A real write error preserves input, and explicit reload blocks writes until
  // the GET finishes. Only this failure is intercepted; normal requests use D1.
  await cadence.selectOption("hourly");
  await admin.route("**/api/admin/notification-preferences*", async route => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"測試儲存失敗"}' });
    return route.continue();
  });
  await save.click(); await panel.getByRole("alert").waitFor();
  assert.equal(await cadence.inputValue(), "hourly");
  await admin.unroute("**/api/admin/notification-preferences*");
  let releaseRead;
  const blocked = new Promise(resolve => { releaseRead = resolve; });
  await admin.route("**/api/admin/notification-preferences*", async route => {
    if (route.request().method() === "GET") await blocked;
    return route.continue();
  });
  await panel.getByRole("button", { name: "重新載入設定" }).click();
  assert.equal(await enabled.isDisabled(), true); assert.equal(await save.isDisabled(), true);
  releaseRead(); await panel.getByText("載入中…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await cadence.inputValue(), "five_minutes");
  await admin.unroute("**/api/admin/notification-preferences*");

  const member = await signIn(journey, CIRCLE, "circle");
  assert.equal(await member.evaluate(async () => (await fetch("/api/admin/notification-preferences")).status), 403);
  assert.equal(await admin.evaluate(async () => (await fetch("/api/admin/notification-preferences", {
    method: "PUT", headers: { "content-type": "text/plain" }, body: "{}",
  })).status), 415);
  await member.close();
  await admin.route("**/api/admin/notification-preferences*", route => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"登入已到期"}' }));
  await cadence.selectOption("hourly"); await save.click();
  await admin.getByRole("heading", { name: "請先登入", exact: true }).waitFor();
  assert.equal(await panel.count(), 0);
  await journey.finish();
} catch (error) { await journey.abort(error); }
