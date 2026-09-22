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
        { id: "space-a", venueId: "venue-synthetic", name: "A 空間", sourceUrl: "https://example.test/venue/a", defaultAreaMode: "imported" },
        { id: "space-b", venueId: "venue-synthetic", name: "B 空間", sourceUrl: "https://example.test/venue/b", defaultAreaMode: "imported" },
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
        assert.equal(body.rows.length, GROUP_COUNT);
        assert.equal(body.source.sha256, "a".repeat(64), "manual editing retains original file provenance");
        detail.import = { source: body.source, rows: body.rows };
        event.version = ++detail.event.version;
        savedImports++;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, version: event.version, importedRows: body.rows.length }) });
      });
    },
  });

  await organizer.getByRole("button", { name: "登出", exact: true }).waitFor();
  const list = organizer.getByRole("region", { name: "已儲存的攤位清單" });
  await list.getByRole("heading", { name: "已儲存的攤位清單", exact: true }).waitFor();
  await list.getByText(/20000 列・20001 個攤位代碼。/).waitFor();
  const status = list.getByRole("status");
  const rowsOnPage = list.locator("tbody tr");

  await status.getByText("符合 20000 列・第 1 / 200 頁", { exact: true }).waitFor();
  assert.equal(await rowsOnPage.count(), 100, "the first page renders no more than 100 rows");
  assert.equal(await rowsOnPage.first().locator("td").nth(4).innerText(), "A00001", "the first page starts at the first natural code");
  assert.equal(await rowsOnPage.first().locator("td").nth(3).innerText(), "ALL", "a real imported area named ALL keeps its name");
  await journey.capture(organizer, "organizer-import-page-1");

  await list.getByRole("button", { name: "下一頁", exact: true }).click();
  await status.getByText("符合 20000 列・第 2 / 200 頁", { exact: true }).waitFor();
  assert.equal(await rowsOnPage.count(), 100, "the second page renders no more than 100 rows");
  assert.equal(await rowsOnPage.first().locator("td").nth(4).innerText(), "A00201", "the second page continues after the first 100 rows");
  await journey.capture(organizer, "organizer-import-page-2");

  // Walk the actual control to the last page. This proves the 200-page list is
  // usable end to end instead of only checking a computed page count.
  const nextPage = list.getByRole("button", { name: "下一頁", exact: true });
  for (let page = 3; page <= 200; page += 1) await nextPage.click();
  await status.getByText("符合 20000 列・第 200 / 200 頁", { exact: true }).waitFor();
  assert.equal(await rowsOnPage.count(), 100, "the last page renders no more than 100 rows");
  assert.equal(await rowsOnPage.first().locator("td").nth(4).innerText(), "B19803", "the last page starts at the expected natural code");
  assert.equal(await rowsOnPage.last().locator("td").nth(4).innerText(), "B20000", "the last page ends at the final natural code");
  assert.equal(await nextPage.isDisabled(), true, "the next-page control is disabled on the last page");
  await journey.capture(organizer, "organizer-import-page-200");

  const search = list.getByRole("searchbox", { name: "搜尋清單" });
  const dayFilter = list.getByRole("combobox", { name: "清單活動日" });
  const spaceFilter = list.getByRole("combobox", { name: "清單使用空間" });
  const sortFilter = list.getByRole("combobox", { name: "攤位排序" });
  await sortFilter.selectOption("desc");
  await status.getByText("符合 20000 列・第 1 / 200 頁", { exact: true }).waitFor();
  assert.equal(await rowsOnPage.first().locator("td").nth(4).innerText(), "B20000", "descending sort returns to page one at the highest code");
  await journey.capture(organizer, "organizer-import-sort-desc");
  await sortFilter.selectOption("asc");
  await status.getByText("符合 20000 列・第 1 / 200 頁", { exact: true }).waitFor();
  await dayFilter.selectOption({ label: "第一天" });
  await status.getByText("符合 10000 列・第 1 / 100 頁", { exact: true }).waitFor();
  await spaceFilter.selectOption({ label: "合成驗證場館・B 空間" });
  await status.getByText("符合 5000 列・第 1 / 50 頁", { exact: true }).waitFor();
  await search.fill("B01235-SECOND");
  await status.getByText("符合 1 列・第 1 / 1 頁", { exact: true }).waitFor();
  assert.equal(await rowsOnPage.count(), 1, "the second code identifies one saved group");
  const filteredRow = await rowsOnPage.first().innerText();
  assert.match(filteredRow, /第一天/);
  assert.match(filteredRow, /合成驗證場館・B 空間/);
  assert.match(filteredRow, /B01235、B01235-SECOND/);
  assert.equal(await rowsOnPage.first().locator("td").nth(3).innerText(), "無分區", "only an undivided space translates the internal ALL value");
  await journey.capture(organizer, "organizer-import-filtered-second-code");

  // An event with both divided and undivided spaces still shows the area
  // column; the undivided rows, including rejected ones, use its public label.
  await organizer.getByLabel(/^來源檔案/).setInputFiles({ name: "mixed-spaces.csv", mimeType: "text/csv", buffer: Buffer.from("攤位,社團\nB01,完整社團\nB02,\n") });
  const form = organizer.getByRole("group", { name: "匯入檔案與欄位對應", exact: true });
  await form.getByRole("group", { name: "活動日", exact: true }).getByLabel("固定值").selectOption("day-1");
  await form.getByRole("group", { name: "使用空間", exact: true }).getByLabel("固定值").selectOption("space-b");
  await form.getByLabel(/^攤位代碼(?!格式)/).selectOption("0");
  await form.getByLabel(/^社團名稱/).selectOption("1");
  await form.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  await form.getByText("1 列待修正", { exact: true }).waitFor();
  assert.equal(await form.getByRole("cell", { name: "無分區", exact: true }).count(), 2);
  assert.equal(await form.getByLabel("來源列 3 的展區", { exact: true }).count(), 0, "an undivided rejected row does not ask for a meaningless area");
  await journey.capture(organizer, "organizer-import-mixed-space-labels");

  // Work on the full 20,000-row draft while rendering just its current page.
  await list.getByRole("button", { name: "編輯清單", exact: true }).click();
  assert.equal(await list.getByRole("button", { name: "新增群組", exact: true }).isDisabled(), true);
  await dayFilter.selectOption("");
  await spaceFilter.selectOption("");
  await search.fill("A00001");
  await rowsOnPage.first().getByRole("button", { name: "編輯", exact: true }).click();
  const group = list.getByRole("group", { name: "編輯攤位群組", exact: true });
  await group.getByRole("button", { name: "刪除此群組", exact: true }).click();
  await search.fill("B01235");
  await rowsOnPage.first().getByRole("button", { name: "編輯", exact: true }).click();
  await group.getByRole("button", { name: "拆分群組", exact: true }).click();
  await group.getByRole("checkbox", { name: "B01235-SECOND", exact: true }).check();
  await group.getByRole("button", { name: "確認拆分", exact: true }).click();
  assert.equal(await rowsOnPage.count(), 2);
  await group.getByRole("textbox", { name: "群組社團名稱", exact: true }).fill("修正社");
  await group.getByRole("button", { name: "關閉群組編輯", exact: true }).click();
  await list.getByRole("checkbox", { name: "選取群組 B01235", exact: true }).check();
  await list.getByRole("checkbox", { name: "選取群組 B01235-SECOND", exact: true }).check();
  await list.getByRole("button", { name: "合併選取的 2 組", exact: true }).click();
  assert.equal(await list.getByRole("button", { name: "確認合併", exact: true }).isDisabled(), true, "different names require a choice");
  await list.getByRole("combobox", { name: "合併後保留的社團名稱" }).selectOption("修正社");
  await list.getByRole("button", { name: "確認合併", exact: true }).click();
  assert.equal(await rowsOnPage.count(), 1);
  await list.getByRole("button", { name: "新增群組", exact: true }).click();
  await group.getByRole("combobox", { name: "群組活動日", exact: true }).selectOption("day-2");
  await group.getByRole("combobox", { name: "群組使用空間", exact: true }).selectOption("space-b");
  await group.getByRole("textbox", { name: "群組社團名稱", exact: true }).fill("手動社");
  const codesInput = group.getByRole("textbox", { name: /^群組攤位代碼/ });
  await codesInput.fill("b00004");
  await group.getByRole("alert").filter({ hasText: /重複/ }).waitFor();
  const save = list.getByRole("button", { name: "儲存清單變更", exact: true });
  assert.equal(await save.isDisabled(), true);
  await codesInput.fill("A01A02");
  await group.getByRole("button", { name: "確認每 3 字拆成一碼", exact: true }).click();
  assert.equal(await codesInput.inputValue(), "A01、A02");
  await group.getByRole("button", { name: "關閉群組編輯", exact: true }).click();
  assert.equal(await organizer.getByLabel(/^來源檔案/).isDisabled(), true, "a file change cannot overwrite unsaved list editing");
  await search.fill("");
  await nextPage.click();
  assert.equal(await rowsOnPage.count(), 100);
  await search.fill("手動社");
  assert.match(await rowsOnPage.first().innerText(), /手動新增／合併/);
  assert.match(await rowsOnPage.first().innerText(), /無分區/);
  await journey.capture(organizer, "organizer-roster-manual-draft");
  assert.equal(savedImports, 0, "all five edits have stayed local");
  await save.click();
  await list.getByText("清單已儲存；公開活動尚未改變。", { exact: true }).waitFor();
  assert.equal(savedImports, 1);
  assert.equal(detail.import.rows.length, GROUP_COUNT);
  assert.equal(detail.import.rows.some(row => row.codes.includes("A00001")), false);
  const merged = detail.import.rows.find(row => row.codes.includes("B01235"));
  assert.deepEqual(merged.codes, ["B01235", "B01235-SECOND"]);
  assert.equal(merged.circleName, "修正社");
  assert.equal(merged.identityGroup, "stable:internal-01235");
  const manual = detail.import.rows.find(row => row.sourceRow === 0);
  assert.deepEqual(manual.codes, ["A01", "A02"]);
  assert.equal(manual.areaId, "ALL");
  assert.equal(manual.identityGroup, null);
  await organizer.reload();
  await list.getByRole("heading", { name: "已儲存的攤位清單", exact: true }).waitFor();
  await search.fill("手動社");
  assert.match(await rowsOnPage.first().innerText(), /A01、A02/);
  await list.getByRole("button", { name: "編輯清單", exact: true }).click();
  await rowsOnPage.first().getByRole("button", { name: "編輯", exact: true }).click();
  await group.getByRole("textbox", { name: "群組社團名稱", exact: true }).fill("衝突中的本機修改");
  rejectNextImport = true;
  await save.click();
  await list.getByRole("alert").filter({ hasText: /本次草稿仍保留/ }).waitFor();
  assert.equal(savedImports, 1);
  assert.equal(detail.import.rows.find(row => row.sourceRow === 0).circleName, "手動社");
  assert.equal(await group.getByRole("textbox", { name: "群組社團名稱", exact: true }).inputValue(), "衝突中的本機修改");
  assert.equal(await save.isDisabled(), true);
  await journey.capture(organizer, "organizer-roster-version-conflict");

  await list.getByRole("button", { name: "放棄變更並重新載入", exact: true }).click();
  await list.getByRole("button", { name: "編輯清單", exact: true }).waitFor();
  const assignment = detail.draft.venue.assignments.find(space => space.venueSpaceId === "space-a");
  assignment.areaMode = "none";
  assignment.areaIds = ["ALL"];
  event.version = ++detail.event.version;
  assert.equal(detail.import.rows.some(row => row.venueSpaceId === "space-a" && row.areaId !== "ALL"), true);
  await organizer.reload();
  await list.getByRole("button", { name: "編輯清單", exact: true }).click();
  await list.getByText("使用空間已改為無分區，儲存清單即可套用。", { exact: true }).waitFor();
  assert.equal(await save.isDisabled(), false, "a changed space mode can be applied without editing an unrelated field");
  await save.click();
  await list.getByText("清單已儲存；公開活動尚未改變。", { exact: true }).waitFor();
  assert.equal(savedImports, 2);
  assert.equal(detail.import.rows.every(row => row.areaId === "ALL"), true);
  assert.equal(await save.isDisabled(), true);
  await journey.capture(organizer, "organizer-roster-undivided-save");

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
