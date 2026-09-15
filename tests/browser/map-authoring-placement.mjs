// staged-data: fixture
// Real shared editor through both control surfaces; synthetic API persistence.
// Authorization/version enforcement remains covered by handler and D1 tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { base, start } from "./support/journey.mjs";

const source = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout;
const journey = await start("map-authoring-placement");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const now = Date.now();
const summary = { id: "placement", tentativeName: "畫布放置驗收", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: "binder" };
const assignment = { venueId: "test-hall", venueSpaceId: "test-space", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported" };
const detail = { event: summary, publicationAvailable: false, publication: null, revisions: [], venueCatalog: { venues: [] },
  draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: "畫布放置驗收", days: [{ id: "1", label: "第一天", date: "2026-11-07" }] }, venue: { assignments: [assignment] }, officialSource: { label: "測試來源", url: "https://organizer.example/" } },
  import: { source: {}, rows: [{ dayId: "1", venueSpaceId: "test-space", codes: ["S01"], circleName: "測試社" }] },
  workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "map" }, readiness: { completed: 3, total: 6, suggestedNextSection: "map", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } } };

async function openSurface(surface) {
  const state = { layout: structuredClone(source), saves: 0 };
  const page = await journey.page({ url: `${base}/${surface}`, viewport: { width: 1600, height: 1100 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/session") return reply({ email: "map@example.test", isAdmin: false, isMapContributor: true, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (path === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (path.endsWith("/claims")) return reply({ claims: [], eventId: "sample" });
      if (path === "/api/organizer/events") return reply({ events: [summary] });
      if (path.endsWith("/workspace")) return reply({ ok: true });
      if (path.endsWith("/events/placement")) return reply(detail);
      const map = { id: "test-map", periodKey: "1", venueSpaceId: "test-space", mapRevision: 1, layout: state.layout };
      if (path.endsWith("/maps")) return reply({ maps: [map] });
      if (path.endsWith("/background")) return reply({ error: "missing" }, 404);
      if (path.endsWith("/maps/test-map")) {
        if (method === "PATCH") { state.layout = request.postDataJSON().layout; state.saves++; return reply({ ok: true, version: 1, mapRevision: 1 }); }
        return reply({ map });
      }
      const draft = { id: "test-map", event_id: "sample", period_key: "1", venue_space_id: "test-space", status: "draft", current_revision: 1, updated_at: now, content: { schema: "map-contribution-draft/1", layout: state.layout } };
      if (path === "/api/map-contributions/drafts") return reply({ drafts: [draft] });
      if (path === "/api/map-contributions/drafts/test-map") {
        if (method === "PUT") { state.layout = request.postDataJSON().content.layout; state.saves++; return reply({ ok: true, revision: 1 }); }
        return reply({ draft, files: [], reviews: [], comments: [] });
      }
      throw new Error(`Unexpected API: ${method} ${path}`);
    });
  } });
  if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
  else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
  const editor = page.getByRole("region", { name: "活動地圖編輯器" });
  await editor.waitFor();
  return { page, editor, state };
}

