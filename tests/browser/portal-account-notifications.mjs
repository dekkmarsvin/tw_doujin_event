// staged-data: portal
import assert from "node:assert/strict";
import { CIRCLE, clearMail, loginLink, signIn } from "./support/portal.mjs";
import { base, output, start } from "./support/journey.mjs";
const journey = await start("portal-account-notifications");
const event = { id: "invitation-fixture", tentativeName: "邀請恢復測試", eventId: null, status: "draft",
  version: 1, updatedAt: 1, updatedByRole: "admin", role: "owner", workspaceMode: "binder" };
const detail = { event: { ...event, eventIdLocked: false }, publicationAvailable: false,
  draft: { schema: "organizer-event-draft/1", event: { id: null, name: "邀請恢復測試", days: [] },
    venue: { assignments: [] }, officialSource: { label: "", url: null } },
  venueCatalog: { venues: [] }, revisions: [], import: null, publication: null,
  workspace: { mode: "binder", onboardingCompletedAt: 1, resume: { guidedTask: "identity_source", section: "review" },
    readiness: { completed: 0, total: 6, suggestedNextSection: "review", blockers: [],
      sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } } };

try {
  await clearMail();
  const page = await signIn(journey, CIRCLE, "circle");
  const open = () => page.getByRole("button", { name: "通知設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "通知設定", exact: true });
  await open();
  const cadence = dialog.getByLabel("社團內容更新", { exact: true });
  await cadence.waitFor();
  // One menu: choosing saves, with no save button or discard prompt.
  assert.equal(await dialog.getByRole("button", { name: "儲存設定" }).count(), 0);
  await cadence.selectOption((await cadence.inputValue()) === "hourly" ? "daily" : "hourly");
  await dialog.getByText("已儲存", { exact: true }).waitFor();
  const saved = await cadence.inputValue();
  await journey.capture(page, "account-notifications-desktop");
  // Durable PR evidence excludes account addresses, including fictional ones.
  await page.screenshot({ path: `${output}/account-notifications-desktop.png`, mask: [page.getByText(CIRCLE, { exact: true }), dialog.getByText(`收件信箱：${CIRCLE}`, { exact: true })] });
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "通知設定", exact: true }).evaluate(e => e === document.activeElement), true);
  await page.route("**/api/account/notification-preferences*", r => r.fulfill({ status: 503, json: { error: "暫時無法載入通知設定。" } }));
  await open(); await dialog.getByRole("alert").waitFor();
  assert.equal(await cadence.count(), 0, "failed read cannot masquerade as a saved default");
  await page.unroute("**/api/account/notification-preferences*");
  await dialog.getByRole("button", { name: "重新載入設定" }).click(); await cadence.waitFor();
  await page.keyboard.press("Escape");
  await page.goto(`${base}/organizer?notifications=1`);
  await cadence.waitFor(); assert.equal(await cadence.inputValue(), saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await journey.capture(page, "account-notifications-mobile");
  // Durable PR evidence excludes account addresses, including fictional ones.
  await page.screenshot({ path: `${output}/account-notifications-mobile.png`, mask: [page.getByText(CIRCLE, { exact: true }), dialog.getByText(`收件信箱：${CIRCLE}`, { exact: true })] });
  const rect = await dialog.boundingBox(); assert.ok(rect.width >= 389 && rect.height >= 843);
  await page.route("**/api/account/notification-preferences*", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 409, json: { error: "設定已變更，請重新載入後再儲存。" } }) : route.continue());
  // A refused choice is not left showing as if it were stored.
  await cadence.selectOption("off"); await dialog.getByRole("alert").waitFor(); assert.equal(await cadence.inputValue(), saved);
  await page.unroute("**/api/account/notification-preferences*");
  await dialog.getByRole("button", { name: "重新載入設定" }).click();
  await dialog.getByText("載入中…", { exact: true }).waitFor({ state: "hidden" }); assert.equal(await cadence.inputValue(), saved);
  await cadence.selectOption("off"); await dialog.getByText("已儲存", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "關閉", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  // Cross-device login: the newly minted login link, not local storage, carries the destination.
  const link = await loginLink(CIRCLE, "organizer", { destination: { notifications: "1", candidate: "missing-candidate", section: "review" } });
  assert.match(link, /notifications=1/); assert.match(link, /candidate=missing-candidate/);
  const device = await journey.page({ url: link, viewport: { width: 390, height: 844 } });
  await device.getByRole("dialog", { name: "通知設定" }).getByLabel("社團內容更新").waitFor();
  assert.equal(await device.getByLabel("社團內容更新").inputValue(), "off");
  await device.keyboard.press("Escape"); await device.close();
  await page.goto(`${base}/circle?event=not-an-event`);
  await page.getByRole("heading", { name: "找不到指定的活動" }).waitFor();
  assert.match(page.url(), /event=not-an-event/);
  await page.close();
  // Controlled UI data covers exact candidate routing and preserves unsaved input.
  let allowed = true;
  const target = await journey.page({ url: `${base}/organizer?candidate=invitation-fixture&section=review`, routes: async p => {
    await p.addInitScript(() => localStorage.setItem("organizer.resumeCandidate:owner@example.test", "other-candidate"));
    await p.route("**/api/auth/session", r => r.fulfill({ json: { email: "owner@example.test", isAdmin: false, isMapContributor: false, hasOrganizerAccess: true } }));
    await p.route("**/api/account/notification-preferences*", r => r.fulfill({ json: { cadence: "daily", version: 0 } }));
    await p.route("**/api/organizer/events", r => r.fulfill({ json: { events: allowed ? [event, { ...event, id: "other-candidate" }] : [{ ...event, id: "other-candidate" }] } }));
    await p.route("**/api/organizer/events/invitation-fixture", r => allowed ? r.fulfill({ json: { ...detail, workspace: { ...detail.workspace, resume: { ...detail.workspace.resume, section: "event" } } } }) : r.fulfill({ status: 404, json: { error: "找不到活動。" } }));
  } });
  await target.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  const draft = target.getByRole("textbox", { name: "協作者 Email", exact: true });
  await draft.fill("unsaved@example.test");
  await target.getByRole("button", { name: "通知設定", exact: true }).click();
  await target.getByRole("dialog").getByLabel("社團內容更新").waitFor();
  await target.keyboard.press("Escape"); assert.equal(await draft.inputValue(), "unsaved@example.test");
  await target.setViewportSize({ width: 390, height: 844 });
  await target.getByText("目前狀態：草稿", { exact: true }).waitFor();
  await journey.capture(target, "notification-result-mobile");
  allowed = false; await target.setViewportSize({ width: 1440, height: 900 }); await target.reload();
  await target.getByText("找不到信件指定的工作區，或此帳號已無權限。請從活動列表選擇可使用的活動。", { exact: true }).waitFor();
  assert.equal(await target.getByRole("heading", { name: "送審與發布狀態", exact: true }).count(), 0);
  await journey.capture(target, "notification-target-unavailable");
  await journey.finish();
} catch (error) { await journey.abort(error); }
