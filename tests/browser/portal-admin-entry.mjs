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
  const pending = [{ id: "claim-one", circleId: "c-900001", circleName: "待審測試社", evidenceNote: "本人申請" }];
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
      if (path === "/api/admin/claims") {
        if (failure) return reply({ error: "登入已失效。" }, failure);
        if (method === "POST") { pending.splice(0); return reply({ ok: true }); }
        return reply({ claims: url.searchParams.get("event") === "sample" ? pending : [], eventId: url.searchParams.get("event") });
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
  await page.getByRole("link", { name: "管理", exact: true }).click();
  await page.getByRole("heading", { name: "網站管理", exact: true }).waitFor();
  const panel = page.locator("#admin"), review = page.locator("#map-review");
  await panel.getByText("待審測試社", { exact: true }).waitFor();
  await journey.capture(page, "admin-management-entry");
  await panel.getByRole("button", { name: "核准", exact: true }).click();
  await panel.getByText("目前沒有待審項目。", { exact: true }).waitFor();
  assert.deepEqual(requests.find(x => x.path === "/api/admin/claims" && x.method === "POST"), { path: "/api/admin/claims", method: "POST", event: "sample", body: { claimId: "claim-one", decision: "approve" } });
  await panel.getByLabel("社團 ID", { exact: true }).fill("c-900001");
  await panel.getByLabel("原因", { exact: true }).fill("測試撤下");
  await panel.getByRole("button", { name: "撤下", exact: true }).click();
  await panel.getByText("已撤下。", { exact: true }).waitFor();
  await panel.getByLabel("新增管理者 email", { exact: true }).fill("second@example.test");
  await panel.getByRole("button", { name: "新增", exact: true }).click();
  await panel.getByText("已新增管理者。", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "移除", exact: true }).click();
  await panel.getByText("已移除管理者。", { exact: true }).waitFor();
  await panel.getByLabel("帳號 email", { exact: true }).fill("disabled@example.test");
  await panel.getByRole("button", { name: "停用", exact: true }).click();
  await panel.getByText("帳號已停用。", { exact: true }).waitFor();
  assert.deepEqual(requests.find(x => x.path === "/api/admin/overrides").body, { circleId: "c-900001", reason: "測試撤下" });
  assert.deepEqual(requests.filter(x => x.path === "/api/admin/admins" && x.method === "POST").map(x => x.body.action), ["add", "remove"]);
  assert.equal(requests.find(x => x.path === "/api/admin/accounts").body.email, "disabled@example.test");

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
  await review.evaluate(e => e.scrollIntoView({ block: "start" }));
  await journey.capture(page, "admin-map-candidate");
  await page.getByLabel("管理活動", { exact: true }).selectOption("sample-two");
  await review.getByText("目前沒有草稿。", { exact: true }).waitFor();
  assert.equal(await review.getByRole("button", { name: "下載地圖檔案", exact: true }).count(), 0);
  assert.ok(requests.some(x => x.path === "/api/admin/map-contributions/drafts" && x.event === "sample-two"));
  assert.equal(new URL(page.url()).searchParams.get("event"), "sample-two");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await journey.capture(page, "admin-narrow-event-switch");
  expire();
  await panel.getByRole("button", { name: "重新整理待審認領", exact: true }).click();
  await page.getByRole("link", { name: "前往社團入口登入", exact: true }).waitFor();
  assert.equal(await page.locator("#admin, #map-review").count(), 0);
  assert.equal(await page.getByRole("button", { name: "登出", exact: true }).count(), 0);
  await journey.capture(page, "admin-expired");
  await journey.finish();
} catch (error) { await journey.abort(error); }
