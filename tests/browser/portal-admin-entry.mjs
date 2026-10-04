// staged-data: fixture
// Real moved UI and transport; synthetic replies exercise the entry boundary.
// Authorization/data-integrity invariants stay in circle-portal-route tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, base, output } from "./support/journey.mjs";

const journey = await start("portal-admin-entry");
const map = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8"));
const now = Date.now();
async function open(role, entry = "/admin", implicitMapDraft = false, pendingService = false, viewport, eventOverview = false) {
  const requests = [];
  const pending = [
    { id: "claim-one", eventId: "sample", circleId: "c-900001", circleName: "待審測試社", evidenceUrl: null, evidenceNote: "本人申請", targetUrl: null, createdAt: now, circleClaimed: false },
    { id: "claim-two", eventId: "sample-two", circleId: "c-900003", circleName: "第二場待審社", evidenceUrl: "https://example.test/circle", evidenceNote: null, targetUrl: null, createdAt: now, circleClaimed: false },
  ];
  let admins = [{ email: "admin@example.test", addedBy: "bootstrap", addedAt: now }];
  let notificationPreferences = { enabled: true, cadence: "five_minutes", version: 1 };
  let siteSettings = { organizerApplicationMode: "closed", organizerAllowedEmails: [], accountNotificationsEnabled: false,
    accountNotificationsSince: null, adminReviewNotificationsEnabled: false, publicationEnabled: true, contactUrl: "", claimReviewNotice: "",
    updatedAt: now, updatedBy: "admin@example.test" };
  if (eventOverview) siteSettings.publicationEnabled = false;
  const submitted = { id: "submitted-one", tentativeName: "待審活動內容", eventId: null,
    status: "submitted", version: 3, edition: 1, dateRange: null, updatedAt: now, updatedByRole: "owner", role: "admin", workspaceMode: "guided" };
  const candidates = eventOverview ? [submitted,
    { ...submitted, id: "sample-original", eventId: "sample", tentativeName: "範例創作市集", operation: "CREATE", edition: 1, version: 40, status: "published", dateRange: { start: "2026-09-01", end: "2026-09-02" } },
    { ...submitted, id: "sample-failed-amend", eventId: "sample", tentativeName: "範例創作市集日期更正", operation: "AMEND", edition: 2, version: 44, status: "failed", dateRange: { start: "2026-11-01", end: "2026-11-02" }, workspaceMode: "binder" },
    { ...submitted, id: "sample-newer-amend", eventId: "sample", tentativeName: "範例創作市集日期更正", operation: "AMEND", edition: 3, version: 45, status: "draft", dateRange: null },
    { ...submitted, id: "unlinked-one", tentativeName: "同名草稿", status: "draft", dateRange: null },
    { ...submitted, id: "unlinked-two", tentativeName: "同名草稿", status: "draft", dateRange: { start: "2026-12-01", end: "2026-12-01" } },
  ] : [submitted];
  let serviceChecks = {
    requestedAt: now, checkedAt: pendingService ? null : now, mail: pendingService ? null : { status: "unavailable", source: "Mailgun", reason: "金鑰驗證失敗。" },
    publication: pendingService ? null : { status: "unavailable", source: "GitHub App", reason: "GitHub 拒絕發布授權。" },
  };
  const job = { eventId: null, edition: 1, candidateVersion: 3, currentVersion: 3, candidateStatus: "publishing", updatedAt: now, retryable: false };
  const publicationActivities = eventOverview ? [
    { ...job, id: "failed-amend-job", candidateId: "sample-failed-amend", eventId: "sample", eventName: "範例創作市集日期更正", edition: 2,
      candidateVersion: 44, currentVersion: 44, candidateStatus: "failed", status: "failed", step: "waiting_deployment", retryable: false },
    { ...job, id: "failed-retry-job", candidateId: "submitted-one", eventName: "可接續的活動", candidateStatus: "failed", status: "failed", step: "preparing_data", retryable: true },
    { ...job, id: "long-wait-job", candidateId: "unlinked-one", eventName: "等待發布的活動", status: "queued", step: "preparing_data", updatedAt: 1 },
  ] : [
    { ...job, id: "job-one", candidateId: "candidate-one", eventName: "正在發布的活動", status: "publishing", step: "waiting_deployment" },
    { ...job, id: "job-two", candidateId: "candidate-two", eventName: "已排程的活動", status: "queued", step: "preparing_data" },
  ];
  const siteState = () => ({ settings: siteSettings, publicationMode: eventOverview ? "disabled" : "github", services: serviceChecks, publicationActivities });
  let draftStatus = "submitted", failure = 0, settingsFailure = false;
  let detailFailure = 0, partialTakedown = false;
  let accountFailure = 0, grantFailure = 0, candidateFailure = 0, queueFailure = 0;
  const accountStatuses = new Map();
  const mapGrants = new Map();
  const accountDetail = email => {
    if (email === "missing@example.test") return { email, account: null };
    const related = email === "contributor@example.test";
    return { email, account: { email, status: accountStatuses.get(email) ?? (email === "deleting@example.test" ? "deleting" : "active"),
      createdAt: now, disabledAt: accountStatuses.get(email) === "disabled" ? now : null, deletionStartedAt: email === "deleting@example.test" ? now : null,
      isAdmin: admins.some(admin => admin.email === email),
      mapContributor: mapGrants.get(email) ?? { status: "none", grantedAt: null, revokedAt: null, suspendedAt: null },
      organizerGrants: related ? [
        { candidateId: "target-owner", eventId: "sample", name: "範例工作區", edition: 2, role: "owner", membersHref: "/organizer?candidate=target-owner&section=members" },
        { candidateId: "target-editor", eventId: null, name: "範例工作區", edition: 1, role: "editor", membersHref: "/organizer?candidate=target-editor&section=members" },
      ] : [],
      claims: related ? [
        { id: "target-verified", eventId: "sample", eventName: "範例創作市集", circleId: "c-900001", circleName: "待審測試社", status: "verified", createdAt: now,
          detailHref: "/admin?section=circles&view=search&event=sample&circle=c-900001", reviewHref: null },
        { id: "target-pending", eventId: "sample-two", eventName: "第二範例活動", circleId: "c-900001", circleName: "待審測試社", status: "pending", createdAt: now,
          detailHref: "/admin?section=circles&view=search&event=sample-two&circle=c-900001", reviewHref: "/admin?section=circles&view=claims&event=sample-two&claim=target-pending" },
      ] : [],
    } };
  };
  const supplementals = new Map();
  const circleDetail = eventId => {
    const supplemental = supplementals.get(eventId) ?? { status: "live", fields: { pen: eventId === "sample-two" ? "第二場作者" : "第一場作者", saleInfo: "已保存的品書介紹" }, updatedAt: now,
      postEventHidden: false, publicState: "public", publicReason: null, phase: "during", cleanupState: "not_required", takedown: null };
    return { eventId, circleId: "c-900001", name: "待審測試社", placements: [{ day: "1", area: "A", boothCode: "A01", status: "active" }],
      publicHref: `/events/${eventId}/circles/c-900001/`, organizerHref: null,
      claims: [{ id: "verified-one", status: "verified", method: "manual", accountEmail: "owner@example.test", accountStatus: "active", createdAt: now,
        verifiedAt: now, reviewedAt: now, reviewedBy: "admin@example.test", reviewHref: null }], supplemental,
      history: supplemental.takedown ? [{ action: "override.takendown", at: now, claimId: null, reason: supplemental.takedown.reason, by: "admin@example.test", retryCleanup: false }] : [] };
  };
  const comments = [];
  const draft = (eventId = "sample") => ({ id: "map-one", event_id: eventId, period_key: eventId === "sample" ? "1" : "thu", venue_space_id: eventId === "sample" ? "sample-hall" : "sample-two-floor", status: draftStatus, current_revision: 3,
    created_at: now, updated_at: now, decision_at: null, owner_email: "contributor@example.test", content: { schema: "map-contribution-draft/1", layout: map.layout } });
  const page = await journey.page({ url: `${base}${entry}`, viewport, routes: async page => {
    if (pendingService) await page.clock.install({ time: now });
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      const body = method === "GET" ? null : request.postDataJSON();
      requests.push({ path, method, event: url.searchParams.get("event"), body });
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/session") return role === "anonymous" ? reply({ error: "尚未登入。" }, 401)
        : reply({ email: `${role}@example.test`, isAdmin: role === "admin", isMapContributor: false, expiresAt: now + 86400000 });
      if (path === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (path === "/api/claims") return reply({ claims: [], eventId: url.searchParams.get("event") });
      if (path === "/api/admin/claims" && method === "POST") {
        if (failure) return reply({ error: "登入已失效。" }, failure);
        const index = pending.findIndex(x => x.id === body.claimId && x.eventId === url.searchParams.get("event"));
        if (index < 0) return reply({ error: "找不到這筆認領。" }, 404);
        pending.splice(index, 1);
        return reply({ ok: true });
      }
      if (path === "/api/admin/review-queue") {
        if (failure) return reply({ error: "登入已失效。" }, failure);
        if (queueFailure) return reply({ error: "無法取得待審摘要。" }, queueFailure);
        const eventId = url.searchParams.get("event"), claimId = url.searchParams.get("claim");
        const scoped = pending.filter(item => !eventId || item.eventId === eventId);
        return reply({ claims: scoped.filter(item => !claimId || item.id === claimId), pendingClaimCount: pending.length,
          claimCounts: ["sample", "sample-two"].map(eventId => ({ eventId, pending: eventOverview && eventId === "sample" ? 123 : pending.filter(item => item.eventId === eventId).length })),
          mapDrafts: [{ eventId: "sample", submitted: draftStatus === "submitted" ? 1 : 0 }], organizer: { applications: 2, submissions: 1 } });
      }
      if (path === "/api/organizer/events") return candidateFailure ? reply({ error: "無法取得活動工作版次。" }, candidateFailure) : reply({ events: candidates });
      if (path === "/api/organizer/events/sample-failed-amend") {
        const event = candidates.find(item => item.id === "sample-failed-amend");
        return reply({ event: { ...event, eventIdLocked: true }, publicationAvailable: false,
          draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: event.tentativeName, days: [] }, venue: { assignments: [] }, officialSource: { label: "", url: null } },
          venueCatalog: { venues: [] }, revisions: [], import: null,
          publication: { id: "failed-amend-job", status: "failed", step: "waiting_deployment", error: "測試發布未完成。", failureCode: "infrastructure_error", retryable: false, started: true, candidateVersion: 44, updatedAt: now },
          workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "event" },
            readiness: { completed: 5, total: 5, suggestedNextSection: "review", blockers: [], sections: ["event", "venue", "import", "map", "review"].map(id => ({ id, state: "complete" })) } } });
      }
      if (path === "/api/admin/notification-preferences") {
        if (failure) return reply({ error: "登入已失效。" }, failure);
        if (method === "PUT") notificationPreferences = { ...body, version: notificationPreferences.version + 1 };
        return reply(notificationPreferences);
      }
      if (path === "/api/admin/site-settings") {
        if (settingsFailure) return reply({ error: "無法取得網站設定。" }, 503);
        if (method === "PUT") {
          if (body.expectedUpdatedAt !== siteSettings.updatedAt) return reply({ error: "設定已變更，請重新載入。" }, 409);
          siteSettings = { ...siteSettings, ...body.settings, updatedAt: siteSettings.updatedAt + 1 };
        }
        return reply(siteState());
      }
      if (path === "/api/admin/service-check") return reply({ services: siteState().services });
      if (path === "/api/admin/admins") {
        if (method === "POST") { admins = body.action === "add" ? [...admins, { email: body.email, addedBy: "admin@example.test", addedAt: now }] : admins.filter(x => x.email !== body.email); return reply({ ok: true }); }
        return reply({ admins, self: "admin@example.test" });
      }
      if (path.startsWith("/api/admin/circles/")) {
        if (detailFailure) return reply({ error: "無法取得社團明細。" }, detailFailure);
        if (path !== "/api/admin/circles/c-900001") return reply({ error: "找不到這個社團。" }, 404);
        return reply(circleDetail(url.searchParams.get("event")));
      }
      if (path === "/api/admin/overrides" && method === "GET") {
        const supplemental = circleDetail(url.searchParams.get("event")).supplemental;
        return reply({ circles: [{ circleId: "c-900001", name: "待審測試社", status: supplemental.status, cleanupPending: supplemental.cleanupState === "pending" }] });
      }
      if (path === "/api/admin/overrides" && method === "POST") {
        const eventId = url.searchParams.get("event");
        supplementals.set(eventId, { ...circleDetail(eventId).supplemental, status: "takendown", publicState: "hidden", publicReason: "takendown",
          cleanupState: partialTakedown ? "pending" : "complete", takedown: { reason: body.reason, at: now, by: "admin@example.test" } });
        return partialTakedown ? reply({ error: "補充資料已撤下，但圖片清除尚未完成，請重試。" }, 503) : reply({ ok: true });
      }
      if (path === "/api/admin/accounts") {
        if (method === "GET" && url.searchParams.has("circle")) return reply({ query: url.searchParams.get("circle"), matches: url.searchParams.get("circle") === "待審" ? [
          { email: "contributor@example.test", circleName: "待審測試社", eventId: "sample", eventName: "範例創作市集", status: "verified" },
        ] : [] });
        if (method === "GET") return accountFailure ? reply({ error: "無法取得帳號明細。" }, accountFailure) : reply(accountDetail(url.searchParams.get("email")));
        if (admins.some(admin => admin.email === body.email)) return reply({ error: "請先移出管理者名單。" }, 409);
        accountStatuses.set(body.email, "disabled");
        return reply({ ok: true });
      }
      if (path === "/api/admin/map-contributors") {
        if (grantFailure) return reply({ error: "權限已變更，請重新讀取。" }, grantFailure);
        if (accountDetail(body.email).account.status !== "active") return reply({ error: "帳號目前無法使用。" }, 409);
        mapGrants.set(body.email, { status: body.action === "grant" ? "active" : body.action === "revoke" ? "revoked" : "suspended",
          grantedAt: now, revokedAt: body.action === "revoke" ? now : null, suspendedAt: body.action === "suspend" ? now : null });
        return reply({ ok: true });
      }
      if (path === "/api/admin/map-contributions/drafts") return reply({ drafts: implicitMapDraft || url.searchParams.get("event") === "sample" ? [draft(url.searchParams.get("event"))] : [] });
      if (path === "/api/admin/map-contributions/drafts/map-one") {
        if (!implicitMapDraft && url.searchParams.get("event") !== "sample") return reply({ error: "找不到這份草稿。" }, 404);
        return reply({ draft: draft(url.searchParams.get("event")), files: [{ id: "file-one", revision: 3, document_date: "2026-10-01", source_url: "https://example.test/map",
          mime: "image/png", raw_deleted_at: null, sha256: "b".repeat(64), review_result: "approved_official_source" }], reviews: [], comments, scope: null });
      }
      if (path === "/api/map-contributions/drafts/map-one/comments") {
        comments.push({ id: `comment-${comments.length}`, revision: 3, author_role: "admin", target_kind: null, target_ref: null, body: body.body, at: now });
        return reply({ ok: true });
      }
      if (path.endsWith("/map-one/review")) { draftStatus = "approved"; return reply({ ok: true }); }
      if (path.endsWith("/map-one/export")) return reply({ ok: true, candidate: map, diff: { previousRevision: 1, candidateRevision: 2, dimensionsChanged: false, floorChanged: false, addedBoothCodes: ["A01"], removedBoothCodes: [], movedBoothCodes: [], changedRowLabels: [], changedPillarIds: [], changedAccessPointIds: [], changedLandmarkIds: [] }, targetPath: "events/sample/map.json", candidateSha256: "a".repeat(64) });
      throw new Error(`Unexpected ${method} ${path}`);
    });
  } });
  return { page, requests, expire: () => { failure = 401; }, failSettings: () => { settingsFailure = true; },
    failAccount: status => { accountFailure = status; }, failGrant: status => { grantFailure = status; },
    failEvents: status => { candidateFailure = status; }, failQueue: status => { queueFailure = status; },
    failDetail: status => { detailFailure = status; }, partialCleanup: enabled => { partialTakedown = enabled; }, completeChecks: () => {
    serviceChecks = { requestedAt: now, checkedAt: now + 1, mail: { status: "available", source: "Mailgun", reason: "測試檢查已完成。" },
      publication: { status: "available", source: "GitHub App", reason: "測試檢查已完成。" } };
  } };
}

