// staged-data: fixture
import assert from "node:assert/strict";
import { start, base } from "./support/journey.mjs";

const journey = await start("organizer-cross-day-circles");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const now = Date.now();
const event = { id: "cross-day-import", tentativeName: "秋日創作交流會", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: "binder" };
const detail = { event, publicationAvailable: false, publication: null, revisions: [], import: null,
  venueCatalog: { venues: [{ id: "hall", name: "活動中心", spaces: [{ id: "east", name: "東一館" }] }] },
  draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: event.tentativeName,
    days: [{ id: "1", label: "第一天", date: "2026-11-07" }, { id: "2", label: "第二天", date: "2026-11-08" }] },
    venue: { assignments: [{ venueId: "hall", venueSpaceId: "east", areaIds: ["ALL"], areaMode: "none", mapTemplate: "SAMPLE" }] },
    officialSource: { label: "活動公告", url: "https://organizer.example/" } },
  workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "import" },
    readiness: { completed: 2, total: 6, suggestedNextSection: "import", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } },
};
let writes = 0;
try {
  const page = await journey.page({ url: `${base}/organizer`, viewport: { width: 1440, height: 1000 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), api = new URL(request.url()).pathname, method = request.method();
      const reply = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (api === "/api/auth/session") return reply({ email: "organizer@example.test", isAdmin: false, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (api === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (api === "/api/organizer/events") return reply({ events: [event] });
      if (api.endsWith("/workspace")) return reply({ ok: true });
      if (api.endsWith("/maps")) return reply({ maps: [] });
      if (api.endsWith("/cross-day-import") && method === "GET") return reply(detail);
      if (method === "PATCH" || method === "PUT") {
        const body = request.postDataJSON();
        assert.equal(body.expectedVersion, event.version);
        if (method === "PATCH") detail.draft = body.draft;
        else { detail.import = { source: body.source, rows: body.rows }; writes++; }
        event.version++;
        return reply({ ok: true, version: event.version });
      }
      throw new Error(`Unexpected API: ${method} ${api}`);
    });
  } });
  await page.getByRole("button", { name: "匯入檔案", exact: true }).click();
  const longName = "森林裡的繪本與故事工作室 Forest Stories 原創插畫、手作書與角色設定";
  const csv = `日期,攤位,社團,內部編號\n1,A01 A02,${longName},\n2,B07,${longName},\n1,C01,同名不同社團,one\n2,C01,同名不同社團,two\n1,D01,單日社團,\n`;
  await page.getByLabel("來源檔案", { exact: true }).setInputFiles({ name: "cross-day.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "下一步：欄位對照", exact: true }).click();
  const form = page.getByRole("group", { name: "匯入檔案與欄位對應", exact: true });
  await form.getByRole("group", { name: "活動日", exact: true }).getByLabel("來源欄位").selectOption("0");
  await form.getByLabel("攤位代碼", { exact: true }).selectOption("1");
  await form.getByLabel("社團名稱", { exact: true }).selectOption("2");
  await form.getByLabel("主辦內部編號（選填）", { exact: true }).selectOption("3");
  await form.getByLabel("攤位代碼格式").selectOption("delimited");
  await form.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  const summary = page.locator("summary").filter({ hasText: "跨日整合：1 個社團" });
  await summary.click();
  const grouped = summary.locator("..");
  assert.equal(await grouped.locator("tbody tr").count(), 1);
  await grouped.getByText(longName, { exact: true }).waitFor();
  await grouped.getByText("第一天 · 活動中心・東一館 · A01、A02", { exact: true }).waitFor();
  await grouped.getByText("第二天 · 活動中心・東一館 · B07", { exact: true }).waitFor();
  assert.equal(writes, 0, "preview does not save");
  for (const width of [1440, 1040]) {
    await page.setViewportSize({ width, height: 1000 });
    await grouped.scrollIntoViewIfNeeded();
    await journey.capture(page, `cross-day-import-${width}`);
  }
  await form.getByRole("button", { name: "匯入名單", exact: true }).click();
  const list = page.getByRole("region", { name: "攤位名單", exact: true });
  await list.waitFor();
  assert.equal(writes, 1);
  assert.equal(detail.import.rows.length, 5, "identity grouping keeps separate date rows");
  assert.deepEqual(detail.import.rows.slice(0, 2).map(row => row.codes), [["A01", "A02"], ["B07"]]);
  await list.locator("summary").filter({ hasText: "跨日整合：1 個社團" }).click();
  await journey.capture(page, "cross-day-saved-desktop");
  await list.getByLabel("顯示主辦內部編號", { exact: true }).check();
  const secondNamedCircle = list.locator('[data-roster-key="3"]');
  await secondNamedCircle.getByRole("button", { name: "編輯 C01 主辦內部編號", exact: true }).click();
  await secondNamedCircle.getByRole("textbox", { name: "C01 主辦內部編號", exact: true }).fill(" one ");
  await list.locator("summary").filter({ hasText: "跨日整合：2 個社團" }).waitFor();
  assert.equal(writes, 1, "edited grouping previews the normalized key before saving");
  await list.getByRole("button", { name: "儲存變更", exact: true }).click();
  await list.getByText("名單已儲存。", { exact: true }).waitFor();
  assert.equal(writes, 2);
  assert.equal(detail.import.rows[3].stableKey, "one");
  await list.locator("summary").filter({ hasText: "跨日整合：2 個社團" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("請改用桌機", { exact: true }).waitFor();
  journey.report.checks.push("import preview and saved roster share cross-day grouping; explicit conflicting keys stay separate; normalized edited keys preview before save; date/booth rows remain intact; supported desktop widths wrap long names; existing mobile gate remains");
  await journey.finish();
} catch (error) { await journey.abort(error); }
