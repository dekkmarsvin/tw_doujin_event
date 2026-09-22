// staged-data: portal
import assert from "node:assert/strict";
import { ADMIN, CIRCLE, clearMail, signIn } from "./support/portal.mjs";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-organizer-applications");
try {
  await clearMail();
  const reader = await journey.page({ url: `${base}/?event=unknown` });
  await reader.getByRole("heading", { name: "選擇活動" }).waitFor();
  assert.equal(await reader.getByRole("link", { name: "申請建置活動" }).count(), 0);
  assert.equal(await reader.evaluate(async () => (await fetch("/api/organizer/applications")).status), 401);
  await journey.capture(reader, "applications-public-entry-closed");

  const applicant = await signIn(journey, CIRCLE, "organizer", { viewport: { width: 390, height: 844 } });
  await applicant.getByRole("heading", { name: "我的活動申請" }).waitFor();
  async function fill(name) {
    await applicant.getByLabel("活動名稱", { exact: true }).fill(name);
    await applicant.getByLabel("官方網站或官方社群網址").fill("https://official.example/event");
    await applicant.getByLabel("預計開始日期").fill("2026-12-05");
    await applicant.getByLabel("預計結束日期").fill("2026-12-06");
    await applicant.getByLabel("與活動的關係").selectOption("curator");
    await applicant.getByLabel("整理理由").fill("依官方來源整理活動與攤位資料。");
  }
  await fill("申請驗收：已有活動");
  await journey.capture(applicant, "application-form-mobile");
  await applicant.getByRole("button", { name: "送出申請", exact: true }).click();
  await applicant.getByRole("article", { name: "申請驗收：已有活動", exact: true }).getByText("待審核", { exact: true }).waitFor();
  assert.equal(await applicant.getByRole("link", { name: "進入活動工作區" }).count(), 0);
  await journey.capture(applicant, "application-pending-mobile");

  const admin = await signIn(journey, ADMIN, "organizer");
  // The ordinary public API remains closed even for an admin not on the
  // controlled applicant list. Authorization does not silently open rollout.
  assert.equal(await admin.evaluate(async () => (await fetch("/api/organizer/applications", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status), 403);
  await admin.getByRole("button", { name: "活動申請", exact: true }).click();
  let card = admin.getByRole("article", { name: "申請驗收：已有活動", exact: true });
  await card.getByLabel("審核結果").selectOption("rejected");
  await card.getByLabel("審核說明（必填）").fill("活動已存在，請由原負責人邀請協作。");
  await card.getByRole("button", { name: "確認審核", exact: true }).click();
  await card.getByText("未核准", { exact: true }).waitFor();
  await applicant.getByRole("button", { name: "更新狀態" }).click();
  await applicant.getByText("審核說明：活動已存在，請由原負責人邀請協作。", { exact: true }).waitFor();
  await journey.capture(applicant, "application-rejected-mobile");

  await fill("申請驗收：新活動");
  await applicant.getByRole("button", { name: "送出申請", exact: true }).click();
  await applicant.getByRole("article", { name: "申請驗收：新活動", exact: true }).waitFor();
  await admin.getByRole("button", { name: "更新狀態" }).click();
  card = admin.getByRole("article", { name: "申請驗收：新活動", exact: true });
  await card.getByText("資料整理者", { exact: true }).waitFor();
  assert.equal(await card.getByRole("link", { name: "https://official.example/event", exact: true }).getAttribute("href"), "https://official.example/event");
  await journey.capture(admin, "application-admin-review");
  await card.getByRole("button", { name: "確認審核", exact: true }).click();
  await card.getByText("已核准建置", { exact: true }).waitFor();
  await applicant.reload();
  await applicant.getByRole("article", { name: "申請驗收：新活動", exact: true }).getByText("已核准建置", { exact: true }).waitFor();
  await applicant.setViewportSize({ width: 320, height: 740 });
  await journey.capture(applicant, "application-approved-320");
  await applicant.setViewportSize({ width: 1440, height: 900 });
  // Returning to the application list keeps the selected candidate's actual
  // grant; the link uses the existing workspace resume path.
  await applicant.getByRole("button", { name: "活動申請", exact: true }).click();
  await applicant.getByRole("article", { name: "申請驗收：新活動", exact: true }).getByRole("link", { name: "進入活動工作區" }).click();
  await applicant.getByRole("navigation", { name: "活動列表" }).getByRole("button", { name: /申請驗收：新活動/ }).waitFor();
  const events = await applicant.evaluate(async () => (await (await fetch("/api/organizer/events")).json()).events);
  assert.equal(events.length, 1); assert.equal(events[0].role, "owner"); assert.equal(events[0].status, "draft");
  await journey.capture(applicant, "application-approved-workspace");
  // Same-origin middleware still refuses a foreign Origin on the new route.
  const csrf = await applicant.request.post(`${base}/api/organizer/applications`, { headers: { origin: "https://foreign.example", "content-type": "application/json" }, data: {} });
  assert.equal(csrf.status(), 403);
  await journey.finish();
} catch (error) { await journey.abort(error); }
