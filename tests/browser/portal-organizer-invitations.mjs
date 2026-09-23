// staged-data: portal
// UI responses are controlled fixtures; handler tests exercise real D1 state,
// delivery failures, role boundaries and budgets without sending external mail.
import assert from "node:assert/strict";
import { base, start } from "./support/journey.mjs";

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

try {
  const page = await journey.page({ url: `${base}/organizer`, routes: async page => {
    await page.route("**/api/auth/session", route => route.fulfill({ json:
      { email: "admin@example.test", isAdmin: true, isMapContributor: false, hasOrganizerAccess: true } }));
    await page.route("**/api/organizer/events", route => route.fulfill({ json: { events: [event] } }));
    await page.route("**/api/organizer/events/invitation-fixture", route => route.fulfill({ json: detail }));
    await page.route("**/api/organizer/events/invitation-fixture/collaborators", route => {
      const body = route.request().postDataJSON();
      actions.push(body);
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
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
