// staged-data: portal
// Synthetic replies exercise the shared form and Organizer navigation.
// Event authorization, content CAS and R2 recovery are covered by real D1 tests.
import assert from "node:assert/strict";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-organizer-social-management");
const now = Date.now();
const summaries = [
  { id: "social-latest", edition: 2, createdAt: now, status: "submitted", operation: "AMEND" },
  { id: "social-original", edition: 1, createdAt: now - 1, status: "published", operation: "CREATE" },
].map(event => ({ ...event, eventId: "sample", tentativeName: "社團處置測試", version: 1, updatedAt: now, updatedByRole: "owner", role: "editor", workspaceMode: "binder" }));
const detail = id => ({ claimReviewAvailable: true, event: { ...summaries.find(event => event.id === id), eventIdLocked: true },
  draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: "社團處置測試", days: [] }, venue: { assignments: [] }, officialSource: { label: "", url: null } },
  venueCatalog: { venues: [] }, revisions: [], import: null, publication: null,
  workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "review" },
    readiness: { completed: 5, total: 6, suggestedNextSection: "review", blockers: [], sections: [] } } });
let status = "live";
const writes = [];
try {
  const page = await journey.page({ url: `${base}/organizer`, routes: async page => {
    await page.route("**/api/**", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const reply = value => route.fulfill({ json: value });
      if (path === "/api/auth/session") return reply({ email: "editor@example.test", hasOrganizerAccess: true, isAdmin: false, isMapContributor: false, expiresAt: now + 86400000 });
      if (path === "/api/organizer/events") return reply({ events: summaries });
      if (path.endsWith("/claims")) return reply({ claims: [], mapDrafts: [], organizer: { applications: 0, submissions: 0 } });
      if (path.endsWith("/overrides")) {
        if (req.method() === "POST") { writes.push({ candidate: path.split("/")[4], ...req.postDataJSON() }); status = "takendown"; return reply({ ok: true }); }
        return reply({ circles: url.searchParams.get("q") === "北風" ? [{ circleId: "c-900001", name: "北風畫室", status }, { circleId: "c-900002", name: "北風別館", status: "none" }] : [] });
      }
      if (path.endsWith("/workspace")) return reply(detail(path.split("/")[4]));
      if (path.startsWith("/api/organizer/events/")) return reply(detail(path.split("/")[4]));
      throw new Error(`Unexpected ${req.method()} ${path}`);
    });
  } });
  await page.getByRole("heading", { name: "社團處置測試", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "活動資料", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "社團認領", exact: true }).count(), 1);
  assert.equal(await page.getByRole("combobox", { name: "活動版本", exact: true }).inputValue(), "social-latest");
  await page.getByLabel("活動審核與發布狀態").getByText("審核中", { exact: true }).waitFor();
  const sidebar = page.getByRole("complementary");
  assert.equal(await sidebar.getByRole("combobox", { name: "活動版本", exact: true }).count(), 1);
  await page.getByRole("button", { name: "社團認領", exact: true }).click();
  await page.getByRole("heading", { name: "社團認領", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "活動版本", exact: true }).selectOption("social-original");
  await page.getByLabel("活動審核與發布狀態").getByText("已發布", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "社團認領", exact: true }).waitFor();
  await page.getByRole("button", { name: "撤下補充資料", exact: true }).click();
  await page.getByRole("textbox", { name: "社團名稱", exact: true }).fill("不存在");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await page.getByText("找不到符合的社團。", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "社團名稱", exact: true }).fill("北風");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await page.getByRole("button", { name: "選擇北風畫室", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "選擇北風別館", exact: true }).isEnabled(), false);
  await page.getByRole("textbox", { name: "原因", exact: true }).fill("權利人要求");
  await page.getByRole("button", { name: "撤下", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(writes.length, 0, "cancel performs no takedown");
  await page.getByRole("button", { name: "撤下", exact: true }).click();
  await journey.capture(page, "organizer-social-takedown-confirm");
  await page.getByRole("dialog").getByRole("button", { name: "確認撤下", exact: true }).click();
  await page.getByText("已撤下。", { exact: true }).waitFor();
  assert.deepEqual(writes, [{ candidate: "social-original", circleId: "c-900001", reason: "權利人要求" }]);
  await journey.capture(page, "organizer-social-takedown-done");
  await page.getByRole("button", { name: "送審與發布", exact: true }).click();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  await journey.finish();
} catch (error) { await journey.abort(error); }