try {
  for (const surface of ["organizer", "circle"]) {
    const { page, editor, state } = await openSurface(surface);
    const svg = editor.locator("svg[tabindex='0']");
    const picker = editor.getByRole("combobox", { name: "選取地圖元素" });
    const count = () => picker.locator("option").count();
    const before = await count();
    const activate = label => editor.getByRole("button", { name: `新增${label}`, exact: true }).click();
    const at = async (x, y) => { await svg.scrollIntoViewIfNeeded(); const b = await svg.boundingBox(); return { x: b.x + x * b.width, y: b.y + y * b.height }; };
    const click = async (x, y) => { const p = await at(x, y); await page.mouse.click(p.x, p.y); };
    const drag = async (from, to, cancel = false) => {
      const startingCount = await count();
      const a = await at(...from), b = await at(...to);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
      assert.equal(await count(), startingCount, "preview does not create a persistent element");
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
    };
    await activate("柱子");
    assert.equal(await count(), before);
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true);
    await drag([.25, .2], [.3, .3], true);
    assert.equal(await count(), before, "Escape during drag cancels creation");
    await activate("舞台"); await activate("出口");
    assert.equal(await count(), before, "switching tools creates nothing");
    const cancelledPoint = await at(.4, .4);
    await page.mouse.move(cancelledPoint.x, cancelledPoint.y); await page.mouse.down();
    await svg.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await count(), before, "pointercancel creates nothing");
    await editor.getByRole("button", { name: "取消放置", exact: true }).click();
    await activate("柱子");
    await drag([.25, .2], [.3, .3]);
    assert.equal(await count(), before + 1);
    assert.match(await picker.inputValue(), /^pillar:/);
    assert.equal(await editor.getByRole("button", { name: "新增柱子", exact: true }).getAttribute("aria-pressed"), "false");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    assert.equal(await count(), before, "one undo removes the entire placement");
    assert.equal(await editor.getByRole("button", { name: "復原上一步編輯" }).isDisabled(), true);
    await editor.getByRole("button", { name: "重做已復原的編輯" }).click();
    await activate("企業攤"); await click(.65, .25);
    await activate("入口"); await click(.75, .8);
    assert.match(await picker.inputValue(), /^access:/);
    await journey.capture(page, `${surface}-canvas-facility-placement`);
    await page.getByRole("button", { name: surface === "organizer" ? "儲存地圖變更" : "儲存新版本", exact: true }).click();
    await page.getByText(surface === "organizer" ? "地圖已儲存，尚未公開。" : "草稿已儲存。", { exact: true }).waitFor();
    assert.equal(state.saves, 1);
    const rect = state.layout.pillars.at(-1), region = state.layout.landmarks.at(-1).rect, point = state.layout.accessPoints.at(-1);
    const near = (value, expected) => assert.ok(Math.abs(value - expected) < .001, `${value} != ${expected}`);
    near(rect.x, source.width * .25); near(rect.y, source.height * .2);
    near(rect.width, source.width * .05); near(rect.height, source.height * .1);
    near(region.x + region.width / 2, source.width * .65); near(region.y + region.height / 2, source.height * .25);
    near(point.x, source.width * .75); near(point.y, source.height * .8); assert.equal(point.direction, "north");
    assert.deepEqual(state.layout.rows, source.rows, "facility placement preserves all booths");
    // Returning from a facility tool to the existing continuous row/slot tools
    // must still place on release, preserve numbering, and cancel cleanly.
    await activate("舞台"); await activate("排／排段");
    await editor.getByRole("textbox", { name: "排標籤", exact: true }).fill("T");
    await editor.getByRole("textbox", { name: "結束編號", exact: true }).fill("2");
    const beforeRow = await count();
    await drag([.05, .03], [.1, .28]);
    assert.equal(await count(), beforeRow + 2);
    assert.equal(await editor.getByRole("textbox", { name: "起始編號", exact: true }).inputValue(), "3");
    await journey.capture(page, `${surface}-continuous-row-after-tool-switch`);
    await svg.press("Escape");
    await editor.getByRole("button", { name: "復原上一步編輯" }).click();
    assert.equal(await count(), beforeRow, "one undo removes the row segment");
    await editor.getByRole("button", { name: "手動畫攤位", exact: true }).click();
    await editor.getByRole("combobox", { name: "所屬排標籤", exact: true }).fill("T");
    await drag([.05, .03], [.1, .15], true);
    assert.equal(await count(), beforeRow, "manual slot cancellation leaves no element");
    for (const label of ["舞台", "其他區域", "出口"]) {
      await activate(label); await click(.45, .55);
      assert.equal(await count(), beforeRow + 1);
      await editor.getByRole("button", { name: "復原上一步編輯" }).click();
      assert.equal(await count(), beforeRow);
    }
    await page.close();
  }
  await journey.finish();
} catch (error) { await journey.abort(error); }
