// staged-data: fixture
import assert from "node:assert/strict";
import path from "node:path";
import { start, base, output } from "./support/journey.mjs";
import { selectMatrix } from "./support/matrix.mjs";

const journey = await start("organizer-roster-recovery");
journey.report.matrix = [];
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const now = Date.now();
const event = { id: "roster-recovery", tentativeName: "秋日創作交流會", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: "binder" };
const detail = { event, publicationAvailable: false, publication: null, revisions: [],
  venueCatalog: { venues: [{ id: "hall", name: "活動中心", spaces: [{ id: "east", name: "東一館" }, { id: "west", name: "西一館" }] }] },
  draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: event.tentativeName, days: [{ id: "1", label: "第一天", date: "2026-11-07" }, { id: "2", label: "第二天", date: "2026-11-08" }] },
    venue: { assignments: ["east", "west"].map(venueSpaceId => ({ venueId: "hall", venueSpaceId, areaIds: ["A", "B"], areaMode: "imported", mapTemplate: "SAMPLE" })) },
    officialSource: { label: "活動公告", url: "https://organizer.example/" } },
  import: { source: { fileName: "roster.csv", worksheet: null, sha256: "a".repeat(64), sourceDescription: "合成來源", mapping: {} }, rows: [
    { dayId: "1", venueSpaceId: "east", codes: ["A01"], areaId: "A", circleName: "森林裡的繪本與故事工作室 Forest Stories — 原創插畫、手作書與角色設定" },
    { dayId: "2", venueSpaceId: "east", codes: ["B01"], areaId: "B", circleName: "晚安電波" },
    { dayId: "1", venueSpaceId: "west", codes: ["A01"], areaId: "A", circleName: "窗邊的貓" },
  ].map((row, index) => ({ ...row, sourceRow: index + 2, stableKey: null, identityGroup: null })) },
  workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "import" }, readiness: { completed: 3, total: 6, suggestedNextSection: "map", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } },
};
let failNextRead = false, failNextPut = false, failReadAfterWrite = false, patchCount = 0, putCount = 0;
try {
  const page = await journey.page({ url: `${base}/organizer`, viewport: { width: 1440, height: 1000 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), api = new URL(request.url()).pathname, method = request.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (api === "/api/auth/session") return reply({ email: "organizer@example.test", isAdmin: false, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (api === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (api === "/api/organizer/events") return reply({ events: [event] });
      if (api.endsWith("/workspace")) return reply({ ok: true });
      if (api.endsWith("/maps")) return reply({ maps: [] });
      if (api.endsWith("/roster-recovery") && method === "GET") {
        if (failNextRead) { failNextRead = false; return reply({ error: "測試重新讀取失敗" }, 503); }
        return reply(detail);
      }
      if (method === "PATCH" || method === "PUT") {
        const body = request.postDataJSON();
        assert.equal(body.expectedVersion, event.version, "every retry uses the version of its saved checkpoint");
        if (method === "PATCH") { patchCount++; detail.draft = body.draft; }
        else {
          putCount++;
          if (failNextPut) { failNextPut = false; return reply({ error: "測試儲存失敗" }, 503); }
          detail.import = { source: body.source, rows: body.rows };
        }
        event.version++;
        if (failReadAfterWrite) { failReadAfterWrite = false; failNextRead = true; }
        return reply({ ok: true, version: event.version, importedRows: detail.import.rows.length });
      }
      throw new Error(`Unexpected API: ${method} ${api}`);
    });
  } });
  const list = page.getByRole("region", { name: "攤位名單", exact: true });
  const row = list.locator('tr[data-roster-key="0"]');
  const aliases = list.getByRole("button", { name: "展區名稱", exact: true });
  const dialog = page.getByRole("dialog", { name: "展區名稱", exact: true });
  const aliasField = (space, code) => dialog.getByRole("textbox", { name: `活動中心・${space} ${code} 顯示名稱（選填）`, exact: true });
  const saveAliases = async () => { await dialog.getByRole("button", { name: "儲存展區名稱", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); };
  const edit = async (field, value) => {
    await row.getByRole("button", { name: new RegExp(`^編輯 .* ${field}$`) }).click();
    await row.getByRole("textbox").fill(value); await row.getByRole("textbox").press("Enter");
  };
  const retry = async () => {
    await list.getByRole("button", { name: "重新讀取名單", exact: true }).click();
    await list.getByRole("button", { name: "重新讀取名單", exact: true }).waitFor({ state: "hidden" });
  };
  await row.waitFor();
  // The next step stands beside the heading rather than inside the progress menu.
  await page.locator("summary").filter({ hasText: "準備進度 3/6" }).waitFor();
  await page.getByRole("button", { name: "下一步：地圖", exact: true }).waitFor();
  assert.equal(await list.getByText("· 已完成").count(), 0, "a list whose section is not complete is not marked finished");
  for (const width of selectMatrix([1040, 1280, 1440, 1920, 2560], [1040, 1440, 2560])) {
    await page.setViewportSize({ width, height: 1000 });
    await journey.capture(page, `roster-recovery-${width}`);
    // Only the workspace is retained for PR evidence; the account header is outside it.
    await list.screenshot({ path: path.join(output, `roster-workspace-${width}.png`) });
    journey.report.matrix.push({ width, height: 1000, scale: "standard" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await aliases.click();
  await aliasField("東一館", "A").fill("版攤活動");
  await aliasField("西一館", "A").fill("巴哈市集");
  failReadAfterWrite = true;
  await saveAliases();
  await list.getByText(/展區名稱已儲存，但重新讀取失敗/).waitFor();
  assert.equal(await aliases.isDisabled(), true);
  assert.equal(await row.getByRole("button", { name: /社團名稱$/ }).isDisabled(), true);
  assert.equal(patchCount, 1);
  await retry();
  await aliases.click();
  assert.equal(await aliasField("東一館", "A").inputValue(), "版攤活動");
  assert.equal(await aliasField("西一館", "A").inputValue(), "巴哈市集");
  await aliasField("東一館", "B").fill("遊戲試玩");
  await dialog.screenshot({ path: path.join(output, "roster-area-names.png") });
  await saveAliases();
  await list.getByText("展區名稱已儲存。", { exact: true }).waitFor();
  assert.equal(detail.draft.venue.assignments[0].areaLabels.A, "版攤活動");
  assert.equal(detail.draft.venue.assignments[1].areaLabels.A, "巴哈市集");
  await aliases.click();
  await aliasField("東一館", "A").fill("");
  failReadAfterWrite = true;
  await saveAliases();
  await list.getByText(/展區名稱已儲存，但重新讀取失敗/).waitFor();
  await retry();
  await aliases.click();
  assert.equal(await aliasField("東一館", "A").inputValue(), "");
  await aliasField("東一館", "B").fill("影音與試玩");
  await saveAliases();
  await list.getByText("展區名稱已儲存。", { exact: true }).waitFor();
  assert.equal(detail.draft.venue.assignments[0].areaLabels.A, undefined, "a cleared alias is not resurrected by the next edit");
  journey.report.checks.push("alias write/read failure, clear/retry, same code across spaces");

  // Composition Enter must not confirm an unfinished Chinese name.
  await row.getByRole("button", { name: /社團名稱$/ }).click();
  const input = row.getByRole("textbox");
  await input.dispatchEvent("compositionstart");
  await input.fill("組字中的社團名稱");
  await input.press("Enter");
  assert.equal(await input.count(), 1);
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  assert.equal(await input.count(), 0);
  await list.screenshot({ path: path.join(output, "roster-draft-workspace.png") });
  await edit("展區", "C");
  const checkpointPatches = patchCount;
  failNextPut = true;
  await list.getByRole("button", { name: "儲存變更", exact: true }).click();
  await list.getByText("測試儲存失敗", { exact: true }).waitFor();
  assert.equal(patchCount, checkpointPatches + 1, "area declaration was saved before the import failed");
  failReadAfterWrite = true;
  await list.getByRole("button", { name: "匯入檔案", exact: true }).click();
  await page.getByRole("dialog", { name: "尚有未儲存變更" }).getByRole("button", { name: "儲存並繼續" }).click();
  await list.getByText(/名單已儲存，但重新讀取失敗/).waitFor();
  assert.equal(patchCount, checkpointPatches + 1, "retry reuses the successful declaration");
  assert.equal(await page.getByRole("dialog").count(), 0, "retry is reachable after save-and-continue refresh fails");
  assert.equal(await list.getByRole("button", { name: "匯入檔案", exact: true }).isDisabled(), true);
  await retry();
  assert.equal(detail.import.rows[0].circleName, "組字中的社團名稱");
  assert.match(await row.innerText(), /組字中的社團名稱/);
  journey.report.checks.push("IME, partial save checkpoint, save-and-continue read failure");

  await list.getByRole("button", { name: "匯入檔案", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "replacement.csv", mimeType: "text/csv", buffer: Buffer.from("攤位代碼,社團名稱\nA99,新名單社團\n") });
  await page.getByRole("button", { name: "下一步：欄位對照", exact: true }).click();
  await page.getByLabel("攤位代碼", { exact: true }).selectOption("0");
  await page.getByLabel("社團名稱", { exact: true }).selectOption("1");
  await page.getByRole("group", { name: "活動日", exact: true }).getByLabel("固定值").selectOption("1");
  await page.getByRole("group", { name: "場地", exact: true }).getByLabel("固定值").selectOption("east");
  await page.getByRole("group", { name: "展區", exact: true }).getByLabel("固定值").fill("A");
  await page.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  await page.getByRole("cell", { name: "新名單社團", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "可匯入 1", exact: true }).getAttribute("aria-pressed"), "true");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "匯入攤位名單", exact: true }) }).last().screenshot({ path: path.join(output, "roster-import-confirm.png") });
  const previousPuts = putCount;
  // The declaration PATCH succeeds, then only the final detail GET fails.
  failNextRead = true;
  await page.getByRole("button", { name: "取代名單", exact: true }).click();
  await page.getByText(/名單已匯入，但重新讀取失敗/).waitFor();
  assert.equal(await page.getByRole("button", { name: "取代名單", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "重新讀取名單", exact: true }).click();
  await list.waitFor();
  assert.equal(putCount, previousPuts + 1, "refresh retry does not repeat the replacement");
  assert.equal(detail.import.rows.length, 1);
  assert.match(await list.innerText(), /新名單社團/);
  journey.report.checks.push("valid preview defaults to ready; committed import read retry never rewrites");
  await journey.finish();
} catch (error) { await journey.abort(error); }
