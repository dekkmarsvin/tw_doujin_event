// staged-data: portal
//
// UI proof for #242. The portal session, candidate detail and reopen response
// are routed to deterministic synthetic values so this journey exercises the
// Organizer surface without creating a real candidate or talking to GitHub.
// Handler/repository tests own authorization, remote-audit and CAS semantics;
// this file checks what each organizer role can see and do in the browser.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { base, output, start } from "./support/journey.mjs";

const CANDIDATE_ID = "issue-242-failed-candidate";
const JOB_ID = "issue-242-failed-job";
const EVENT_ID = "issue-242-synthetic-event";
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceStatus = execFileSync("git", ["status", "--short"], { encoding: "utf8" });

const draft = {
  schema: "organizer-event-draft/1",
  event: {
    id: EVENT_ID,
    name: "#242 失敗候選重開驗證",
    days: [{ id: "day-1", label: "第一天", date: "2026-10-09" }],
  },
  venue: { assignments: [] },
  officialSource: { label: "本機合成驗證資料", url: "https://example.test/issue-242" },
};

const venueCatalog = { venues: [] };
const readiness = {
  completed: 0,
  total: 6,
  suggestedNextSection: "review",
  blockers: [],
  sections: [
    { id: "event", state: "available" },
    { id: "venue", state: "available" },
    { id: "import", state: "available" },
    { id: "map", state: "available" },
    { id: "validate", state: "available" },
    { id: "review", state: "needs_attention" },
  ],
};

const sessionFor = {
  owner: { email: "owner@example.test", isAdmin: false, isMapContributor: false, hasOrganizerAccess: true },
  admin: { email: "admin@example.test", isAdmin: true, isMapContributor: false, hasOrganizerAccess: true },
  editor: { email: "editor@example.test", isAdmin: false, isMapContributor: false, hasOrganizerAccess: true },
};

function eventFor(role, state) {
  return {
    id: CANDIDATE_ID,
    tentativeName: "#242 失敗候選重開驗證",
    eventId: EVENT_ID,
    status: state === "reopened" ? "changes_requested" : "failed",
    version: state === "reopened" ? 2 : 1,
    updatedAt: state === "reopened" ? 1_789_000_000_000 : 1_788_999_000_000,
    updatedByRole: state === "reopened" ? "owner" : "system",
    role,
    workspaceMode: "binder",
  };
}

function detailFor(role, state, { started = false } = {}) {
  const event = eventFor(role, state);
  return {
    publicationAvailable: false,
    event: { ...event, eventIdLocked: true },
    draft,
    venueCatalog,
    revisions: state === "reopened"
      ? [
        { version: 1, eventId: null, createdByRole: "admin", createdAt: 1_788_998_000_000 },
        { version: 2, eventId: EVENT_ID, createdByRole: "owner", createdAt: 1_789_000_000_000 },
      ]
      : [{ version: 1, eventId: null, createdByRole: "admin", createdAt: 1_788_998_000_000 }],
    import: null,
    publication: {
      id: JOB_ID,
      status: "failed",
      step: "preparing_data",
      error: "Publication dispatch failed.",
      failureCode: "dispatch_failed",
      retryable: true,
      started,
      candidateVersion: 1,
      updatedAt: 1_788_999_000_000,
    },
    workspace: {
      mode: "binder",
      onboardingCompletedAt: 1_788_990_000_000,
      resume: { guidedTask: "identity_source", section: "review" },
      readiness,
    },
  };
}

function summaryFor(role, state) {
  const event = eventFor(role, state);
  return event;
}