async function navigate(page, label) {
  const nav = page.getByRole("navigation", { name: "管理項目", exact: true });
  const link = nav.getByRole("link", { name: label, exact: true });
  await nav.waitFor();
  if (!(await link.isVisible()) && await nav.locator("summary").isVisible()) await nav.locator("summary").click();
  await link.click();
}
/** Admin panels re-read on focus instead of offering a 重新整理 button. */
async function refreshInBackground(page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function assertNoOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the management page stays inside the viewport");
}

try {
  for (const role of ["anonymous", "member"]) {
    const { page, requests } = await open(role, "/admin?section=events&view=maps&event=sample&draft=map-one");
    await page.getByRole("heading", { name: role === "anonymous" ? "請先登入" : "需要管理者權限", exact: true }).waitFor();
    assert.equal(requests.filter(x => x.path.startsWith("/api/admin/")).length, 0);
    assert.equal(await page.getByRole("button", { name: "寄出登入連結", exact: true }).count(), 0);
    assert.equal(await page.locator("#admin, #map-review").count(), 0);
    if (role === "anonymous") {
      const login = new URL(await page.getByRole("link", { name: "前往社團入口登入", exact: true }).getAttribute("href"), base);
      assert.equal(login.pathname, "/circle");
      assert.equal(login.searchParams.get("adminDraft"), "map-one");
      assert.equal(login.searchParams.get("adminEvent"), "sample");
    }
    await journey.capture(page, `admin-${role}`);
    await page.close();
  }
  const legacy = await open("admin", "/admin?event=sample");
  await legacy.page.locator("#admin").getByText("待審測試社", { exact: true }).waitFor();
  assert.equal(await legacy.page.getByText("第二場待審社", { exact: true }).count(), 0);
  assert.equal(await legacy.page.locator("#map-review, #takedown, #accounts").count(), 0);
  await legacy.page.locator("#admin").getByRole("button", { name: /第二範例活動/ }).click();
  await legacy.page.locator("#admin").getByText("第二場待審社", { exact: true }).waitFor();
  assert.equal(new URL(legacy.page.url()).searchParams.get("event"), "sample-two");
  assert.ok(legacy.requests.some(x => x.path === "/api/admin/review-queue" && x.event === "sample-two"));
  await legacy.page.reload();
  await legacy.page.locator("#admin").getByText("第二場待審社", { exact: true }).waitFor();
  await legacy.page.close();
  const preciseClaim = await open("admin", "/admin?section=circles&view=claims&event=sample-two&claim=claim-two");
  await preciseClaim.page.locator("[data-targeted]").getByText("第二場待審社", { exact: true }).waitFor();
  assert.equal(await preciseClaim.page.getByText("待審測試社", { exact: true }).count(), 0);
  await preciseClaim.page.waitForFunction(() => document.activeElement?.matches("[data-targeted]"));
  assert.equal(await preciseClaim.page.locator("[data-targeted]").evaluate(element => element === document.activeElement), true);
  await preciseClaim.page.close();

  const implicit = await open("admin", "/admin?section=events&view=maps", true);
  const implicitReview = implicit.page.locator("#map-review");
  const effectiveEvent = await implicitReview.getByLabel("活動", { exact: true }).inputValue();
  await implicitReview.getByRole("button", { name: "開啟", exact: true }).click();
  await implicitReview.getByLabel("審閱說明", { exact: true }).waitFor();
  assert.equal(new URL(implicit.page.url()).searchParams.get("event"), effectiveEvent, "opening a draft makes the default activity explicit in its URL");
  assert.equal(new URL(implicit.page.url()).searchParams.get("draft"), "map-one");
  await implicit.page.reload();
  await implicitReview.getByLabel("審閱說明", { exact: true }).waitFor();
  assert.equal(await implicitReview.getByLabel("活動", { exact: true }).inputValue(), effectiveEvent);
  await implicit.page.close();

  const { page, requests, expire } = await open("admin", "/circle?event=sample");
  await page.getByRole("banner").getByRole("button", { name: "帳號", exact: true }).click();
  await page.getByRole("link", { name: "網站管理", exact: true }).waitFor();
  assert.equal(requests.filter(x => x.path.startsWith("/api/admin/")).length, 0);
  assert.equal(await page.getByRole("link", { name: "網站管理", exact: true }).getAttribute("href"), "/admin");
  await page.getByRole("link", { name: "網站管理", exact: true }).click();
  await page.getByRole("heading", { name: "管理總覽", exact: true }).waitFor();
  const summary = page.locator('[aria-label="待審工作"]');
  for (const name of [/活動申請2/, /活動內容1/, /社團認領2/, /地圖投稿1/]) await summary.getByRole("link", { name }).waitFor();
  const tasks = page.locator('section[aria-labelledby="tasks-heading"]');
  assert.equal(await tasks.locator("li", { hasText: "待審活動內容" }).getByRole("link").getAttribute("href"), "/organizer?candidate=submitted-one&section=review");
  assert.equal(await tasks.getByRole("link", { name: "查看草稿", exact: true }).getAttribute("href"), "/admin?section=events&view=maps&event=sample");
  assert.equal(await page.locator("#admin, #map-review, #takedown, #accounts").count(), 0);
  await page.getByText("第 1 版 · 發布中 · 部署網站", { exact: true }).waitFor();
  await page.getByText("第 1 版 · 已排程 · 等待開始", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "重新整理", exact: true }).count(), 0, "the overview refreshes in the background");
  await refreshInBackground(page);
  await summary.getByRole("link", { name: /社團認領2/ }).waitFor();
  assert.equal(requests.filter(x => x.path === "/api/admin/service-check").length, 0);
  await assertNoOverflow(page);
  const evidenceStyle = await page.addStyleTag({ content: '[class*="identityWho"] { visibility: hidden !important; }' });
  await journey.capture(page, "admin-overview-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await journey.capture(page, "admin-overview-mobile");
  await evidenceStyle.evaluate(style => style.remove());
  await page.setViewportSize({ width: 1440, height: 900 });

  await summary.getByRole("link", { name: /社團認領/ }).click();
  const panel = page.locator("#admin");
  await panel.getByText("待審測試社", { exact: true }).waitFor();
  await panel.getByText("第二場待審社", { exact: true }).waitFor();
  await panel.locator("li", { hasText: "待審測試社" }).getByRole("button", { name: "核准", exact: true }).click();
  await panel.getByText("已核准「待審測試社」。", { exact: true }).waitFor();
  assert.deepEqual(requests.find(x => x.path === "/api/admin/claims" && x.method === "POST"), { path: "/api/admin/claims", method: "POST", event: "sample", body: { claimId: "claim-one", decision: "approve" } });
  await panel.getByRole("checkbox", { name: "選取第二場待審社（第二範例活動）", exact: true }).check();
  await panel.getByRole("button", { name: "婉拒已選", exact: true }).click();
  await panel.getByRole("dialog").getByText("第二場待審社", { exact: true }).waitFor();
  await journey.capture(page, "admin-batch-confirm");
  await panel.getByRole("dialog").getByRole("button", { name: "婉拒 1 筆", exact: true }).click();
  await panel.getByText("已婉拒 1 筆。", { exact: true }).waitFor();
  await panel.getByText("目前沒有待審項目。", { exact: true }).waitFor();
  assert.equal(requests.filter(x => x.path === "/api/admin/claims" && x.method === "POST").at(-1).event, "sample-two");
  await page.getByRole("navigation", { name: "社團管理頁籤", exact: true }).getByRole("link", { name: "社團查詢", exact: true }).click();
  const takedown = page.locator("#takedown");
  const defaultSearchEvent = await takedown.getByLabel("活動", { exact: true }).inputValue();
  await takedown.getByLabel("社團名稱", { exact: true }).fill("待審測試社");
  await takedown.getByRole("button", { name: "搜尋", exact: true }).click();
  await takedown.getByRole("button", { name: "查看待審測試社明細", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("event"), defaultSearchEvent);
  assert.equal(new URL(page.url()).searchParams.get("q"), "待審測試社");
  await takedown.getByLabel("活動", { exact: true }).selectOption("sample");
  await takedown.getByLabel("社團名稱", { exact: true }).fill("待審測試社");
  await takedown.getByRole("button", { name: "搜尋", exact: true }).click();
  await takedown.getByRole("button", { name: "查看待審測試社明細", exact: true }).click();
  await takedown.getByRole("heading", { name: "待審測試社", exact: true }).waitFor();
  await takedown.getByText("第一場作者", { exact: true }).waitFor();
  await takedown.getByText("公開中", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("circle"), "c-900001");
  assert.equal(new URL(page.url()).searchParams.get("event"), "sample");
  await page.reload();
  await takedown.getByText("第一場作者", { exact: true }).waitFor();
  await takedown.getByRole("button", { name: "返回搜尋結果", exact: true }).click();
  await takedown.getByRole("button", { name: "查看待審測試社明細", exact: true }).waitFor();
  assert.equal(await takedown.getByLabel("社團名稱", { exact: true }).inputValue(), "待審測試社");
  assert.equal(new URL(page.url()).searchParams.has("circle"), false);
  assert.equal(new URL(page.url()).searchParams.get("q"), "待審測試社");
  await takedown.getByRole("button", { name: "查看待審測試社明細", exact: true }).click();
  await takedown.getByText("第一場作者", { exact: true }).waitFor();
  await journey.capture(page, "admin-circle-detail-desktop");
  await page.screenshot({ path: `${output}/issue508-desktop.png`, fullPage: true,
    mask: [page.locator('[class*="identityWho"]'), page.locator('section[aria-labelledby="circle-claims-heading"] strong')] });
  await takedown.getByLabel("原因", { exact: true }).fill("測試撤下");
  await takedown.getByRole("button", { name: "撤下補充資料", exact: true }).click();
  await takedown.getByRole("dialog").getByRole("button", { name: "確認撤下", exact: true }).click();
  await takedown.getByText("已撤下。", { exact: true }).waitFor();
  const takedownRequest = requests.find(x => x.path === "/api/admin/overrides" && x.method === "POST");
  assert.deepEqual(takedownRequest.body, { circleId: "c-900001", reason: "測試撤下" });
  assert.equal(takedownRequest.event, "sample");
  assert.ok(requests.filter(x => x.path === "/api/admin/circles/c-900001").every(x => x.event === "sample"), "detail reloads keep the selected event");
  await navigate(page, "帳號管理");
  const accountPanel = page.locator('section[aria-labelledby="account-query-heading"]');
  await accountPanel.getByLabel("Email 或社團名稱", { exact: true }).fill("無此社團");
  await accountPanel.getByRole("button", { name: "查詢", exact: true }).click();
  await accountPanel.getByText("找不到名稱含「無此社團」的社團認領。", { exact: true }).waitFor();
  await accountPanel.getByLabel("Email 或社團名稱", { exact: true }).fill(" 待審 ");
  await accountPanel.getByRole("button", { name: "查詢", exact: true }).click();
  const circleMatches = accountPanel.locator('section[aria-label="社團名稱搜尋結果"]');
  await circleMatches.getByText("contributor@example.test", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), "待審", "a circle-name search is kept in the address");
  await page.reload();
  await circleMatches.getByText("範例創作市集・已認領", { exact: true }).waitFor();
  assert.equal(await circleMatches.getByRole("link", { name: "查看帳號", exact: true }).getAttribute("href"),
    "/admin?section=accounts&view=search&email=contributor%40example.test");
  await accountPanel.getByLabel("Email 或社團名稱", { exact: true }).fill("  CONTRIBUTOR@EXAMPLE.TEST  ");
  await accountPanel.getByRole("button", { name: "查詢", exact: true }).click();
  await accountPanel.getByRole("heading", { name: "contributor@example.test", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("email"), "contributor@example.test");
  assert.equal(new URL(page.url()).searchParams.get("event"), null, "account lookup clears an unrelated event selector");
  const workspaces = accountPanel.locator('section[aria-labelledby="account-workspaces-heading"]');
  await workspaces.getByText("負責人・第 2 版", { exact: true }).waitFor();
  await workspaces.getByText("協作者・第 1 版", { exact: true }).waitFor();
  assert.equal(await workspaces.getByRole("link", { name: "管理成員", exact: true }).count(), 2, "same-name candidates remain distinct target grants");
  assert.deepEqual(await workspaces.getByRole("link", { name: "管理成員", exact: true }).evaluateAll(links => links.map(link => link.getAttribute("href"))),
    ["/organizer?candidate=target-owner&section=members", "/organizer?candidate=target-editor&section=members"]);
  const accountClaims = accountPanel.locator('section[aria-labelledby="account-claims-heading"]');
  assert.deepEqual(await accountClaims.getByRole("link", { name: "查看社團明細", exact: true }).evaluateAll(links => links.map(link => new URL(link.href).searchParams.get("event"))), ["sample", "sample-two"]);
  assert.equal(new URL(await accountClaims.getByRole("link", { name: "前往認領審核", exact: true }).getAttribute("href"), base).searchParams.get("claim"), "target-pending");
  const mapGrant = accountPanel.locator('section[aria-labelledby="account-map-heading"]');
  await mapGrant.getByText("未授權", { exact: true }).waitFor();
  await mapGrant.getByRole("button", { name: "授予", exact: true }).click();
  await mapGrant.getByText("有效", { exact: true }).waitFor();
  const targetGrantPost = requests.filter(x => x.path === "/api/admin/map-contributors" && x.method === "POST").at(-1);
  assert.deepEqual(targetGrantPost.body, { email: "contributor@example.test", action: "grant" });
  assert.equal(targetGrantPost.event, null, "global map qualification does not inherit the circle event");
  const accountTabs = page.getByRole("navigation", { name: "帳號管理頁籤", exact: true });
  await accountTabs.getByRole("link", { name: "網站管理者", exact: true }).click();
  const accounts = page.locator("#accounts");
  await accounts.getByLabel("新增管理者 email", { exact: true }).fill("second@example.test");
  await accounts.getByRole("button", { name: "新增", exact: true }).click();
  await accounts.getByText("已新增管理者。", { exact: true }).waitFor();
  await accounts.getByRole("button", { name: "移除", exact: true }).click();
  await accounts.getByText("已移除管理者。", { exact: true }).waitFor();
  assert.deepEqual(requests.filter(x => x.path === "/api/admin/admins" && x.method === "POST").map(x => x.body.action), ["add", "remove"]);
  assert.equal(await accounts.getByRole("button", { name: "停用", exact: true }).count(), 0, "disabling is only available from a confirmed account detail");
  await accountTabs.getByRole("link", { name: "帳號查詢", exact: true }).click();
  await accountPanel.getByRole("heading", { name: "contributor@example.test", exact: true }).waitFor();
  await mapGrant.getByText("有效", { exact: true }).waitFor();
  await journey.capture(page, "admin-account-detail-desktop");
  await page.screenshot({ path: `${output}/issue509-desktop.png`, fullPage: true,
    mask: [page.locator('[class*="identityWho"]'), accountPanel.getByLabel("Email 或社團名稱", { exact: true }), accountPanel.getByRole("heading", { name: "contributor@example.test", exact: true })] });
  await accountPanel.getByLabel("Email 或社團名稱", { exact: true }).fill("disabled@example.test");
  await accountPanel.getByRole("button", { name: "查詢", exact: true }).click();
  await accountPanel.getByRole("heading", { name: "disabled@example.test", exact: true }).waitFor();
  await accountPanel.getByRole("button", { name: "停用帳號", exact: true }).click();
  await accountPanel.getByRole("dialog").getByRole("heading", { name: "停用「disabled@example.test」？", exact: true }).waitFor();
  await accountPanel.getByRole("dialog").getByRole("button", { name: "確認停用", exact: true }).click();
  await accountPanel.locator('section[aria-labelledby="account-disable-heading"]').getByText("帳號已停用。", { exact: true }).waitFor();
  assert.equal(requests.find(x => x.path === "/api/admin/accounts" && x.method === "POST").body.email, "disabled@example.test");
  assert.equal(await accountPanel.getByRole("button", { name: "授予", exact: true }).count(), 0, "disabled accounts cannot receive a map qualification");

  await navigate(page, "管理總覽");
  await page.getByRole("link", { name: "查看草稿", exact: true }).click();
  const review = page.locator("#map-review");
  await review.getByRole("button", { name: "開啟", exact: true }).click();
  await review.getByLabel("審閱說明", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("draft"), "map-one");
  assert.equal(await review.getByRole("link", { name: "下載上傳檔", exact: true }).getAttribute("href"), "/api/map-contributions/files/file-one?event=sample");
  assert.equal(await review.getByRole("link", { name: "預覽上傳檔", exact: true }).getAttribute("href"), "/api/map-contributions/files/file-one/preview?event=sample");
  await review.getByLabel("留言", { exact: true }).fill("請確認攤位位置。");
  await review.getByRole("button", { name: "送出留言", exact: true }).click();
  await review.getByText("留言已送出。", { exact: true }).waitFor();
  assert.equal(requests.find(x => x.path.endsWith("/map-one/comments")).event, "sample");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "核准", exact: true }).click();
  await review.getByRole("button", { name: "匯出地圖候選", exact: true }).click();
  await review.getByRole("button", { name: "下載地圖檔案", exact: true }).waitFor();
  await review.getByText("新增攤位：A01", { exact: true }).waitFor();
  const approval = requests.find(x => x.path.endsWith("/review"));
  assert.equal(approval.event, "sample");
  assert.equal(approval.body.expectedRevision, 3);
  assert.equal(approval.body.confirmOfficialSource, true);
  assert.deepEqual(requests.find(x => x.path.endsWith("/export")).body, { expectedRevision: 3 });
  assert.equal(requests.find(x => x.path.endsWith("/export")).event, "sample");
  await assertNoOverflow(page);
  await journey.capture(page, "admin-map-candidate");
  await review.getByLabel("活動", { exact: true }).selectOption("sample-two");
  await review.getByText("目前沒有草稿。", { exact: true }).waitFor();
  assert.equal(await review.getByRole("button", { name: "下載地圖檔案", exact: true }).count(), 0);
  assert.equal(new URL(page.url()).searchParams.has("draft"), false);
  assert.ok(requests.some(x => x.path === "/api/admin/map-contributions/drafts" && x.event === "sample-two"));
  await page.reload();
  assert.equal(await review.getByLabel("活動", { exact: true }).inputValue(), "sample-two");
  await navigate(page, "管理總覽");
  await summary.getByRole("link", { name: /社團認領0/ }).waitFor();
  expire();
  await refreshInBackground(page);
  await page.getByRole("link", { name: "前往社團入口登入", exact: true }).waitFor();
  assert.equal(await page.locator("#admin, #map-review").count(), 0);
  assert.equal(await page.getByRole("button", { name: "登出", exact: true }).count(), 0);
  await journey.capture(page, "admin-expired");

  const direct = await open("admin", "/admin?section=events&view=maps&event=sample&draft=map-one");
  const directReview = direct.page.locator("#map-review");
  await directReview.getByLabel("審閱說明", { exact: true }).waitFor();
  assert.ok(direct.requests.some(x => x.path === "/api/admin/map-contributions/drafts/map-one" && x.event === "sample"));
  await directReview.getByLabel("審閱說明", { exact: true }).fill("尚未送出的說明");
  direct.page.once("dialog", dialog => dialog.accept());
  await directReview.getByLabel("活動", { exact: true }).selectOption("sample-two");
  await directReview.getByText("目前沒有草稿。", { exact: true }).waitFor();
  await directReview.getByLabel("活動", { exact: true }).selectOption("sample");
  await directReview.getByRole("button", { name: "開啟", exact: true }).click();
  await directReview.getByLabel("審閱說明", { exact: true }).waitFor();
  assert.equal(await directReview.getByLabel("審閱說明", { exact: true }).inputValue(), "");
  await direct.page.close();
  const wrongDraft = await open("admin", "/admin?section=events&view=maps&event=sample-two&draft=map-one");
  await wrongDraft.page.getByText("找不到這份草稿。", { exact: true }).waitFor();
  assert.equal(await wrongDraft.page.getByLabel("審閱說明", { exact: true }).count(), 0);
  assert.equal(new URL(wrongDraft.page.url()).searchParams.get("event"), "sample-two");
  await wrongDraft.page.close();
  const localFailure = await open("admin");
  await localFailure.page.locator('[aria-label="待審工作"]').getByRole("link", { name: /社團認領2/ }).waitFor();
  localFailure.failSettings();
  await refreshInBackground(localFailure.page);
  await localFailure.page.getByRole("alert").filter({ hasText: "營運狀態更新失敗" }).waitFor();
  await localFailure.page.locator('[aria-label="待審工作"]').getByRole("link", { name: /社團認領2/ }).waitFor();
  assert.equal(await localFailure.page.getByText("待審活動內容", { exact: true }).count(), 1);
  assert.equal(localFailure.requests.filter(x => x.path === "/api/admin/service-check").length, 0);
  await localFailure.page.close();

  const pendingCheck = await open("admin", "/admin", false, true);
  const services = pendingCheck.page.locator('section[aria-labelledby="services-heading"]');
  await services.getByText("檢查中", { exact: true }).first().waitFor();
  assert.equal(await services.getByRole("button", { name: "檢查中…", exact: true }).isDisabled(), true);
  assert.equal(pendingCheck.requests.filter(x => x.path === "/api/admin/service-check").length, 0, "loading an existing pending check only resumes its read-only wait");
  pendingCheck.completeChecks();
  await services.getByText("最近檢查可用", { exact: true }).first().waitFor();
  assert.equal(await services.getByRole("button", { name: "檢查服務", exact: true }).isEnabled(), true);
  assert.ok(pendingCheck.requests.filter(x => x.path === "/api/admin/site-settings" && x.method === "GET").length >= 2);
  assert.equal(pendingCheck.requests.filter(x => x.path === "/api/admin/service-check").length, 0);
  await pendingCheck.page.close();

  const timedOutCheck = await open("admin", "/admin", false, true);
  const timedOutServices = timedOutCheck.page.locator('section[aria-labelledby="services-heading"]');
  await timedOutServices.getByText("檢查中", { exact: true }).first().waitFor();
  await timedOutCheck.page.clock.fastForward(91_000);
  await timedOutCheck.page.getByRole("alert").getByText("尚未收到排程服務的檢查結果，請稍後重新檢查。", { exact: false }).waitFor();
  assert.equal(await timedOutServices.getByText("無法確認", { exact: true }).count(), 2);
  assert.equal(await timedOutServices.getByText("尚未檢查", { exact: true }).count(), 0);
  assert.equal(timedOutCheck.requests.filter(x => x.path === "/api/admin/service-check").length, 0);
  await timedOutCheck.page.close();

  const settingsPage = await open("admin");
  await navigate(settingsPage.page, "網站設定");
  await settingsPage.page.getByRole("switch", { name: "全站寄送待審通知", exact: true }).check();
  await settingsPage.page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await settingsPage.page.getByText("已生效", { exact: true }).waitFor();
  await settingsPage.page.reload();
  assert.equal(await settingsPage.page.getByRole("switch", { name: "全站寄送待審通知", exact: true }).isChecked(), true);
  assert.equal(await settingsPage.page.getByRole("switch", { name: "處理發布作業", exact: true }).isEnabled(), true);
  await settingsPage.page.getByText("Mailgun：金鑰驗證失敗。", { exact: true }).waitFor();
  await settingsPage.page.getByText("GitHub App：GitHub 拒絕發布授權。", { exact: true }).waitFor();
  assert.equal(settingsPage.requests.filter(x => x.path === "/api/admin/site-settings" && x.method === "PUT").length, 1);
  await journey.capture(settingsPage.page, "admin-site-settings");
  await navigate(settingsPage.page, "管理總覽");
  const operations = settingsPage.page.locator('section[aria-labelledby="operations-heading"]');
  const savedReviewSetting = operations.locator("div").filter({ has: settingsPage.page.locator("dt", { hasText: "待審通知" }) });
  await savedReviewSetting.getByText("開啟", { exact: true }).waitFor();
  await settingsPage.page.locator("summary", { hasText: "我的帳號" }).click();
  await settingsPage.page.getByRole("link", { name: "我的通知設定", exact: true }).click();
  await settingsPage.page.getByRole("heading", { name: "待審通知", exact: true }).waitFor();
  await settingsPage.page.getByLabel("接收待審通知", { exact: true }).uncheck();
  await settingsPage.page.getByRole("button", { name: "儲存設定", exact: true }).click();
  await settingsPage.page.getByText("通知設定已儲存。", { exact: true }).waitFor();
  await navigate(settingsPage.page, "管理總覽");
  await savedReviewSetting.getByText("開啟", { exact: true }).waitFor();
  assert.equal(settingsPage.requests.filter(x => x.path === "/api/admin/service-check").length, 0);
  await settingsPage.page.setViewportSize({ width: 390, height: 844 });
  await settingsPage.page.locator('nav[aria-label="管理項目"] details:not([open])').waitFor();
  await assertNoOverflow(settingsPage.page);
  await navigate(settingsPage.page, "社團管理");
  await settingsPage.page.locator("#admin").getByText("待審測試社", { exact: true }).waitFor();
  await journey.capture(settingsPage.page, "admin-claims-mobile");
  await settingsPage.page.close();

  const circleMobile = await open("admin", "/admin?section=circles&view=search&event=sample-two&q=待審測試社&circle=c-900001", false, false, { width: 390, height: 844 });
  await circleMobile.page.locator('nav[aria-label="管理項目"] details:not([open])').waitFor();
  const mobileCircle = circleMobile.page.locator("#takedown");
  await mobileCircle.getByText("第二場作者", { exact: true }).waitFor();
  assert.equal(await mobileCircle.getByText("第一場作者", { exact: true }).count(), 0, "the same circle id does not carry another event's saved content");
  await assertNoOverflow(circleMobile.page);
  await journey.capture(circleMobile.page, "admin-circle-detail-mobile");
  await circleMobile.page.screenshot({ path: `${output}/issue508-mobile.png`, fullPage: true,
    mask: [circleMobile.page.locator('[class*="identityWho"]'), circleMobile.page.locator('section[aria-labelledby="circle-claims-heading"] strong')] });
  circleMobile.partialCleanup(true);
  await mobileCircle.getByLabel("原因", { exact: true }).fill("測試圖片清除接續");
  await mobileCircle.getByRole("button", { name: "撤下補充資料", exact: true }).click();
  await mobileCircle.getByRole("dialog").getByRole("button", { name: "確認撤下", exact: true }).click();
  await mobileCircle.getByText("仍待清除", { exact: true }).waitFor();
  await mobileCircle.getByText("已撤下", { exact: true }).first().waitFor();
  assert.equal(await mobileCircle.getByText("公開中", { exact: true }).count(), 0, "a failed image cleanup does not conceal that the data was taken down");
  circleMobile.partialCleanup(false);
  await mobileCircle.getByRole("button", { name: "清除剩餘圖片", exact: true }).click();
  await mobileCircle.getByRole("dialog").getByRole("button", { name: "確認撤下", exact: true }).click();
  await mobileCircle.getByText("已清除", { exact: true }).waitFor();
  const imageRetries = circleMobile.requests.filter(x => x.path === "/api/admin/overrides" && x.method === "POST");
  assert.equal(imageRetries.length, 2);
  assert.ok(imageRetries.every(x => x.event === "sample-two" && x.body.circleId === "c-900001" && x.body.reason === "測試圖片清除接續"), "cleanup resumes the original exact-event takedown");
  await journey.capture(circleMobile.page, "admin-circle-cleanup-complete-mobile");
  circleMobile.failDetail(503);
  await circleMobile.page.reload();
  await mobileCircle.getByText("無法取得社團明細。", { exact: true }).waitFor();
  assert.equal(await mobileCircle.getByText("沒有補充資料", { exact: true }).count(), 0, "read failure does not become an empty record");
  circleMobile.failDetail(0);
  await circleMobile.page.reload();
  await mobileCircle.getByText("已清除", { exact: true }).waitFor();
  await circleMobile.page.close();

  const missingCircle = await open("admin", "/admin?section=circles&view=search&event=sample&circle=missing-circle");
  await missingCircle.page.getByText("找不到這個社團。", { exact: true }).waitFor();
  assert.equal(await missingCircle.page.getByText("第一場作者", { exact: true }).count(), 0, "an invalid exact circle never opens the first result");
  assert.equal(new URL(missingCircle.page.url()).searchParams.get("circle"), "missing-circle");
  await missingCircle.page.close();

  const accountMobile = await open("admin", "/admin?section=accounts&view=search&event=sample-two&email=contributor%40example.test", false, false, { width: 390, height: 844 });
  const mobileAccount = accountMobile.page.locator('section[aria-labelledby="account-query-heading"]');
  const mobileGrant = mobileAccount.locator('section[aria-labelledby="account-map-heading"]');
  await mobileAccount.getByRole("heading", { name: "contributor@example.test", exact: true }).waitFor();
  await assertNoOverflow(accountMobile.page);
  assert.ok(accountMobile.requests.filter(x => x.path === "/api/admin/accounts").every(x => x.event === null), "account reads ignore an unrelated activity filter even on a deep link");
  await mobileGrant.getByRole("button", { name: "授予", exact: true }).click();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  accountMobile.failGrant(409);
  await mobileGrant.getByRole("button", { name: "撤銷", exact: true }).click();
  await mobileAccount.getByText("權限已變更，請重新讀取。", { exact: true }).waitFor();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  assert.equal(await mobileAccount.getByLabel("Email 或社團名稱", { exact: true }).inputValue(), "contributor@example.test", "a failed grant operation keeps its target");
  accountMobile.failGrant(0);
  await mobileGrant.getByRole("button", { name: "停權", exact: true }).click();
  await mobileGrant.getByText("已停權", { exact: true }).waitFor();
  await mobileGrant.getByRole("button", { name: "重新授予", exact: true }).click();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  await mobileGrant.getByRole("button", { name: "撤銷", exact: true }).click();
  await mobileGrant.getByText("已撤銷", { exact: true }).waitFor();
  await mobileGrant.getByRole("button", { name: "重新授予", exact: true }).click();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  const grantPosts = accountMobile.requests.filter(x => x.path === "/api/admin/map-contributors" && x.method === "POST");
  assert.deepEqual(grantPosts.map(x => x.body.action), ["grant", "revoke", "suspend", "grant", "revoke", "grant"]);
  assert.ok(grantPosts.every(x => x.event === null && x.body.email === "contributor@example.test"));
  await accountMobile.page.reload();
  await mobileAccount.getByRole("heading", { name: "contributor@example.test", exact: true }).waitFor();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  await accountMobile.page.locator('nav[aria-label="管理項目"] details:not([open])').waitFor();
  await journey.capture(accountMobile.page, "admin-account-detail-mobile");
  await accountMobile.page.screenshot({ path: `${output}/issue509-mobile.png`, fullPage: true,
    mask: [accountMobile.page.locator('[class*="identityWho"]'), mobileAccount.getByLabel("Email 或社團名稱", { exact: true }), mobileAccount.getByRole("heading", { name: "contributor@example.test", exact: true })] });
  accountMobile.failAccount(503);
  await accountMobile.page.reload();
  await mobileAccount.getByText("無法取得帳號明細。", { exact: true }).waitFor();
  assert.equal(await mobileAccount.getByText("查無此帳號。", { exact: true }).count(), 0, "a read failure does not become a missing account");
  accountMobile.failAccount(0);
  await mobileAccount.getByRole("button", { name: "重新讀取", exact: true }).click();
  await mobileGrant.getByText("有效", { exact: true }).waitFor();
  for (const [email, expected] of [["empty@example.test", "無活動工作區權限。"], ["missing@example.test", "查無此帳號。"], ["deleting@example.test", "帳號正在刪除，無法停用。"], ["admin@example.test", "請先移出管理者名單。"]]) {
    await mobileAccount.getByLabel("Email 或社團名稱", { exact: true }).fill(email);
    await mobileAccount.getByRole("button", { name: "查詢", exact: true }).click();
    await mobileAccount.getByText(expected, { exact: email !== "admin@example.test" }).waitFor();
  }
  const adminRestriction = mobileAccount.locator('section[aria-labelledby="account-disable-heading"]');
  assert.equal(await adminRestriction.getByRole("button", { name: "停用帳號", exact: true }).count(), 0);
  const rosterDestination = new URL(await adminRestriction.getByRole("link", { name: "前往網站管理者", exact: true }).getAttribute("href"), base);
  assert.equal(rosterDestination.searchParams.get("view"), "admins");
  assert.equal(accountMobile.requests.filter(x => x.path === "/api/admin/accounts" && x.method === "POST").length, 0, "read-only lookups and map grants do not create or disable accounts");
  await accountMobile.page.close();

  const legacyAccounts = await open("admin", "/admin#accounts");
  await legacyAccounts.page.locator("#accounts").getByRole("heading", { name: "網站管理者", exact: true }).waitFor();
  assert.equal(legacyAccounts.requests.filter(x => x.path === "/api/admin/accounts").length, 0, "the old roster link remains a roster destination");
  await legacyAccounts.page.close();

  const eventDesktop = await open("admin", "/admin?section=events", false, false, { width: 1440, height: 900 }, true);
  const index = eventDesktop.page.locator('[aria-label="完整活動總表"]');
  await index.getByRole("article", { name: "同名草稿", exact: true }).first().waitFor();
  assert.equal(await index.getByRole("article").count(), 5, "public-only activities and unidentified drafts join one activity index without duplicating amendments");
  assert.equal(await index.getByRole("article", { name: "同名草稿", exact: true }).count(), 2);
  const sampleEntry = index.getByRole("article", { name: "範例創作市集", exact: true });
  const publicVersion = sampleEntry.locator('section[aria-label="目前公開內容"]');
  const workVersions = sampleEntry.locator('section[aria-label="工作版次"]');
  await sampleEntry.getByText("認領待審 123", { exact: true }).waitFor();
  assert.equal(await publicVersion.getByText("已公開", { exact: true }).count(), 1);
  assert.equal(await publicVersion.getByText("2026.09.01–02", { exact: true }).count(), 1);
  await workVersions.getByText("2026年11月1日至2日", { exact: true }).waitFor();
  assert.equal(await workVersions.getByText("第 2 版 · 發布失敗", { exact: true }).count(), 1);
  assert.equal(await workVersions.getByText("第 44 版", { exact: false }).count(), 0, "storage revisions are not workspace editions");
  assert.deepEqual(await index.evaluate(list => [...list.children].map(item => item.tagName === "ARTICLE" ? (item.querySelector("header p")?.textContent.includes("已結束") ? "ended" : "current") : item.textContent))
    .then(order => [...new Set(order)]), ["current", "已結束", "ended"], "ended activities sit under one divider after the current ones");
  const publicOnly = index.getByRole("article", { name: "第二範例活動", exact: true });
  await publicOnly.getByText("無工作區", { exact: true }).waitFor();
  assert.equal(await publicOnly.getByRole("link", { name: "開啟工作區", exact: true }).count(), 0);
  assert.equal(await publicOnly.getByRole("link", { name: "查看公開頁", exact: true }).getAttribute("href"), "/events/sample-two/");
  const publications = eventDesktop.page.locator('section[aria-labelledby="publication-jobs-heading"]');
  await publications.getByText("第 2 版 · 未完成 · 部署網站", { exact: true }).waitFor();
  assert.equal(await publications.getByRole("link", { name: "查看處理方式", exact: true }).count(), 2, "failed jobs stay visible with publishing disabled and regardless of retry permission");
  await publications.getByText("第 1 版 · 已排程 · 已暫停", { exact: true }).waitFor();
  assert.equal(eventDesktop.requests.filter(request => request.path.startsWith("/api/organizer/events/")).length, 0, "the index does not read every private workspace");
  assert.equal(eventDesktop.requests.filter(request => request.path === "/api/admin/service-check").length, 0);
  await assertNoOverflow(eventDesktop.page);
  await journey.capture(eventDesktop.page, "admin-event-list-desktop");
  await eventDesktop.page.screenshot({ path: `${output}/issue510-desktop.png`, fullPage: true, mask: [eventDesktop.page.locator('[class*="identityWho"]')] });
  const failedItem = publications.locator("li", { hasText: "範例創作市集日期更正" });
  assert.equal(await failedItem.getByRole("link").getAttribute("href"), "/organizer?candidate=sample-failed-amend&section=review");
  await failedItem.getByRole("link", { name: "查看處理方式", exact: true }).click();
  await eventDesktop.page.getByRole("heading", { name: "檢查與發布", exact: true }).waitFor();
  assert.equal(await eventDesktop.page.getByRole("combobox", { name: "活動版本", exact: true }).inputValue(), "sample-failed-amend", "a newer edition does not replace the requested failed workspace");
  assert.equal(new URL(eventDesktop.page.url()).searchParams.get("section"), "review");
  assert.equal(await eventDesktop.page.getByRole("button", { name: "重試發布", exact: true }).count(), 0);
  assert.ok(eventDesktop.requests.some(request => request.path === "/api/organizer/events/sample-failed-amend"));
  await eventDesktop.page.goBack();
  await eventDesktop.page.getByRole("link", { name: "活動總表", exact: true }).and(eventDesktop.page.locator('[aria-current="page"]')).waitFor();
  await sampleEntry.getByText("認領待審 123", { exact: true }).waitFor();
  eventDesktop.failEvents(503);
  eventDesktop.failQueue(503);
  await refreshInBackground(eventDesktop.page);
  await eventDesktop.page.getByRole("alert").filter({ hasText: "活動內容更新失敗" }).waitFor();
  await eventDesktop.page.getByRole("alert").filter({ hasText: "待審摘要更新失敗" }).waitFor();
  await sampleEntry.getByText("認領待審 123", { exact: true }).waitFor();
  assert.equal(await workVersions.getByText("第 2 版 · 發布失敗", { exact: true }).count(), 1, "a failed refresh preserves the displayed editions and counts");
  await journey.capture(eventDesktop.page, "admin-event-list-refresh-error");
  await eventDesktop.page.reload();
  await index.getByText("無法取得工作版次。", { exact: true }).first().waitFor();
  await sampleEntry.getByText("認領待審 —", { exact: true }).waitFor();
  assert.equal(await sampleEntry.getByText("認領待審 0", { exact: true }).count(), 0);
  assert.equal(await publicVersion.getByText("已公開", { exact: true }).count(), 1, "a candidate read failure still leaves the known public edition available");
  await eventDesktop.page.close();

  const eventMobile = await open("admin", "/admin?section=events&view=list", false, false, { width: 390, height: 844 }, true);
  const mobileIndex = eventMobile.page.locator('[aria-label="完整活動總表"]');
  await mobileIndex.getByRole("article", { name: "範例創作市集", exact: true }).getByText("認領待審 123", { exact: true }).waitFor();
  await assertNoOverflow(eventMobile.page);
  await journey.capture(eventMobile.page, "admin-event-list-mobile");
  await eventMobile.page.screenshot({ path: `${output}/issue510-mobile.png`, fullPage: true, mask: [eventMobile.page.locator('[class*="identityWho"]')] });
  await eventMobile.page.locator('section[aria-labelledby="publication-jobs-heading"] li', { hasText: "範例創作市集日期更正" }).getByRole("link", { name: "查看處理方式", exact: true }).click();
  await eventMobile.page.getByRole("heading", { name: "範例創作市集日期更正", exact: true }).waitFor();
  assert.equal(new URL(eventMobile.page.url()).searchParams.get("candidate"), "sample-failed-amend");
  await eventMobile.page.getByText("目前狀態：發布失敗", { exact: true }).waitFor();
  await eventMobile.page.goBack();
  await eventMobile.page.getByRole("link", { name: "活動總表", exact: true }).and(eventMobile.page.locator('[aria-current="page"]')).waitFor();
  await assertNoOverflow(eventMobile.page);
  assert.equal(eventMobile.requests.filter(request => request.method !== "GET").length, 0, "overview navigation only reads existing progress");
  await eventMobile.page.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
