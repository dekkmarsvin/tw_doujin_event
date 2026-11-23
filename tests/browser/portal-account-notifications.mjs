// staged-data: portal
import assert from "node:assert/strict";
import { CIRCLE, clearMail, loginLink, signIn } from "./support/portal.mjs";
import { base, output, start } from "./support/journey.mjs";
import { verifyLocalePreferences } from "./support/portal-locale-preferences.mjs";
const journey = await start("portal-account-notifications");
const event = { id: "invitation-fixture", tentativeName: "邀請恢復測試", eventId: null, status: "draft",
  version: 1, updatedAt: 1, updatedByRole: "admin", role: "owner", workspaceMode: "binder" };
const detail = { event: { ...event, eventIdLocked: false }, publicationAvailable: false,
  draft: { schema: "organizer-event-draft/1", event: { id: null, name: "邀請恢復測試", days: [] },
    venue: { assignments: [] }, officialSource: { label: "", url: null } },
  venueCatalog: { venues: [] }, revisions: [], import: null, publication: null,
  workspace: { mode: "binder", onboardingCompletedAt: 1, resume: { guidedTask: "identity_source", section: "review" },
    readiness: { completed: 0, total: 5, suggestedNextSection: "review", blockers: [],
      sections: ["event", "venue", "import", "map", "review"].map(id => ({ id, state: "available" })) } } };

try {
  await clearMail();
  const page = await signIn(journey, CIRCLE, "circle");
  // On /circle the account's actions wait behind 帳號; the menu stays open
  // under the dialog so closing it can hand focus back to 通知設定.
  const open = async () => {
    const menu = page.getByRole("banner").getByRole("button", { name: "帳號", exact: true });
    if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
    await page.getByRole("button", { name: "通知設定", exact: true }).click();
  };
  const dialog = page.getByRole("dialog", { name: "通知設定", exact: true });
  await open();
  // Every notice is sent as it happens (#546): the dialog states that and
  // keeps only the language.
  const notice = dialog.getByText("認領、補充資料、活動審核、權限異動與發布結果，在發生時各寄一封信，無法關閉。", { exact: true });
  await notice.waitFor();
  await dialog.getByLabel("通知語言", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("社團內容更新").count(), 0, "there is no frequency to choose");
  await journey.capture(page, "account-notifications-desktop");
  // Durable PR evidence excludes account addresses, including fictional ones.
  await page.screenshot({ path: `${output}/account-notifications-desktop.png`, mask: [page.getByText(CIRCLE, { exact: true }), dialog.getByText(`收件信箱：${CIRCLE}`, { exact: true })] });
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "通知設定", exact: true }).evaluate(e => e === document.activeElement), true);
  await page.goto(`${base}/organizer?notifications=1`);
  await notice.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await journey.capture(page, "account-notifications-mobile");
  const rect = await dialog.boundingBox(); assert.ok(rect.width >= 389 && rect.height >= 843);
  await dialog.getByRole("button", { name: "關閉", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  // Cross-device login: the newly minted login link, not local storage, carries the destination.
  const link = await loginLink(CIRCLE, "organizer", { destination: { notifications: "1", candidate: "missing-candidate", section: "review" } });
  assert.match(link, /notifications=1/); assert.match(link, /candidate=missing-candidate/);
  const device = await journey.page({ url: link, viewport: { width: 390, height: 844 } });
  await device.getByRole("dialog", { name: "通知設定" }).getByText("認領、補充資料、活動審核、權限異動與發布結果，在發生時各寄一封信，無法關閉。", { exact: true }).waitFor();
  await device.keyboard.press("Escape"); await device.close();
  await page.goto(`${base}/circle?event=not-an-event`);
  await page.getByRole("heading", { name: "找不到指定的活動" }).waitFor();
  assert.match(page.url(), /event=not-an-event/);
  await page.close();
  // Controlled UI data covers exact candidate routing and preserves unsaved input.
  let allowed = true;
  const target = await journey.page({ url: `${base}/organizer?candidate=invitation-fixture&section=review`, routes: async p => {
    await p.addInitScript(() => localStorage.setItem("organizer.resumeCandidate:owner@example.test", "other-candidate"));
    await p.route("**/api/auth/session", r => r.fulfill({ json: { email: "owner@example.test", isAdmin: false, hasOrganizerAccess: true } }));
    await p.route("**/api/account/notification-preferences*", r => r.fulfill({ json: { version: 0, locale: null } }));
    await p.route("**/api/organizer/events", r => r.fulfill({ json: { events: allowed ? [event, { ...event, id: "other-candidate" }] : [{ ...event, id: "other-candidate" }] } }));
    await p.route("**/api/organizer/events/invitation-fixture/validate", r => r.fulfill({ json: { ok: false, version: 1, issues: [] } }));
    await p.route("**/api/organizer/events/invitation-fixture", r => allowed ? r.fulfill({ json: { ...detail, workspace: { ...detail.workspace, resume: { ...detail.workspace.resume, section: "event" } } } }) : r.fulfill({ status: 404, json: { error: "找不到活動。" } }));
  } });
  await target.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  await target.getByRole("button", { name: "成員與權限", exact: true }).click();
  const draft = target.getByRole("textbox", { name: "成員 Email", exact: true });
  await draft.fill("unsaved@example.test");
  await target.getByRole("button", { name: "通知設定", exact: true }).click();
  await target.getByRole("dialog").getByText("認領、補充資料、活動審核、權限異動與發布結果，在發生時各寄一封信，無法關閉。", { exact: true }).waitFor();
  await target.keyboard.press("Escape"); assert.equal(await draft.inputValue(), "unsaved@example.test");
  await target.setViewportSize({ width: 390, height: 844 });
  await target.getByText("目前狀態：草稿", { exact: true }).waitFor();
  await journey.capture(target, "notification-result-mobile");
  allowed = false; await target.setViewportSize({ width: 1440, height: 900 }); await target.reload();
  await target.getByText("找不到信件指定的工作區，或此帳號已無權限。請從活動列表選擇可使用的活動。", { exact: true }).waitFor();
  assert.equal(await target.getByRole("heading", { name: "檢查與發布", exact: true }).count(), 0);
  await journey.capture(target, "notification-target-unavailable");
  await target.close();
  await verifyLocalePreferences(journey);
  await journey.finish();
} catch (error) { await journey.abort(error); }
