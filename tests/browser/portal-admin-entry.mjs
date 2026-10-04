// staged-data: fixture
// Real moved UI and transport; synthetic replies exercise the entry boundary.
// Authorization/data-integrity invariants stay in circle-portal-route tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, base } from "./support/journey.mjs";

const journey = await start("portal-admin-entry");
const map = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8"));
const now = Date.now();
async function open(role, entry = "/admin", implicitMapDraft = false, pendingService = false) {
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
  let serviceChecks = {
    requestedAt: now, checkedAt: pendingService ? null : now, mail: pendingService ? null : { status: "unavailable", source: "Mailgun", reason: "金鑰驗證失敗。" },
    publication: pendingService ? null : { status: "unavailable", source: "GitHub App", reason: "GitHub 拒絕發布授權。" },
  };
  const siteState = () => ({ settings: siteSettings, publicationMode: "github", services: serviceChecks, publicationActivities: [
    { id: "job-one", candidateId: "candidate-one", eventName: "正在發布的活動", status: "publishing", step: "waiting_deployment" },
    { id: "job-two", candidateId: "candidate-two", eventName: "已排程的活動", status: "queued", step: "preparing_data" },
  ] });
  let draftStatus = "submitted", failure = 0, settingsFailure = false;
  const comments = [];
  const draft = (eventId = "sample") => ({ id: "map-one", event_id: eventId, period_key: eventId === "sample" ? "1" : "thu", venue_space_id: eventId === "sample" ? "sample-hall" : "sample-two-floor", status: draftStatus, current_revision: 3,
    created_at: now, updated_at: now, decision_at: null, owner_email: "contributor@example.test", content: { schema: "map-contribution-draft/1", layout: map.layout } });
  const page = await journey.page({ url: `${base}${entry}`, routes: async page => {
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
        const eventId = url.searchParams.get("event"), claimId = url.searchParams.get("claim");
        const scoped = pending.filter(item => !eventId || item.eventId === eventId);
        return reply({ claims: scoped.filter(item => !claimId || item.id === claimId), pendingClaimCount: pending.length,
          claimCounts: ["sample", "sample-two"].map(eventId => ({ eventId, pending: pending.filter(item => item.eventId === eventId).length })),
          mapDrafts: [{ eventId: "sample", submitted: draftStatus === "submitted" ? 1 : 0 }], organizer: { applications: 2, submissions: 1 } });
      }
      if (path === "/api/organizer/events") return reply({ events: [{ id: "submitted-one", tentativeName: "待審活動內容", eventId: null,
        status: "submitted", version: 3, edition: 1, updatedAt: now, updatedByRole: "owner", role: "admin", workspaceMode: "guided" }] });
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
      if (path === "/api/admin/overrides" && method === "GET") return reply({ circles: [{ circleId: "c-900001", name: "待審測試社", status: "live" }] });
      if (path === "/api/admin/overrides" || path === "/api/admin/accounts") return reply({ ok: true });
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
  return { page, requests, expire: () => { failure = 401; }, failSettings: () => { settingsFailure = true; }, completeChecks: () => {
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
  await page.getByText("發布中 · 部署網站", { exact: true }).waitFor();
  await page.getByText("已排程 · 等待開始", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
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
  await page.getByRole("navigation", { name: "社團管理頁籤", exact: true }).getByRole("link", { name: "社團查詢與撤下", exact: true }).click();
  const takedown = page.locator("#takedown");
  const defaultSearchEvent = await takedown.getByLabel("活動", { exact: true }).inputValue();
  await takedown.getByLabel("社團名稱", { exact: true }).fill("待審測試社");
  await takedown.getByRole("button", { name: "搜尋", exact: true }).click();
  await takedown.getByRole("button", { name: "選擇待審測試社", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("event"), defaultSearchEvent);
  assert.equal(new URL(page.url()).searchParams.get("q"), "待審測試社");
  await takedown.getByLabel("活動", { exact: true }).selectOption("sample");
  await takedown.getByLabel("社團名稱", { exact: true }).fill("待審測試社");
  await takedown.getByRole("button", { name: "搜尋", exact: true }).click();
  await takedown.getByRole("button", { name: "選擇待審測試社", exact: true }).click();
  await takedown.getByLabel("原因", { exact: true }).fill("測試撤下");
  await takedown.getByRole("button", { name: "撤下", exact: true }).click();
  await takedown.getByRole("dialog").getByRole("button", { name: "確認撤下", exact: true }).click();
  await takedown.getByText("已撤下。", { exact: true }).waitFor();
  const takedownRequest = requests.find(x => x.path === "/api/admin/overrides" && x.method === "POST");
  assert.deepEqual(takedownRequest.body, { circleId: "c-900001", reason: "測試撤下" });
  assert.equal(takedownRequest.event, "sample");
  await navigate(page, "帳號管理");
  const accounts = page.locator("#accounts");
  await accounts.getByLabel("新增管理者 email", { exact: true }).fill("second@example.test");
  await accounts.getByRole("button", { name: "新增", exact: true }).click();
  await accounts.getByText("已新增管理者。", { exact: true }).waitFor();
  await accounts.getByRole("button", { name: "移除", exact: true }).click();
  await accounts.getByText("已移除管理者。", { exact: true }).waitFor();
  await accounts.getByLabel("帳號 email", { exact: true }).fill("disabled@example.test");
  await accounts.getByRole("button", { name: "停用", exact: true }).click();
  await accounts.getByText("帳號已停用。", { exact: true }).waitFor();
  assert.deepEqual(requests.filter(x => x.path === "/api/admin/admins" && x.method === "POST").map(x => x.body.action), ["add", "remove"]);
  assert.equal(requests.find(x => x.path === "/api/admin/accounts").body.email, "disabled@example.test");

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
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "重新整理" && !button.disabled));
  expire();
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
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
  await localFailure.page.getByRole("button", { name: "重新整理", exact: true }).click();
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
  await journey.finish();
} catch (error) { await journey.abort(error); }