async function routeOrganizer(page, { role, reopen = "success", started = false } = {}) {
  let state = "failed";
  let reopenRequests = 0;
  const reopenBodies = [];
  let requestSeenResolve;
  const requestSeen = new Promise((resolve) => { requestSeenResolve = resolve; });
  let releaseReopenResolve;
  let releaseReopen = Promise.resolve();
  if (reopen === "success") {
    releaseReopen = new Promise((resolve) => { releaseReopenResolve = resolve; });
  }

  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(sessionFor[role]),
  }));
  await page.route("**/api/organizer/events", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [summaryFor(role, state)] }) });
  });
  await page.route(`**/api/organizer/events/${CANDIDATE_ID}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailFor(role, state, { started })) });
  });
  await page.route(`**/api/organizer/events/${CANDIDATE_ID}/workspace`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, guidedTask: "identity_source", lastSection: "event" }) });
  });
  await page.route(`**/api/organizer/events/${CANDIDATE_ID}/reopen`, async (route) => {
    reopenRequests += 1;
    reopenBodies.push(route.request().postDataJSON());
    requestSeenResolve?.();
    if (reopen === "stale") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "退回修改需要重新登入。", code: "admin_session_stale" }),
      });
      return;
    }
    if (reopen === "audit-failed") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "目前無法完整確認發布儲存庫狀態，請稍後再試。", code: "github_remote_audit_failed" }),
      });
      return;
    }
    await releaseReopen;
    state = "reopened";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "changes_requested", version: 2, previousPublicationJobId: JOB_ID }),
    });
  });
  return {
    requestSeen,
    release: () => releaseReopenResolve?.(),
    get reopenRequests() { return reopenRequests; },
    get state() { return state; },
    reopenBodies,
  };
}

const journey = await start("portal-organizer-reopen");
journey.report.sourceHead = sourceHead;
journey.report.sourceDirty = sourceStatus.trim().length > 0;
journey.report.sourceStatus = sourceStatus.trim().split(/\r?\n/).filter(Boolean);
journey.report.run = {
  base,
  startedAt: journey.report.recordedAt,
  candidateId: CANDIDATE_ID,
  publicationJobId: JOB_ID,
  synthetic: true,
};
journey.report.screenshots = [];

async function capture(page, name, { fullPage = false, panel = null } = {}) {
  if (panel) {
    await panel.screenshot({ path: path.join(output, `${name}.png`) });
    journey.report.checks.push(name);
  } else if (fullPage) {
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.body.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${name}: horizontal page overflow of ${overflow}px`);
    journey.report.checks.push(name);
  } else {
    await journey.capture(page, name);
  }
  journey.report.screenshots.push({ name, path: path.join(output, `${name}.png`), url: page.url() });
}

async function reviewPanel(page) {
  const review = page.locator("section").filter({ has: page.getByRole("heading", { name: "送審與發布狀態", exact: true }) }).last();
  await review.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  return review;
}

async function expandTechnicalDetails(page, review) {
  const details = review.locator("details").filter({ hasText: "技術詳細資訊" });
  await details.locator("summary").click();
  assert.notEqual(await details.getAttribute("open"), null, "technical details are expanded for the evidence capture");
  await details.locator("p").first().waitFor();
  await page.waitForTimeout(100);
}

