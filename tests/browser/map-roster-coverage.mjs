// staged-data: fixture
import assert from "node:assert/strict";
import { start, base } from "./support/journey.mjs";
import { source } from "./support/map-authoring.mjs";

const journey = await start("map-roster-coverage");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const now = Date.now();
const makeLayout = codes => ({ ...source, width: 800, height: 600,
  floor: { x: 0, y: 0, width: 800, height: 600 }, pillars: [], landmarks: [], accessPoints: [],
  rows: [{ label: "A", orientation: "vertical", confidence: 1, slots: codes.map((code, index) => ({ code, rect: { x: 200, y: 100 + index * 50, width: 80, height: 50 } })) }],
});
const roster = [
  { dayId: "1", venueSpaceId: "hall-a", codes: ["A01", "A02"], circleName: "首日甲社" },
  { dayId: "1", venueSpaceId: "hall-a", codes: ["A03"], circleName: "尚未畫社" },
  { dayId: "2", venueSpaceId: "hall-a", codes: ["A01"], circleName: "次日乙社" },
  { dayId: "1", venueSpaceId: "hall-b", codes: ["A01"], circleName: "隔壁丙社" },
].map((row, index) => ({ ...row, sourceRow: index + 2, areaId: "A", stableKey: null, identityGroup: null }));

async function open(surface) {
  const maps = [
    { id: "one-a", periodKey: "1", venueSpaceId: "hall-a", layout: makeLayout(["A01", "EXTRA"]) },
    { id: "two-a", periodKey: "2", venueSpaceId: "hall-a", layout: makeLayout([]) },
    { id: "one-b", periodKey: "1", venueSpaceId: "hall-b", layout: makeLayout(["A01"]) },
  ].map(map => ({ ...map, status: "draft", mapRevision: 1, updatedAt: now, authoring: { guides: [] } }));
  const summary = { id: "coverage", tentativeName: "清單地圖對照", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: "binder" };
  const detail = { event: summary, publicationAvailable: false, publication: null, revisions: [],
    venueCatalog: { venues: [{ id: "hall", name: "測試場館", spaces: [{ id: "hall-a", name: "甲空間" }, { id: "hall-b", name: "乙空間" }] }] },
    draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: "清單地圖對照", days: [{ id: "1", label: "第一天", date: "2026-11-07" }, { id: "2", label: "第二天", date: "2026-11-08" }] },
      venue: { assignments: ["hall-a", "hall-b"].map(venueSpaceId => ({ venueId: "hall", venueSpaceId, areaIds: ["A"], areaMode: "imported", mapTemplate: "SAMPLE" })) },
      officialSource: { label: "測試來源", url: "https://organizer.example/" } },
    import: { source: { fileName: "roster.csv", worksheet: null, sha256: "a".repeat(64), sourceDescription: "合成來源", mapping: {} }, rows: roster },
    workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "import" }, readiness: { completed: 3, total: 6, suggestedNextSection: "map", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } },
  };
  const draftOf = map => ({ id: map.id, event_id: "sample", period_key: map.periodKey, venue_space_id: map.venueSpaceId, status: "draft", current_revision: map.mapRevision, updated_at: now, content: { schema: "map-contribution-draft/1", layout: map.layout, authoring: map.authoring } });
  const scopeOf = map => {
    const groups = roster.filter(row => row.dayId === map.periodKey && row.venueSpaceId === map.venueSpaceId).map(row => ({ codes: row.codes, circleName: row.circleName }));
    return { periodKey: map.periodKey, venueSpaceId: map.venueSpaceId, groups, requiredBoothCodes: groups.flatMap(group => group.codes), allowedBoothCodes: groups.flatMap(group => group.codes), allowsUnallocatedBooths: false };
  };
  const page = await journey.page({ url: `${base}/${surface}`, viewport: { width: 1600, height: 1100 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/session") return reply({ email: "map@example.test", isAdmin: false, isMapContributor: true, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (path === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (path.endsWith("/claims")) return reply({ claims: [], eventId: "sample" });
      if (path === "/api/organizer/events") return reply({ events: [summary] });
      if (path.endsWith("/workspace")) {
        const body = request.postDataJSON();
        detail.workspace.resume = { guidedTask: body.guidedTask, section: body.lastSection };
        return reply({ ok: true });
      }
      if (path.endsWith("/events/coverage")) return reply(detail);
      if (path.endsWith("/background")) return reply({ error: "missing" }, 404);
      if (path.endsWith("/maps")) return reply({ maps: maps.map(map => ({ ...map, boothCodes: map.layout.rows.flatMap(row => row.slots.map(slot => slot.code)) })) });
      const map = maps.find(map => path.endsWith(`/${map.id}`));
      if (map && path.includes("/maps/")) {
        if (method === "PATCH") { map.layout = request.postDataJSON().layout; map.mapRevision++; summary.version++; return reply({ ok: true, version: summary.version, mapRevision: map.mapRevision }); }
        return reply({ map });
      }
      if (path === "/api/map-contributions/drafts") return reply({ drafts: maps.map(draftOf) });
      if (map && path.includes("/drafts/")) {
        if (method === "PUT") { map.layout = request.postDataJSON().content.layout; map.mapRevision++; return reply({ ok: true, revision: map.mapRevision }); }
        return reply({ draft: draftOf(map), scope: scopeOf(map), files: [], reviews: [], comments: [] });
      }
      throw new Error(`Unexpected API: ${method} ${path}`);
    });
  } });
  return { page, maps };
}

