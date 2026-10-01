// staged-data: portal
// UI responses are controlled fixtures; handler tests exercise real D1 state,
// delivery failures, role boundaries and budgets without sending external mail.
import assert from "node:assert/strict";
import { base, output, start } from "./support/journey.mjs";

const journey = await start("portal-organizer-invitations");
const event = { id: "invitation-fixture", tentativeName: "邀請恢復測試", eventId: null, status: "draft",
  version: 1, updatedAt: 1, updatedByRole: "admin", role: "owner", workspaceMode: "binder" };
const detail = { event: { ...event, eventIdLocked: false }, publicationAvailable: false,
  draft: { schema: "organizer-event-draft/1", event: { id: null, name: "邀請恢復測試", days: [] },
    venue: { assignments: [] }, officialSource: { label: "", url: null } },
  venueCatalog: { venues: [] }, revisions: [], import: null, publication: null,
  workspace: { mode: "binder", onboardingCompletedAt: 1, resume: { guidedTask: "identity_source", section: "review" },
    readiness: { completed: 0, total: 6, suggestedNextSection: "review", blockers: [],
      sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } } };
const actions = [];
let session = { email: "admin@example.test", isAdmin: true, isMapContributor: false, hasOrganizerAccess: true };
let canAccess = true;

try {
  const page = await journey.page({ url: `${base}/organizer`, routes: async page => {
    await page.route("**/api/auth/session", route => route.fulfill({ json: session }));
    await page.route("**/api/organizer/events", route => route.fulfill({ json: { events: canAccess ? [detail.event] : [] } }));
    await page.route("**/api/organizer/events/invitation-fixture", route => route.fulfill(
      canAccess ? { json: detail } : { status: 404, json: { error: "找不到活動。" } }));
    await page.route("**/api/organizer/events/invitation-fixture/collaborators", route => {
      const body = route.request().postDataJSON();
      actions.push(body);
      if (body.action === "revoke") {
        if (body.email === session.email) canAccess = false;
        return route.fulfill({ json: { ok: true, result: "revoked" } });
      }
      const delivery = body.action === "resend" ? "sent" : body.role === "owner" ? "unknown" : "failed";
      return route.fulfill({ json: { ok: true, result: body.action === "resend" ? "resent" : "invited",
        invitationSent: delivery === "sent", invitationDelivery: delivery } });
    });
  } });
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  for (const [role, label, button, failure] of [
    ["editor", "協作者", "邀請協作者", "邀請已建立，邀請信未寄出。請按「重寄邀請信」。"],
    ["owner", "負責人", "新增負責人", "邀請已建立，無法確認邀請信是否寄出。你可以重寄邀請信。"],
  ]) {
    const section = page.locator("div").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).last();
    await page.getByRole("textbox", { name: `${label} Email`, exact: true }).fill(`${role}@example.test`);
    await section.getByRole("button", { name: button, exact: true }).click();
    await section.getByRole("status").getByText(failure, { exact: true }).waitFor();
    assert.equal((actions.at(-1).role ?? "editor"), role);
    await journey.capture(page, `invitation-${role}-failure`);
    // A pending invitation must remain recoverable after leaving the page.
    await page.reload();
    await page.getByRole("textbox", { name: `${label} Email`, exact: true }).fill(`${role}@example.test`);
    await section.getByRole("button", { name: "重寄邀請信", exact: true }).click();
    await section.getByRole("status").getByText("邀請信已寄出。", { exact: true }).waitFor();
    assert.deepEqual(actions.at(-1), { email: `${role}@example.test`, ...(role === "owner" ? { role } : {}), action: "resend" });
    await journey.capture(page, `invitation-${role}-resent`);
  }
  assert.equal(actions.length, 4, "each click sends exactly one collaborator action");
  // An ordinary owner manages their own event's owners but never sees the
  // administrator's review form, even after the event has been submitted.
  session = { ...session, email: "organizer@example.test", isAdmin: false };
  detail.event.status = "submitted";
  detail.publicationAvailable = true;
  await page.reload();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).count(), 0);
  assert.equal(await page.getByRole("textbox", { name: "審閱說明" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "核准並發布", exact: true }).count(), 0);
  const ownerSection = page.locator("div").filter({ has: page.getByRole("heading", { name: "負責人", exact: true }) }).last();
  await page.getByRole("textbox", { name: "負責人 Email", exact: true }).fill("co-owner@example.test");
  await ownerSection.getByRole("button", { name: "新增負責人", exact: true }).click();
  await ownerSection.getByRole("status").getByText("邀請已建立，無法確認邀請信是否寄出。你可以重寄邀請信。", { exact: true }).waitFor();
  await ownerSection.getByRole("button", { name: "重寄邀請信", exact: true }).click();
  await ownerSection.getByRole("status").getByText("邀請信已寄出。", { exact: true }).waitFor();
  await ownerSection.getByRole("button", { name: "移除此負責人", exact: true }).click();
  await ownerSection.getByRole("status").getByText("已移除這位負責人。", { exact: true }).waitFor();
  assert.deepEqual(actions.slice(-3).map(({ role, action }) => [role, action]), [["owner", "invite"], ["owner", "resend"], ["owner", "revoke"]]);
  await page.getByRole("textbox", { name: "負責人 Email", exact: true }).fill("");
  await journey.capture(page, "ordinary-owner-submitted");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "送審與發布狀態", exact: true }) })
    .last().screenshot({ path: `${output}/ordinary-owner-review-panel.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "請改用桌機", exact: true }).waitFor();
  await journey.capture(page, "organizer-mobile-desktop-required");
  await page.setViewportSize({ width: 1440, height: 900 });

  detail.event.role = "editor";
  await page.reload();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "負責人", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).count(), 0);
  await journey.capture(page, "editor-submitted");

  session = { ...session, isAdmin: true };
  detail.event.role = "admin";
  await page.reload();
  await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "審閱說明" }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "核准並發布", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "新增負責人", exact: true }).isEnabled(), true);
  await journey.capture(page, "admin-submitted");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "送審與發布狀態", exact: true }) })
    .last().screenshot({ path: `${output}/admin-review-panel.png` });

  session = { ...session, isAdmin: false };
  detail.event.role = "owner";
  detail.event.status = "draft";
  await page.reload();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "送出審閱", exact: true }).isEnabled(), true);
  await page.getByRole("textbox", { name: "負責人 Email", exact: true }).fill(session.email);
  await ownerSection.getByRole("button", { name: "移除此負責人", exact: true }).click();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByText("找不到活動。", { exact: true }).count(), 0);
  await journey.capture(page, "owner-leaves-activity");
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