try {
  // Owner: the recovery control is visible, requires a reason, and remains
  // disabled while the one remote write request is pending.
  const owner = await journey.page({
    url: `${base}/organizer`,
    viewport: { width: 1440, height: 900 },
    routes: async (page) => { page.__reopen = await routeOrganizer(page, { role: "owner" }); },
  });
  const ownerRoutes = owner.__reopen;
  await owner.getByRole("button", { name: "登出", exact: true }).waitFor();
  const ownerReview = await reviewPanel(owner);
  const ownerReason = ownerReview.getByRole("textbox", { name: "退回理由", exact: true });
  const ownerReopen = ownerReview.getByRole("button", { name: "退回修改", exact: true });
  assert.equal(await ownerReason.getAttribute("required"), "", "the recovery reason is required");
  assert.equal(await ownerReopen.isDisabled(), true, "empty recovery reason keeps the action disabled");
  assert.equal(await ownerReview.getByRole("button", { name: "重試發布", exact: true }).isDisabled(), true, "publication retry stays disabled while publication is unavailable");
  await capture(owner, "organizer-reopen-owner-required");

  await ownerReason.fill("補齊活動資料後重新送審");
  const ownerResponse = owner.waitForResponse((response) => response.url().endsWith(`/api/organizer/events/${CANDIDATE_ID}/reopen`) && response.status() === 200);
  await ownerReopen.click();
  await ownerRoutes.requestSeen;
  assert.equal(await ownerReopen.isDisabled(), true, "the recovery action is disabled during the request");
  await owner.getByRole("status").getByText("處理中…", { exact: true }).waitFor();
  await ownerReopen.evaluate((button) => button.click());
  await capture(owner, "organizer-reopen-owner-pending");
  assert.equal(ownerRoutes.reopenRequests, 1, "a second click while pending does not send another request");
  ownerRoutes.release();
  await ownerResponse;
  await owner.getByRole("heading", { name: "發布狀態（第 1 版歷史紀錄）", exact: true }).waitFor();
  assert.match(await ownerReview.innerText(), /目前版本為第 2 版/);
  assert.match(await ownerReview.innerText(), /舊工作不會再重試/);
  assert.equal(await owner.getByRole("button", { name: "退回修改", exact: true }).count(), 0, "the recovery action is gone after reopening");
  assert.equal(await owner.getByRole("button", { name: "重試發布", exact: true }).count(), 0, "the prior failed job cannot be retried after reopening");
  assert.deepEqual(ownerRoutes.reopenBodies, [{ expectedVersion: 1, reason: "補齊活動資料後重新送審" }]);
  await expandTechnicalDetails(owner, ownerReview);
  await capture(owner, "organizer-reopen-owner-history", { panel: ownerReview });

  const steps = owner.locator('ol[aria-label="活動項目"]');
  await steps.getByRole("button", { name: /活動/ }).click();
  await owner.getByRole("heading", { name: "活動基本資料", exact: true }).waitFor();
  const eventName = owner.getByLabel("活動名稱", { exact: true });
  assert.equal(await eventName.isDisabled(), false, "changes_requested reopens the event editor");
  await eventName.fill("#242 可編輯的活動資料");
  assert.match(await steps.innerText(), /尚未儲存/);
  await capture(owner, "organizer-reopen-owner-editable");
  await owner.close();

  // Admin: the same visible action reports the existing fresh-login path when
  // the step-up session is stale; no synthetic response changes the candidate.
  const admin = await journey.page({
    url: `${base}/organizer`,
    viewport: { width: 1440, height: 900 },
    routes: async (page) => { page.__reopen = await routeOrganizer(page, { role: "admin", reopen: "stale" }); },
  });
  const adminRoutes = admin.__reopen;
  await admin.getByRole("button", { name: "登出", exact: true }).waitFor();
  const adminReview = await reviewPanel(admin);
  const adminReason = adminReview.getByRole("textbox", { name: "退回理由", exact: true });
  const adminReopen = adminReview.getByRole("button", { name: "退回修改", exact: true });
  assert.equal(await adminReopen.isDisabled(), true);
  await adminReason.fill("重新確認候選資料");
  await adminReopen.click();
  await adminRoutes.requestSeen;
  await admin.getByRole("status").getByText("退回修改需要重新登入。", { exact: true }).waitFor();
  await admin.getByRole("link", { name: "重新登入並返回這個活動", exact: true }).waitFor();
  assert.equal(adminRoutes.reopenRequests, 1);
  await capture(admin, "organizer-reopen-admin-fresh-login-error");
  await admin.close();

  // If the fixed remote audit cannot prove a clear state, the candidate stays
  // failed at version 1. The user can retry the recovery action after fixing
  // the infrastructure, while publication itself remains disabled locally.
  const audit = await journey.page({
    url: `${base}/organizer`,
    viewport: { width: 1440, height: 900 },
    routes: async (page) => { page.__reopen = await routeOrganizer(page, { role: "owner", reopen: "audit-failed" }); },
  });
  const auditRoutes = audit.__reopen;
  await audit.getByRole("button", { name: "登出", exact: true }).waitFor();
  const auditReview = await reviewPanel(audit);
  const auditReason = auditReview.getByRole("textbox", { name: "退回理由", exact: true });
  const auditReopen = auditReview.getByRole("button", { name: "退回修改", exact: true });
  await auditReason.fill("等待儲存庫狀態恢復後再試");
  await auditReopen.click();
  await auditRoutes.requestSeen;
  await audit.getByRole("status").getByText("目前無法完整確認發布儲存庫狀態，請稍後再試。", { exact: true }).waitFor();
  await audit.waitForTimeout(50);
  assert.equal(auditRoutes.state, "failed", "remote-audit failure leaves the candidate failed");
  assert.equal(await auditReopen.isDisabled(), false, "the recovery action is available for a later retry");
  assert.match(await auditReview.innerText(), /發布失敗/);
  assert.equal(await audit.getByRole("heading", { name: /發布狀態（第 1 版歷史紀錄）/ }).count(), 0, "remote-audit failure does not create a historical reopen state");
  assert.equal(await auditReview.getByRole("button", { name: "重試發布", exact: true }).isDisabled(), true, "publication retry remains disabled while publication is unavailable");
  assert.equal(auditRoutes.reopenRequests, 1);
  assert.deepEqual(auditRoutes.reopenBodies, [{ expectedVersion: 1, reason: "等待儲存庫狀態恢復後再試" }]);
  await expandTechnicalDetails(audit, auditReview);
  await capture(audit, "organizer-reopen-remote-audit-error", { panel: auditReview });
  await audit.close();

  // Editor: can inspect the failed publication but has no recovery control.
  const editor = await journey.page({
    url: `${base}/organizer`,
    viewport: { width: 1440, height: 900 },
    routes: async (page) => { await routeOrganizer(page, { role: "editor", reopen: "stale" }); },
  });
  await editor.getByRole("button", { name: "登出", exact: true }).waitFor();
  const editorReview = await reviewPanel(editor);
  assert.equal(await editorReview.getByRole("heading", { name: "退回修改", exact: true }).count(), 0, "Editor cannot see the recovery panel");
  assert.equal(await editorReview.getByRole("textbox", { name: "退回理由", exact: true }).count(), 0, "Editor cannot enter a recovery reason");
  assert.equal(await editorReview.getByRole("button", { name: "退回修改", exact: true }).count(), 0, "Editor cannot trigger recovery");
  await capture(editor, "organizer-reopen-editor-hidden");
  await editor.close();

  // A remote-write intent or confirmed checkpoint makes the recovery unsafe.
  // The owner may still inspect the failed job, but must not be offered a
  // reason field or a button that could imply a safe reopen.
  const started = await journey.page({
    url: `${base}/organizer`,
    viewport: { width: 1440, height: 900 },
    routes: async (page) => { page.__reopen = await routeOrganizer(page, { role: "owner", reopen: "audit-failed", started: true }); },
  });
  const startedRoutes = started.__reopen;
  await started.getByRole("button", { name: "登出", exact: true }).waitFor();
  const startedReview = await reviewPanel(started);
  assert.match(await startedReview.innerText(), /遠端紀錄.*無法安全退回修改/);
  assert.equal(await startedReview.getByRole("textbox", { name: "退回理由", exact: true }).count(), 0, "a started publication has no reopen reason field");
  assert.equal(await startedReview.getByRole("button", { name: "退回修改", exact: true }).count(), 0, "a started publication has no reopen action");
  assert.equal(startedRoutes.reopenRequests, 0, "a started publication sends no reopen request");
  await expandTechnicalDetails(started, startedReview);
  await capture(started, "organizer-reopen-started-remote-record", { panel: startedReview });
  await started.close();

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
