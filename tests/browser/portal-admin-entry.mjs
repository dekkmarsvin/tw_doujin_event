// staged-data: fixture
// Real moved UI and transport; synthetic replies exercise the entry boundary.
// Authorization/data-integrity invariants stay in circle-portal-route tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, base } from "./support/journey.mjs";

const journey = await start("portal-admin-entry");
const map = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8"));
const now = Date.now();
async function open(role, entry = "admin") {
  const requests = [];
  const pending = [
    { id: "claim-one", eventId: "sample", circleId: "c-900001", circleName: "待審測試社", evidenceUrl: null, evidenceNote: "本人申請", targetUrl: null, createdAt: now, circleClaimed: false },
    { id: "claim-two", eventId: "sample-two", circleId: "c-900003", circleName: "第二場待審社", evidenceUrl: "https://example.test/circle", evidenceNote: null, targetUrl: null, createdAt: now, circleClaimed: false },
  ];
  let admins = [{ email: "admin@example.test", addedBy: "bootstrap", addedAt: now }];
  let notificationPreferences = { enabled: true, cadence: "five_minutes", version: 1 };
  let draftStatus = "submitted", failure = 0;
  const draft = () => ({ id: "map-one", event_id: "sample", period_key: "1", venue_space_id: "sample-hall", status: draftStatus, current_revision: 3,
    created_at: now, updated_at: now, decision_at: null, owner_email: "contributor@example.test", content: { schema: "map-contribution-draft/1", layout: map.layout } });
  const page = await journey.page({ url: `${base}/${entry}?event=sample`, routes: async page => {
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
        return reply({ claims: pending, mapDrafts: [{ eventId: "sample", submitted: draftStatus === "submitted" ? 1 : 0 }], organizer: { applications: 2, submissions: 1 } });
      }
      if (path === "/api/admin/notification-preferences") {
        if (failure) return reply({ error: "登入已失效。" }, failure);
        if (method === "PUT") notificationPreferences = { ...body, version: notificationPreferences.version + 1 };
        return reply(notificationPreferences);
      }
      if (path === "/api/admin/admins") {
        if (method === "POST") { admins = body.action === "add" ? [...admins, { email: body.email, addedBy: "admin@example.test", addedAt: now }] : admins.filter(x => x.email !== body.email); return reply({ ok: true }); }
        return reply({ admins, self: "admin@example.test" });
      }
      if (path === "/api/admin/overrides" || path === "/api/admin/accounts") return reply({ ok: true });
      if (path === "/api/admin/map-contributions/drafts") return reply({ drafts: url.searchParams.get("event") === "sample" ? [draft()] : [] });
      if (path === "/api/admin/map-contributions/drafts/map-one") return reply({ draft: draft(), files: [], reviews: [], comments: [], scope: null });
      if (path.endsWith("/map-one/review")) { draftStatus = "approved"; return reply({ ok: true }); }
      if (path.endsWith("/map-one/export")) return reply({ ok: true, candidate: map, diff: { previousRevision: 1, candidateRevision: 2, dimensionsChanged: false, floorChanged: false, addedBoothCodes: ["A01"], removedBoothCodes: [], movedBoothCodes: [], changedRowLabels: [], changedPillarIds: [], changedAccessPointIds: [], changedLandmarkIds: [] }, targetPath: "events/sample/map.json", candidateSha256: "a".repeat(64) });
      throw new Error(`Unexpected ${method} ${path}`);
    });
  } });
  return { page, requests, expire: () => { failure = 401; } };
}

/** The admin page is one column: a section wider than the rest reads as a
 * broken layout, whether or not it holds a map preview. */
async function assertOneColumn(page, label) {
  const boxes = await page.evaluate(() => ["#overview", "#admin", "#map-review", "#takedown", "#accounts"].map(id => {
    const box = document.querySelector(id).getBoundingClientRect();
    return { id, left: Math.round(box.left), width: Math.round(box.width) };
  }));
  assert.ok(boxes.every(box => box.left === boxes[0].left && box.width === boxes[0].width), `${label}: ${JSON.stringify(boxes)}`);
}

