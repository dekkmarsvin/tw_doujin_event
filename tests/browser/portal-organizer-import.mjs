// staged-data: portal
//
// The saved-list surface is read-only after an import.  This journey supplies
// its detail response with a deterministic 20,000-group synthetic response so
// pagination and filtering are exercised in the real Organizer UI without
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
    areaId: venueSpaceId === "space-a" ? "A" : "B",
    codes,
    circleName: `社團 ${String(index + 1).padStart(5, "0")}`,
    stableKey: `internal-${String(index + 1).padStart(5, "0")}`,
    identityGroup: null,
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
        { venueId: "venue-synthetic", venueSpaceId: "space-a", areaIds: ["A"], areaMode: "imported", mapTemplate: "TAIWAN_GENERIC_V1" },
        { venueId: "venue-synthetic", venueSpaceId: "space-b", areaIds: ["B"], areaMode: "imported", mapTemplate: "TAIWAN_GENERIC_V1" },
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
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
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
  await journey.capture(organizer, "organizer-import-filtered-second-code");

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
