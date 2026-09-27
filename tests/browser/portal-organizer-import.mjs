// staged-data: portal
//
// The saved-list surface edits an existing import. This journey supplies
// a deterministic 20,000-group synthetic response so pagination, editing,
// version conflicts and filtering are exercised in the real Organizer UI without
// uploading a private workbook or writing a large fixture into D1.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ADMIN, clearMail, loginLink } from "./support/portal.mjs";
import { start } from "./support/journey.mjs";

const CANDIDATE_ID = "issue-213-synthetic";
const GROUP_COUNT = 20_000;
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function savedRow(index) {
  const dayId = index % 2 === 0 ? "day-1" : "day-2";
  const venueSpaceId = index % 4 < 2 ? "space-a" : "space-b";
  const prefix = venueSpaceId === "space-a" ? "A" : "B";
  const firstCode = `${prefix}${String(index + 1).padStart(5, "0")}`;
  const codes = index === 1_234 ? [firstCode, `${firstCode}-SECOND`] : [firstCode];
  return {
    sourceRow: index + 2,
    dayId,
    venueSpaceId,
    areaId: venueSpaceId === "space-b" || index === 0 ? "ALL" : "A",
    codes,
    circleName: `社團 ${String(index + 1).padStart(5, "0")}`,
    stableKey: `internal-${String(index + 1).padStart(5, "0")}`,
    identityGroup: `stable:internal-${String(index + 1).padStart(5, "0")}`,
  };
}

const rows = Array.from({ length: GROUP_COUNT }, (_, index) => savedRow(index));
const event = {
  id: CANDIDATE_ID,
  tentativeName: "#213 20,000 群組清單驗收",
  eventId: "issue-213-synthetic",
  status: "draft",
  version: 1,
  updatedAt: 1_758_000_000_000,
  updatedByRole: "admin",
  role: "admin",
  workspaceMode: "binder",
};
const detail = {
  publicationAvailable: false,
  event: { ...event, eventIdLocked: false },
  draft: {
    schema: "organizer-event-draft/1",
    event: {
      id: "issue-213-synthetic",
      name: "#213 20,000 群組清單驗收",
      days: [
        { id: "day-1", label: "第一天", date: "2026-10-09" },
        { id: "day-2", label: "第二天", date: "2026-10-10" },
      ],
    },
    venue: {
      assignments: [
        { venueId: "venue-synthetic", venueSpaceId: "space-a", areaIds: ["A", "ALL"], areaMode: "imported", mapTemplate: "TAIWAN_GENERIC_V1" },
        { venueId: "venue-synthetic", venueSpaceId: "space-b", areaIds: ["ALL"], areaMode: "none", mapTemplate: "TAIWAN_GENERIC_V1" },
      ],
    },
    officialSource: { label: "本地合成驗證資料", url: "https://example.test/issue-213" },
  },
  venueCatalog: {
    venues: [{
      id: "venue-synthetic",
      name: "合成驗證場館",
      sourceUrl: "https://example.test/venue",
      spaces: [
        { id: "space-a", venueId: "venue-synthetic", name: "A 場地", sourceUrl: "https://example.test/venue/a", defaultAreaMode: "imported" },
        { id: "space-b", venueId: "venue-synthetic", name: "B 場地", sourceUrl: "https://example.test/venue/b", defaultAreaMode: "imported" },
      ],
    }],
  },
  revisions: [],
  import: {
    source: {
      fileName: "synthetic-20000-groups.csv",
      worksheet: null,
      sha256: "a".repeat(64),
      sourceDescription: "synthetic-response UI evidence; no workbook upload",
      mapping: {
        day: { fixed: "day-1" },
        venueSpace: { fixed: "space-a" },
        area: { fixed: "A" },
        boothCode: { column: 0 },
        circleName: { column: 1 },
        boothCodeMode: "single",
      },
      createdByRole: "admin",
      createdAt: 1_758_000_000_000,
    },
    rows,
  },
  publication: null,
  workspace: {
    mode: "binder",
    onboardingCompletedAt: 1_758_000_000_000,
    resume: { guidedTask: "identity_source", section: "import" },
    readiness: {
      completed: 3,
      total: 6,
      suggestedNextSection: "import",
      blockers: [],
      sections: [
        { id: "event", state: "complete" },
        { id: "venue", state: "complete" },
        { id: "import", state: "complete" },
        { id: "map", state: "available" },
        { id: "validate", state: "blocked" },
        { id: "review", state: "blocked" },
      ],
    },
  },
};