try {
  for (const role of ["anonymous", "member"]) {
    const { page, requests } = await open(role);
    await page.getByRole("heading", { name: role === "anonymous" ? "請先登入" : "需要管理者權限", exact: true }).waitFor();
    assert.equal(requests.filter(x => x.path.startsWith("/api/admin/")).length, 0);
    assert.equal(await page.getByRole("button", { name: "寄出登入連結", exact: true }).count(), 0);
    assert.equal(await page.locator("#admin").count(), 0);
    await journey.capture(page, `admin-${role}`);
    await page.close();
  }
  const { page, requests, expire } = await open("admin", "circle");
  await page.getByRole("link", { name: "管理", exact: true }).waitFor();
  assert.equal(requests.filter(x => x.path.startsWith("/api/admin/")).length, 0, "/circle must never load management data");
  assert.equal(await page.locator("#admin, #map-review").count(), 0);
  // The admin page is cross-event, so the link names no event.
  assert.equal(await page.getByRole("link", { name: "管理", exact: true }).getAttribute("href"), "/admin");
  await page.getByRole("link", { name: "管理", exact: true }).click();
  await page.getByRole("heading", { name: "網站管理", exact: true }).waitFor();
  const overview = page.locator("#overview"), panel = page.locator("#admin"), review = page.locator("#map-review");
  const takedown = page.locator("#takedown"), accounts = page.locator("#accounts");
  // Both events' claims on one page, before any event is chosen.
  await panel.getByText("待審測試社", { exact: true }).waitFor();
  await panel.getByText("第二場待審社", { exact: true }).waitFor();
  await overview.getByRole("link", { name: "前往主辦工作區", exact: true }).waitFor();
  await journey.capture(page, "admin-management-entry");
  await assertOneColumn(page, "no draft open");
  await panel.locator("li", { hasText: "待審測試社" }).getByRole("button", { name: "核准", exact: true }).click();
  await panel.getByText("已核准「待審測試社」。", { exact: true }).waitFor();
  assert.deepEqual(requests.find(x => x.path === "/api/admin/claims" && x.method === "POST"), { path: "/api/admin/claims", method: "POST", event: "sample", body: { claimId: "claim-one", decision: "approve" } });
  // A batch decides each claim under its own event, after a confirmation.
  await panel.getByRole("checkbox", { name: "選取第二場待審社（第二範例活動）", exact: true }).check();
  await panel.getByRole("button", { name: "婉拒已選", exact: true }).click();
  await panel.getByRole("dialog").getByText("第二場待審社", { exact: true }).waitFor();
  await journey.capture(page, "admin-batch-confirm");
  await panel.getByRole("dialog").getByRole("button", { name: "婉拒 1 筆", exact: true }).click();
  await panel.getByText("已婉拒 1 筆。", { exact: true }).waitFor();
  await panel.getByText("目前沒有待審項目。", { exact: true }).waitFor();
  assert.deepEqual(requests.filter(x => x.path === "/api/admin/claims" && x.method === "POST").at(-1), { path: "/api/admin/claims", method: "POST", event: "sample-two", body: { claimId: "claim-two", decision: "reject" } });
  await takedown.getByLabel("活動", { exact: true }).selectOption("sample");
  await takedown.getByLabel("社團 ID", { exact: true }).fill("c-900001");
  await takedown.getByLabel("原因", { exact: true }).fill("測試撤下");
  await takedown.getByRole("button", { name: "撤下", exact: true }).click();
  await takedown.getByText("已撤下。", { exact: true }).waitFor();
  await accounts.getByLabel("新增管理者 email", { exact: true }).fill("second@example.test");
  await accounts.getByRole("button", { name: "新增", exact: true }).click();
  await accounts.getByText("已新增管理者。", { exact: true }).waitFor();
  await accounts.getByRole("button", { name: "移除", exact: true }).click();
  await accounts.getByText("已移除管理者。", { exact: true }).waitFor();
  await accounts.getByLabel("帳號 email", { exact: true }).fill("disabled@example.test");
  await accounts.getByRole("button", { name: "停用", exact: true }).click();
  await accounts.getByText("帳號已停用。", { exact: true }).waitFor();
  const takedownRequest = requests.find(x => x.path === "/api/admin/overrides");
  assert.deepEqual(takedownRequest.body, { circleId: "c-900001", reason: "測試撤下" });
  assert.equal(takedownRequest.event, "sample");
  assert.deepEqual(requests.filter(x => x.path === "/api/admin/admins" && x.method === "POST").map(x => x.body.action), ["add", "remove"]);
  assert.equal(requests.find(x => x.path === "/api/admin/accounts").body.email, "disabled@example.test");

  await review.getByLabel("活動", { exact: true }).selectOption("sample");
  await review.getByRole("button", { name: "開啟", exact: true }).click();
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
  await assertOneColumn(page, "draft preview open");
  // The preview keeps the width it had when the section spanned the page: its
  // own 900px cap, inside a 1px border.
  const preview = await review.getByRole("group", { name: /草稿預覽 社團攤位配置圖/ }).boundingBox();
  assert.ok(preview.width >= 898, `the map preview is ${preview.width}px wide`);
  await review.evaluate(e => e.scrollIntoView({ block: "start" }));
  await journey.capture(page, "admin-map-candidate");
  await review.getByLabel("活動", { exact: true }).selectOption("sample-two");
  await review.getByText("目前沒有草稿。", { exact: true }).waitFor();
  assert.equal(await review.getByRole("button", { name: "下載地圖檔案", exact: true }).count(), 0);
  assert.ok(requests.some(x => x.path === "/api/admin/map-contributions/drafts" && x.event === "sample-two"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await journey.capture(page, "admin-narrow-event-switch");
  expire();
  await overview.getByRole("button", { name: "重新整理", exact: true }).click();
  await page.getByRole("link", { name: "前往社團入口登入", exact: true }).waitFor();
  assert.equal(await page.locator("#admin, #map-review").count(), 0);
  assert.equal(await page.getByRole("button", { name: "登出", exact: true }).count(), 0);
  await journey.capture(page, "admin-expired");
  await journey.finish();
} catch (error) { await journey.abort(error); }