try {
  for (const surface of ["organizer", "circle"]) {
    const { page, maps } = await open(surface);
    if (surface === "organizer") {
      const saved = page.getByRole("region", { name: "已儲存的攤位清單" });
      await saved.getByText("部分已畫 1/2", { exact: true }).waitFor();
      assert.equal(await saved.getByText("待畫 0/1", { exact: true }).count(), 2, "other day does not borrow A01 from this map");
      assert.equal(await saved.getByText("已畫 1/1", { exact: true }).count(), 1);
      await journey.capture(page, "organizer-saved-roster-coverage");
      await saved.locator("tbody tr").filter({ hasText: "首日甲社" }).getByRole("button", { name: "定位 A01", exact: true }).click();
    } else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).nth(0).click();
    const editor = page.getByRole("region", { name: "活動地圖編輯器" });
    const comparison = editor.getByRole("region", { name: "攤位清單對照" });
    const picker = editor.getByRole("combobox", { name: "選取地圖元素", exact: true });
    await comparison.getByText("清單 3 碼・已畫 1 碼・待畫 2 碼", { exact: true }).waitFor();
    assert.match(await comparison.innerText(), surface === "organizer" ? /提醒：1 個/ : /錯誤：1 個/);
    assert.equal(await comparison.getByRole("button", { name: "定位攤位 A02", exact: true }).count(), 0);
    if (surface === "organizer") await comparison.getByText("選取 A01：首日甲社", { exact: true }).waitFor();
    await comparison.getByRole("combobox", { name: "對照顯示" }).selectOption("all");
    await comparison.getByRole("button", { name: "定位攤位 A01", exact: true }).click();
    assert.equal(await picker.inputValue(), "slot:0:0");
    await comparison.getByText("選取 A01：首日甲社", { exact: true }).waitFor();
    await editor.evaluate(element => element.scrollIntoView({ block: "start" }));
    await journey.capture(page, `${surface}-map-roster-locate`);

    // Drawn counts follow actual edits, deletion and undo; the saved map does not.
    await picker.selectOption("slot:0:1");
    await editor.getByRole("textbox", { name: "攤位代碼", exact: true }).fill("A02");
    await editor.getByRole("textbox", { name: "攤位代碼", exact: true }).press("Tab");
    await comparison.getByText("清單 3 碼・已畫 2 碼・待畫 1 碼", { exact: true }).waitFor();
    assert.equal(maps[0].layout.rows[0].slots[1].code, "EXTRA");
    await editor.getByRole("button", { name: "移除此元素", exact: true }).click();
    await comparison.getByText("清單 3 碼・已畫 1 碼・待畫 2 碼", { exact: true }).waitFor();
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    await comparison.getByText("清單 3 碼・已畫 2 碼・待畫 1 碼", { exact: true }).waitFor();
    await editor.getByRole("button", { name: "手動畫攤位", exact: true }).click();
    await editor.getByRole("textbox", { name: "攤位代碼", exact: true }).fill("A03");
    const svg = editor.locator("svg[tabindex='0']");
    await svg.scrollIntoViewIfNeeded();
    const points = await svg.evaluate(element => {
      const matrix = element.getScreenCTM();
      return [[400, 200], [480, 250]].map(([x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
    });
    await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 4 }); await page.mouse.up();
    await comparison.getByText("清單 3 碼・已畫 3 碼・待畫 0 碼", { exact: true }).waitFor();
    await svg.press("Escape");
    await editor.getByRole("button", { name: "復原上一步編輯", exact: true }).click();
    await comparison.getByText("清單 3 碼・已畫 2 碼・待畫 1 碼", { exact: true }).waitFor();
    await page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true }).click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(maps[0].layout.rows[0].slots[1].code, "A02");

    if (surface === "organizer") {
      await page.getByRole("group", { name: "活動項目" }).getByRole("button").filter({ hasText: "攤位匯入" }).click();
      const saved = page.getByRole("region", { name: "已儲存的攤位清單" });
      await saved.getByText("已畫 2/2", { exact: true }).waitFor();
      await saved.locator("tbody tr").filter({ hasText: "首日甲社" }).getByRole("button", { name: "定位 A02", exact: true }).click();
      await comparison.getByText("選取 A02：首日甲社", { exact: true }).waitFor();
      await page.getByRole("button", { name: "第二天・測試場館・甲空間", exact: true }).click();
    } else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).nth(1).click();
    await comparison.getByText("清單 1 碼・已畫 0 碼・待畫 1 碼", { exact: true }).waitFor();
    await comparison.getByText("次日乙社", { exact: true }).waitFor();
    assert.doesNotMatch(await comparison.innerText(), /首日甲社/);
    if (surface === "organizer") await page.getByRole("button", { name: "第一天・測試場館・乙空間", exact: true }).click();
    else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).nth(2).click();
    await comparison.getByText("清單 1 碼・已畫 1 碼・待畫 0 碼", { exact: true }).waitFor();
    await comparison.getByRole("combobox", { name: "對照顯示" }).selectOption("all");
    await comparison.getByRole("button", { name: "定位攤位 A01", exact: true }).click();
    await comparison.getByText("選取 A01：隔壁丙社", { exact: true }).waitFor();
    await editor.evaluate(element => element.scrollIntoView({ block: "start" }));
    await journey.capture(page, `${surface}-map-roster-other-scope`);
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