const journey = await start("portal-organizer-import");
let savedImports = 0, rejectNextImport = false;
journey.report.sourceHead = sourceHead;
journey.report.fixture = {
  kind: "synthetic-response",
  groups: GROUP_COUNT,
  purpose: "saved-list pagination, second-code search, day and venue-space filters",
};

try {
  await clearMail();
  const link = await loginLink(ADMIN, "organizer");
  const organizer = await journey.page({
    url: link,
    viewport: { width: 1600, height: 1000 },
    routes: async (page) => {
      await page.route(`**/api/organizer/events/${CANDIDATE_ID}/maps?coverage=1`, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ maps: [] }) }));
      await page.route("**/api/organizer/events", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [event] }) });
      });
      await page.route(`**/api/organizer/events/${CANDIDATE_ID}`, async (route) => {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON();
          assert.equal(body.expectedVersion, detail.event.version);
          detail.draft = body.draft;
          event.version = ++detail.event.version;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, version: event.version }) });
        }
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
      });
      await page.route(`**/api/organizer/events/${CANDIDATE_ID}/imports`, async route => {
        assert.equal(route.request().method(), "PUT");
        const body = route.request().postDataJSON();
        assert.equal(body.expectedVersion, detail.event.version, "the loaded version accompanies the whole list");
        if (rejectNextImport) {
          rejectNextImport = false;
          event.version = ++detail.event.version;
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "草稿已被其他人更新，請重新載入。", conflict: { currentVersion: event.version } }) });
        }
        assert.ok(body.rows.length > 0);
        if (body.source.fileName === "synthetic-20000-groups.csv") assert.equal(body.source.sha256, "a".repeat(64), "manual edits retain provenance");
        detail.import = { source: body.source, rows: body.rows };
        event.version = ++detail.event.version;
        savedImports++;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, version: event.version, importedRows: body.rows.length }) });
      });
    },
  });

  await organizer.getByRole("button", { name: "登出", exact: true }).waitFor();
  const list = organizer.getByRole("region", { name: "攤位名單", exact: true });
  const rowsOnPage = list.locator("tbody tr");
  const search = list.getByRole("searchbox", { name: "搜尋", exact: true });
  const status = text => list.getByText(text, { exact: true }).waitFor();
  const edit = async (row, field, value, key = "Enter") => {
    await row.getByRole("button", { name: new RegExp(`^編輯 .* ${field}$`) }).click();
    const input = row.getByRole("textbox");
    await input.fill(value); await input.press(key);
  };
  const choice = async (row, field, value) => {
    await row.getByRole("button", { name: new RegExp(`^編輯 .* ${field}$`) }).click();
    await row.getByRole("combobox").selectOption(value); await row.getByRole("combobox").press("Enter");
  };
  const discard = async () => {
    await list.getByRole("button", { name: "放棄變更", exact: true }).click();
    await organizer.getByRole("dialog").getByRole("button", { name: "放棄變更", exact: true }).click();
    await organizer.getByRole("dialog").waitFor({ state: "hidden" });
  };
  const save = list.getByRole("button", { name: "儲存變更", exact: true });
  await status("符合 20,000 筆 · 第 1 / 200 頁");
  assert.equal(await rowsOnPage.count(), 100);
  assert.equal(await rowsOnPage.first().locator("td").nth(1).innerText(), "A00001");
  assert.equal(await rowsOnPage.first().locator("td").nth(5).innerText(), "ALL");
  assert.equal(await list.getByText("匯入出處").count(), 0);
  assert.equal(await list.getByRole("button", { name: "新增攤位", exact: true }).isDisabled(), true);
  for (const width of [1040, 1280, 1440, 1920, 2560]) {
    await organizer.setViewportSize({ width, height: 1000 });
    await journey.capture(organizer, `roster-desktop-${width}`);
    const box = await rowsOnPage.first().locator("td").nth(2).boundingBox();
    assert.ok(box.width >= 210, "circle name keeps useful width");
    const table = rowsOnPage.locator("..").locator("..").locator("..");
    assert.ok((await table.boundingBox()).height > 420, "the list uses the available height");
  }
  await organizer.setViewportSize({ width: 1600, height: 1000 });
  const next = list.getByRole("button", { name: "下一頁", exact: true });
  for (let page = 2; page <= 200; page++) await next.click();
  await status("符合 20,000 筆 · 第 200 / 200 頁");
  assert.equal(await rowsOnPage.last().locator("td").nth(1).innerText(), "B20000");
  assert.equal(await next.isDisabled(), true);
  const sort = list.getByLabel("攤位排序", { exact: true });
  await sort.selectOption("desc");
  assert.equal(await rowsOnPage.first().locator("td").nth(1).innerText(), "B20000");
  await sort.selectOption("asc");
  await list.getByLabel("活動日", { exact: true }).selectOption("day-1");
  await list.getByLabel("場地", { exact: true }).selectOption("space-b");
  await search.fill("B01235-SECOND");
  await status("符合 1 筆 · 第 1 / 1 頁");
  assert.match(await rowsOnPage.first().innerText(), /B01235、B01235-SECOND/);
  assert.equal(await rowsOnPage.first().locator("td").nth(5).innerText(), "無分區");
  await list.getByRole("button", { name: "清除篩選", exact: true }).click();

  // Cell editing preserves the view, Escape restores just that edit, and Tab advances.
  const first = list.locator('tr[data-roster-key="0"]');
  await edit(first, "攤位代碼", "Z99999");
  assert.equal(await rowsOnPage.first().getAttribute("data-roster-key"), "0");
  await edit(first, "社團名稱", "放棄的名稱", "Escape");
  assert.match(await first.innerText(), /社團 00001/);
  await first.getByRole("button", { name: "編輯 Z99999 社團名稱", exact: true }).click();
  await first.getByRole("textbox").fill("長名稱連續修改測試社團 Long multilingual circle name 測試自動換行與欄位寬度");
  await first.getByRole("textbox").press("Tab");
  assert.equal(await first.getByRole("combobox").evaluate(el => el === document.activeElement), true);
  await first.getByRole("combobox").press("Escape");
  await journey.capture(organizer, "roster-inline-draft");
  await next.click();
  await search.fill("Z99999");
  assert.equal(await rowsOnPage.count(), 1, "cross-page draft remains searchable");
  await list.getByRole("button", { name: "匯入檔案", exact: true }).click();
  await organizer.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(savedImports, 0);
  await discard();
  await search.fill("A00001");
  await rowsOnPage.first().getByRole("button", { name: "刪除", exact: true }).click();
  await organizer.getByRole("dialog").getByRole("button", { name: "確認刪除", exact: true }).click();
  await search.fill("B01235");
  await rowsOnPage.first().getByRole("button", { name: "拆分", exact: true }).click();
  await organizer.getByRole("dialog").getByRole("checkbox", { name: "B01235-SECOND", exact: true }).check();
  await organizer.getByRole("dialog").getByRole("button", { name: "確認拆分", exact: true }).click();
  assert.equal(await rowsOnPage.count(), 2);
  await edit(rowsOnPage.first(), "社團名稱", "修正社");
  await list.getByRole("checkbox", { name: "選取 B01235", exact: true }).check();
  await list.getByRole("checkbox", { name: "選取 B01235-SECOND", exact: true }).check();
  await list.getByRole("button", { name: "合併選取", exact: true }).click();
  assert.equal(await organizer.getByRole("dialog").getByRole("button", { name: "確認合併", exact: true }).isDisabled(), true);
  await organizer.getByRole("dialog").getByLabel("合併後保留的社團名稱").selectOption("修正社");
  await organizer.getByRole("dialog").getByRole("button", { name: "確認合併", exact: true }).click();
  await list.getByRole("button", { name: "新增攤位", exact: true }).click();
  const added = list.locator('tr[data-roster-key="20001"]');
  await added.getByRole("textbox").fill("A01 A02"); await added.getByRole("textbox").press("Enter");
  await edit(added, "社團名稱", "手動社");
  await choice(added, "活動日", "day-2"); await choice(added, "場地", "space-b");
  await save.click(); await status("名單已儲存。");
  assert.equal(savedImports, 1); assert.equal(detail.import.rows.length, GROUP_COUNT);
  assert.equal(detail.import.rows.some(row => row.codes.includes("A00001")), false);
  assert.equal(detail.import.rows.find(row => row.codes.includes("B01235")).identityGroup, "stable:internal-01235");
  assert.deepEqual(detail.import.rows.find(row => row.circleName === "手動社").codes, ["A01", "A02"]);
  await search.fill("手動社");
  await edit(rowsOnPage.first(), "社團名稱", "衝突中的本機修改"); rejectNextImport = true;
  await save.click(); await list.getByRole("alert").filter({ hasText: "本次修改仍保留" }).waitFor();
  assert.equal(await save.isDisabled(), true); assert.match(await rowsOnPage.first().innerText(), /衝突中的本機修改/);
  await journey.capture(organizer, "roster-conflict"); await discard();
  await search.fill("");
  await list.getByRole("button", { name: "展區名稱", exact: true }).click();
  const alias = organizer.getByRole("dialog").getByLabel("合成驗證場館・A 場地 A 顯示名稱（選填）", { exact: true });
  await alias.fill("版攤活動");
  await organizer.getByRole("dialog").getByRole("button", { name: "儲存展區名稱", exact: true }).click();
  await status("展區名稱已儲存。"); assert.equal(detail.draft.venue.assignments[0].areaLabels.A, "版攤活動");
  await list.getByLabel("展區", { exact: true }).selectOption(JSON.stringify(["space-a", "A"]));
  assert.ok(await list.getByRole("button", { name: /展區$/ }).first().innerText().then(text => text.includes("版攤活動")));
  await list.getByLabel("地圖狀態", { exact: true }).selectOption("已畫"); assert.equal(await rowsOnPage.count(), 0);
  await list.getByRole("button", { name: "清除篩選", exact: true }).click();

  // More than a page of rejected rows must be individually reachable and recoverable.
  await list.getByRole("button", { name: "匯入檔案", exact: true }).click();
  const csv = "攤位,社團\n" + Array.from({ length: 105 }, (_, index) => `C${String(index + 1).padStart(3, "0")},`).join("\n");
  await organizer.getByLabel("來源檔案", { exact: true }).setInputFiles({ name: "corrections.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await organizer.getByRole("button", { name: "下一步：欄位對照", exact: true }).click();
  const form = organizer.getByRole("group", { name: "匯入檔案與欄位對應", exact: true });
  await form.getByRole("group", { name: "活動日", exact: true }).getByLabel("固定值").selectOption("day-1");
  await form.getByRole("group", { name: "場地", exact: true }).getByLabel("固定值").selectOption("space-a");
  await form.getByRole("group", { name: "展區", exact: true }).getByLabel("固定值").fill("A");
  await form.getByLabel("攤位代碼", { exact: true }).selectOption("0");
  await form.getByLabel("社團名稱", { exact: true }).selectOption("1");
  await form.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  await form.getByRole("button", { name: "待修正 105", exact: true }).click();
  await form.getByRole("button", { name: "下一頁", exact: true }).click();
  await form.getByLabel("來源列 106 的社團名稱", { exact: true }).fill("第 105 筆修正");
  await form.getByLabel("來源列 106 的社團名稱", { exact: true }).press("Tab");
  await form.getByRole("button", { name: "上一步", exact: true }).click();
  await form.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  await form.getByRole("button", { name: "可匯入 1", exact: true }).click();
  await form.getByRole("cell", { name: "第 105 筆修正", exact: true }).waitFor();
  await form.getByRole("button", { name: "待修正 104", exact: true }).click();
  await form.getByRole("button", { name: "排除全部待修正資料", exact: true }).click();
  await form.getByRole("button", { name: "已排除 104", exact: true }).click();
  await form.getByRole("button", { name: "下一頁", exact: true }).click();
  await form.getByRole("button", { name: "恢復", exact: true }).last().click();
  await form.getByRole("button", { name: "待修正 1", exact: true }).click();
  await form.getByLabel("來源列 105 的社團名稱", { exact: true }).fill("已恢復修正");
  await form.getByLabel("來源列 105 的社團名稱", { exact: true }).press("Tab");
  await form.getByText(/將以 2 筆取代目前的 20000 筆名單/).waitFor();
  await journey.capture(organizer, "import-paginated-corrections");
  await form.getByRole("button", { name: "取代名單", exact: true }).click();
  await list.waitFor(); assert.equal(detail.import.rows.length, 2);
  assert.equal(detail.draft.venue.assignments[0].areaLabels.A, "版攤活動", "reimport preserves the alias");
  await list.getByRole("button", { name: "展區名稱", exact: true }).click();
  await alias.fill(""); await organizer.getByRole("dialog").getByRole("button", { name: "儲存展區名稱", exact: true }).click();
  await status("展區名稱已儲存。"); assert.equal(detail.draft.venue.assignments[0].areaLabels.A, undefined);
  await organizer.reload(); await list.waitFor();
  assert.equal(await rowsOnPage.count(), 2);
  await journey.capture(organizer, "roster-after-reimport");
  await journey.finish();
} catch (error) { await journey.abort(error); }
