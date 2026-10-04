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
    readiness: { completed: 0, total: 5, suggestedNextSection: "review", blockers: [],
      sections: ["event", "venue", "import", "map", "review"].map(id => ({ id, state: "available" })) } } };
const actions = [];
let session = { email: "admin@example.test", isAdmin: true, isMapContributor: false, hasOrganizerAccess: true };
let canAccess = true;

try {
  const page = await journey.page({ url: `${base}/organizer`, routes: async page => {
    await page.route("**/api/auth/session", route => route.fulfill({ json: session }));
    await page.route("**/api/organizer/events", route => route.fulfill({ json: { events: canAccess ? [detail.event] : [] } }));
    await page.route("**/api/organizer/events/invitation-fixture/validate", route => route.fulfill({ json: { ok: false, version: 1, issues: [] } }));
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
  // Members live behind the activity header, and a reload returns to the data surface.
  const openMembers = async () => {
    await page.getByRole("button", { name: "成員與權限", exact: true }).click();
    await page.getByRole("heading", { name: "成員與權限", exact: true }).waitFor();
  };
  await page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  await openMembers();
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
    await openMembers();
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
  await page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).count(), 0);
  assert.equal(await page.getByRole("textbox", { name: "審閱說明" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "核准並發布", exact: true }).count(), 0);
  await openMembers();
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
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "成員與權限", exact: true }) })
    .last().screenshot({ path: `${output}/ordinary-owner-members-panel.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "請改用桌機", exact: true }).waitFor();
  await journey.capture(page, "organizer-mobile-desktop-required");
  await page.setViewportSize({ width: 1440, height: 900 });

  detail.event.role = "editor";
  await page.reload();
  await page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).count(), 0);
  await openMembers();
  assert.equal(await page.getByRole("heading", { name: "負責人", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "邀請協作者", exact: true }).isDisabled(), true);
  await journey.capture(page, "editor-submitted");

  session = { ...session, isAdmin: true };
  detail.event.role = "admin";
  await page.reload();
  await page.getByRole("heading", { name: "網站管理者審閱", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "審閱說明" }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "核准並發布", exact: true }).isEnabled(), true);
  await journey.capture(page, "admin-submitted");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "檢查與發布", exact: true }) })
    .last().screenshot({ path: `${output}/admin-review-panel.png` });
  await openMembers();
  assert.equal(await page.getByRole("button", { name: "新增負責人", exact: true }).isEnabled(), true);
  // ADR-0080: an admin without the Owner grant also manages collaborators and submits.
  assert.equal(await page.getByRole("button", { name: "邀請協作者", exact: true }).isEnabled(), true);
  assert.equal(await page.getByText(/管理成員需要負責人身分/).count(), 0);
  detail.event.status = "draft";
  await page.reload();
  await page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "送出審閱", exact: true }).isEnabled(), true);
  assert.equal(await page.getByText(/送出審閱需要/).count(), 0);
  await journey.capture(page, "admin-without-owner-can-submit");

  session = { ...session, isAdmin: false };
  detail.event.role = "owner";
  detail.event.status = "draft";
  await page.reload();
  await page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "送出審閱", exact: true }).isEnabled(), true);
  await openMembers();
  await page.getByRole("textbox", { name: "負責人 Email", exact: true }).fill(session.email);
  await ownerSection.getByRole("button", { name: "移除此負責人", exact: true }).click();
  await page.getByRole("heading", { name: "成員與權限", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByText("找不到活動。", { exact: true }).count(), 0);
  await journey.capture(page, "owner-leaves-activity");
  await page.close();

  // The account-management link names the candidate and its members surface.
  // Both a remembered candidate and the saved content section must yield to it,
  // including after the existing email login and session expiry.
  const memberPath = "/organizer?candidate=invitation-fixture&section=members";
  const memberNow = Date.now(), week = 7 * 24 * 60 * 60 * 1000;
  let signedIn = false, allowed = true, requestedLink, memberExpiresAt = memberNow + week;
  const readCandidates = [];
  const memberSession = () => ({ email: "member-manager@example.test", isAdmin: true, isMapContributor: false, hasOrganizerAccess: true, expiresAt: memberExpiresAt });
  const memberDetail = { ...detail, event: { ...detail.event, role: "admin", status: "draft" }, publicationAvailable: false,
    workspace: { ...detail.workspace, resume: { ...detail.workspace.resume, section: "event" } } };
  const members = await journey.page({ url: `${base}${memberPath}`, routes: async page => {
    await page.clock.install({ time: memberNow });
    await page.addInitScript(() => localStorage.setItem("organizer.resumeCandidate:member-manager@example.test", "other-candidate"));
    await page.route("https://challenges.cloudflare.com/turnstile/**", route => route.fulfill({ contentType: "text/javascript", body: `
      window.turnstile = { render: (host, options) => { setTimeout(() => options.callback("journey-token")); return "widget"; }, remove: () => {} };
      window.__ff47TurnstileReady();` }));
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? memberSession() : { error: "尚未登入。" } });
      if (path === "/api/auth/config") return route.fulfill({ json: { turnstileSitekey: "journey-sitekey" } });
      if (path === "/api/auth/request-link") { requestedLink = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { ok: true } }); }
      if (path === "/api/auth/verify") { signedIn = true; return route.fulfill({ json: memberSession() }); }
      if (path === "/api/organizer/events") return route.fulfill({ json: { events: [
        ...(allowed ? [memberDetail.event] : []), { ...memberDetail.event, id: "other-candidate", tentativeName: "另一個工作區" },
      ] } });
      if (path.startsWith("/api/organizer/events/")) {
        const candidateId = path.split("/")[4]; readCandidates.push(candidateId);
        return route.fulfill(candidateId === "invitation-fixture" && allowed ? { json: memberDetail } : { status: 404, json: { error: "找不到活動。" } });
      }
      throw new Error(`Unexpected member destination request: ${path}`);
    });
  } });
  const requestMembersLink = async () => {
    await members.getByLabel("Email", { exact: true }).fill("member-manager@example.test");
    await members.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "寄出登入連結" && !button.disabled));
    await members.getByRole("button", { name: "寄出登入連結", exact: true }).click();
    await members.getByText("若帳號可使用，登入連結已寄出。", { exact: true }).waitFor();
    assert.equal(requestedLink.audience, "organizer");
    assert.deepEqual(requestedLink.destination, { candidate: "invitation-fixture", section: "members" });
    await members.goto(`${base}/organizer?${new URLSearchParams({ ...requestedLink.destination, login: "member-login-token" })}`);
    await members.getByRole("heading", { name: "成員與權限", exact: true }).waitFor();
    assert.equal(await members.getByRole("textbox", { name: "協作者 Email", exact: true }).isEnabled(), true);
    assert.equal(new URL(members.url()).searchParams.get("candidate"), "invitation-fixture");
    assert.equal(new URL(members.url()).searchParams.get("section"), "members");
    assert.equal(new URL(members.url()).searchParams.has("login"), false);
    assert.ok(readCandidates.length > 0 && readCandidates.every(candidate => candidate === "invitation-fixture"), "no fallback to the remembered candidate");
  };
  await requestMembersLink();
  await journey.capture(members, "members-exact-destination-after-login");
  await members.clock.fastForward(week);
  await members.getByText("登入已到期，請重新登入。", { exact: true }).waitFor();
  assert.equal(await members.getByRole("heading", { name: "成員與權限", exact: true }).count(), 0);
  memberExpiresAt += week;
  await requestMembersLink();
  await journey.capture(members, "members-exact-destination-after-expiry");
  await members.setViewportSize({ width: 390, height: 844 });
  await members.getByText("成員管理請改用桌機。請在桌機開啟同一個連結，接續這個工作區。", { exact: true }).waitFor();
  assert.equal(await members.getByRole("textbox", { name: "協作者 Email", exact: true }).count(), 0);
  assert.equal(new URL(members.url()).searchParams.get("candidate"), "invitation-fixture");
  assert.equal(new URL(members.url()).searchParams.get("section"), "members");
  await journey.capture(members, "members-exact-destination-mobile");
  await members.setViewportSize({ width: 1440, height: 900 });
  await members.getByRole("heading", { name: "成員與權限", exact: true }).waitFor();
  allowed = false;
  await members.reload();
  await members.getByText("找不到信件指定的工作區，或此帳號已無權限。請從活動列表選擇可使用的活動。", { exact: true }).waitFor();
  assert.equal(await members.getByRole("heading", { name: "成員與權限", exact: true }).count(), 0);
  assert.ok(readCandidates.every(candidate => candidate === "invitation-fixture"), "missing explicit members target never opens another candidate");
  await journey.capture(members, "members-exact-destination-unavailable");
  await members.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
