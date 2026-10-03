// staged-data: fixture
import assert from "node:assert/strict";
import path from "node:path";
import { start, base, output, PIXEL } from "./support/journey.mjs";
import { source, openToolGroup } from "./support/map-authoring.mjs";
import { encodePng, ruledPlan } from "../support/map-recognition-fixture.mjs";

const journey = await start("organizer-map-navigation");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
const now = Date.now();

async function openWorkspace({ guided = false, fresh = false } = {}) {
  const event = { id: "navigation", tentativeName: "地圖導覽驗收", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: guided ? "guided" : "binder" };
  const other = { ...event, id: "other", tentativeName: "另一場活動" };
  const detail = { event, publicationAvailable: false, publication: null, revisions: [], venueCatalog: { venues: [] },
    draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: event.tentativeName, days: [{ id: "1", label: "第一天", date: "2026-11-07" }, { id: "2", label: "第二天", date: "2026-11-08" }] },
      venue: { assignments: [{ venueId: "test-hall", venueSpaceId: "test-space", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported" }] }, officialSource: { label: "測試來源", url: "https://organizer.example/" } },
    import: { source: { fileName: "roster.csv", worksheet: null, sha256: "a".repeat(64), sourceDescription: "合成來源", mapping: {} }, rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: "test-space", areaId: "A", codes: ["S01"], circleName: "測試社", stableKey: null, identityGroup: null }] },
    workspace: { mode: event.workspaceMode, onboardingCompletedAt: guided ? null : now, resume: { guidedTask: "identity_source", section: "map" }, readiness: { completed: 3, total: 6, suggestedNextSection: "validate", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } },
  };
  const state = { map: fresh ? null : { id: "test-map", periodKey: "1", venueSpaceId: "test-space", mapRevision: 1, layout: structuredClone(source), authoring: { guides: [] } }, attempts: 0, creates: 0, saves: 0, failSave: false, failBackground: false, uploads: [] };
  const page = await journey.page({ url: `${base}/organizer`, viewport: { width: 1600, height: 1100 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), api = new URL(request.url()).pathname, method = request.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (api === "/api/auth/session") return reply({ email: "map@example.test", isAdmin: false, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (api === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (api === "/api/organizer/events") return reply({ events: [event, other] });
      if (api.endsWith("/workspace")) return reply({ ok: true });
      if (api.endsWith("/events/navigation")) return reply(detail);
      if (api.endsWith("/events/other")) return reply({ ...detail, event: other, draft: { ...detail.draft, event: { ...detail.draft.event, name: other.tentativeName } } });
      if (api.endsWith("/maps") && method === "GET") return reply({ maps: state.map ? [state.map] : [] });
      if (api.endsWith("/background")) {
        if (method === "PUT") {
          state.uploads.push(request.postDataBuffer().toString().match(/filename="([^"]+)"/)[1]);
          if (state.failBackground) { state.failBackground = false; return reply({ error: "配置圖儲存失敗" }, 503); }
          return reply({ ok: true });
        }
        return reply({ error: "missing" }, 404);
      }
      if ((api.endsWith("/maps") && method === "POST") || (api.endsWith("/maps/test-map") && method === "PATCH")) {
        state.attempts++;
        const body = request.postDataJSON();
        assert.equal(body.expectedVersion, event.version);
        if (method === "PATCH") assert.equal(body.expectedMapRevision, state.map.mapRevision);
        if (state.failSave) { state.failSave = false; return reply({ error: "地圖儲存失敗，請重試。" }, 503); }
        if (method === "POST") { assert.equal(state.map, null, "retry must not create the same map twice"); state.creates++; }
        state.map = { id: "test-map", periodKey: "1", venueSpaceId: "test-space", mapRevision: (state.map?.mapRevision ?? 0) + 1, layout: body.layout, authoring: body.authoring };
        state.saves++; event.version++;
        return reply({ ok: true, draftId: state.map.id, version: event.version, mapRevision: state.map.mapRevision });
      }
      if (api.endsWith("/maps/test-map")) return reply({ map: state.map });
      throw new Error(`Unexpected API: ${method} ${api}`);
    });
  } });
  const section = name => page.getByRole("group", { name: "活動項目", exact: true }).getByRole("button", { name: new RegExp(name) });
  if (guided) { await page.getByRole("button", { name: "查看全部項目", exact: true }).click(); await section("地圖").click(); }
  if (fresh) await page.getByRole("button", { name: "建立這張地圖", exact: true }).click();
  else await page.getByRole("button", { name: "第一天", exact: true }).click();
  const editor = page.getByRole("region", { name: "活動地圖編輯器" });
  await editor.waitFor();
  const dialog = page.getByRole("dialog", { name: "尚有未儲存變更", exact: true });
  const svg = editor.locator("svg[tabindex='0']");
  const edit = async () => { await editor.getByRole("combobox", { name: "選取地圖元素" }).selectOption("slot:0:0"); await svg.press("ArrowRight"); };
  const x = () => svg.locator("[data-slot-code] rect").first().getAttribute("x");
  return { page, editor, dialog, section, state, edit, x, svg };
}

try {
  const { page, editor, dialog, section, state, edit, x } = await openWorkspace();
  await section("攤位名單").click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(await dialog.count(), 0, "unchanged saved map navigates directly");
  await page.locator("summary").filter({ hasText: "準備進度" }).click();
  await section("地圖").click();
  await page.getByRole("button", { name: "第一天", exact: true }).click();
  const originalX = await x();
  await edit();
  const editedX = await x();
  assert.notEqual(editedX, originalX);
  for (const target of [section("攤位名單"), section("檢查與預覽"), page.getByRole("button", { name: "下一步：檢查與預覽", exact: true }), page.getByRole("navigation", { name: "活動列表" }).getByRole("button", { name: /另一場活動/ })]) {
    await target.click(); await dialog.waitFor();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await x(), editedX, "cancel keeps the current map edit");
  }
  journey.report.checks.push("unchanged map switches directly; section, next-step and event navigation cancel preserves edits");

  // Exercise Chromium's actual leave prompt, not just a synthetic event listener.
  const reloadPrompt = page.waitForEvent("dialog");
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  const prompt = await reloadPrompt; assert.equal(prompt.type(), "beforeunload"); await prompt.dismiss();
  assert.equal(await x(), editedX);
  journey.report.checks.push("native reload prompt preserves edits when canceled");

  await section("攤位名單").click(); await dialog.getByRole("button", { name: "放棄", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.locator("summary").filter({ hasText: "準備進度" }).click(); await section("地圖").click();
  await page.getByRole("button", { name: "第一天", exact: true }).click();
  assert.equal(await x(), originalX); assert.equal(state.saves, 0);
  await edit(); state.failSave = true;
  await section("攤位名單").click(); await dialog.getByRole("button", { name: "儲存並切換", exact: true }).click();
  await dialog.getByRole("alert").waitFor(); assert.equal(state.saves, 0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByText("地圖儲存失敗，請重試。", { exact: true }).waitFor(); assert.equal(await x(), editedX);
  await section("攤位名單").click();
  await dialog.screenshot({ path: path.join(output, "organizer-map-unsaved-navigation.png") });
  await dialog.getByRole("button", { name: "儲存並切換", exact: true }).click();
  await editor.waitFor({ state: "hidden" }); assert.equal(state.saves, 1);
  assert.equal(String(state.map.layout.rows[0].slots[0].rect.x), editedX);
  await page.locator("summary").filter({ hasText: "準備進度" }).click(); await section("地圖").click();
  await page.getByRole("button", { name: "第一天", exact: true }).click(); assert.equal(await x(), editedX);
  let unexpectedPrompts = 0; page.on("dialog", dialog => { unexpectedPrompts++; void dialog.dismiss(); });
  await page.reload(); assert.equal(unexpectedPrompts, 0, "successful save removes the unload warning");
  journey.report.checks.push("discard restores saved map; failed save retains edits; retry persists and navigates; saved reload has no prompt");

  const guided = await openWorkspace({ guided: true });
  await guided.edit(); const guidedX = await guided.x();
  await guided.page.getByRole("button", { name: "回到基本設定", exact: true }).click();
  await guided.dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await guided.x(), guidedX);
  await guided.page.getByRole("button", { name: "回到基本設定", exact: true }).click();
  await guided.dialog.getByRole("button", { name: "放棄", exact: true }).click(); await guided.editor.waitFor({ state: "hidden" });
  await guided.page.getByRole("button", { name: "查看全部項目", exact: true }).click();
  await guided.editor.waitFor({ state: "hidden" }); assert.equal(await guided.dialog.count(), 0, "unmounted map leaves no stale dirty callback");
  journey.report.checks.push("guided return protects edits; discarding clears the guard before viewing all tasks again");

  const fresh = await openWorkspace({ fresh: true });
  await fresh.section("攤位名單").click();
  await fresh.dialog.getByRole("button", { name: "儲存並切換", exact: true }).click(); await fresh.dialog.getByRole("alert").waitFor();
  assert.equal(fresh.state.attempts, 0, "empty map is rejected before any write");
  await fresh.dialog.getByRole("button", { name: "取消", exact: true }).click();
  await fresh.page.getByText("先放入攤位或設施，才能儲存。", { exact: true }).waitFor();
  // A pending plan and a facility-only map use the same save path as the map button.
  await fresh.page.locator('input[type="file"]').setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: PIXEL });
  await fresh.page.getByRole("dialog", { name: "框選目前場地", exact: true }).getByRole("button", { name: "使用整張圖", exact: true }).click();
  await fresh.page.getByText("儲存地圖時會一起存下配置圖。", { exact: true }).waitFor();
  await openToolGroup(fresh.editor, "設施"); await fresh.editor.getByRole("button", { name: "新增出入口", exact: true }).click();
  await fresh.svg.click({ position: { x: 100, y: 100 } });
  fresh.state.failBackground = true;
  await fresh.section("攤位名單").click(); await fresh.dialog.getByRole("button", { name: "儲存並切換", exact: true }).click();
  await fresh.dialog.getByRole("alert").waitFor(); assert.equal(fresh.state.creates, 1);
  await fresh.dialog.getByRole("button", { name: "取消", exact: true }).click();
  await fresh.page.getByText("地圖已儲存，但配置圖沒有存上：配置圖儲存失敗", { exact: true }).waitFor();
  await fresh.page.locator('input[type="file"]').setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: PIXEL });
  await fresh.page.getByRole("dialog", { name: "已經有配置圖", exact: true }).getByRole("button", { name: "換成新的", exact: true }).click();
  await fresh.page.getByText("配置圖已儲存。", { exact: true }).waitFor();
  await fresh.section("攤位名單").click(); await fresh.dialog.getByRole("button", { name: "儲存並切換", exact: true }).click();
  await fresh.editor.waitFor({ state: "hidden" }); assert.equal(fresh.state.creates, 1);
  assert.equal(fresh.state.map.layout.accessPoints.length, 1);
  assert.deepEqual(fresh.state.uploads, ["plan.png", "replacement.png"], "retry must not overwrite the replacement with the failed pending plan");
  journey.report.checks.push("empty new map cannot save; facility map and pending plan retry keep the saved map identity and revision");
  const closingWorkspace = await openWorkspace();
  await closingWorkspace.edit();
  // Browser.newPage owns its context, so Playwright's page.close also disposes
  // that context. Ask Chromium to close only the tab to exercise beforeunload.
  const cdp = await closingWorkspace.page.context().newCDPSession(closingWorkspace.page);
  const closePrompt = closingWorkspace.page.waitForEvent("dialog");
  await cdp.send("Page.close");
  const closing = await closePrompt; assert.equal(closing.type(), "beforeunload"); await closing.dismiss();
  assert.equal(closingWorkspace.page.isClosed(), false);
  journey.report.checks.push("native tab-close prompt keeps the page open when canceled");
  // Multi-hall plans are cropped before any layout/background is changed.
  const cropped = await openWorkspace({ fresh: true });
  const upload = cropped.page.locator('input[type="file"]');
  const composite = { name: "composite.png", mimeType: "image/png", buffer: Buffer.from(encodePng(ruledPlan())) };
  await upload.setInputFiles(composite);
  const cropDialog = cropped.page.getByRole("dialog", { name: "框選目前場地", exact: true });
  await cropDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await cropped.svg.locator("image").count(), 0);
  assert.equal(cropped.state.uploads.length, 0);
  await upload.setInputFiles(composite);
  for (const [label, value] of [["左側 X", "110"], ["上側 Y", "20"], ["裁切寬度", "180"], ["裁切高度", "160"]]) await cropDialog.getByRole("spinbutton", { name: label, exact: true }).fill(value);
  await cropDialog.screenshot({ path: path.join(output, "organizer-map-crop.png") });
  await cropDialog.getByRole("button", { name: "使用框選範圍", exact: true }).click();
  await cropDialog.waitFor({ state: "hidden" });
  const croppedPixels = await cropped.svg.locator("image").evaluate(async node => { const img = new Image(); img.src = node.getAttribute("href"); await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
  assert.deepEqual(croppedPixels, [180, 160], "private background contains only selected source pixels");
  await openToolGroup(cropped.editor, "設施"); await cropped.editor.getByRole("button", { name: "新增出入口", exact: true }).click();
  await cropped.svg.click({ position: { x: 100, y: 100 } });
  await cropped.page.getByRole("button", { name: "建立這個活動日與場地的地圖", exact: true }).click();
  await cropped.page.getByText("地圖已儲存，尚未公開。", { exact: true }).waitFor();
  assert.deepEqual([cropped.state.map.layout.width, cropped.state.map.layout.height], [180, 160]);
  assert.deepEqual(cropped.state.map.layout.floor, { x: 0, y: 0, width: 180, height: 160 });
  // Any placed facility makes the map non-empty; replacing its plan must keep geometry.
  await upload.setInputFiles(composite);
  await cropped.page.getByRole("dialog", { name: "已經有配置圖", exact: true }).getByRole("button", { name: "換成新的", exact: true }).click();
  await cropped.page.getByText("配置圖已儲存。", { exact: true }).waitFor();
  assert.equal(await cropDialog.count(), 0);
  assert.deepEqual([cropped.state.map.layout.width, cropped.state.map.layout.height], [180, 160]);
  journey.report.checks.push("crop cancellation changes nothing; source-pixel crop sets background and canvas dimensions; facility-only map cannot be recropped");
  const late = await openWorkspace({ fresh: true });
  await late.page.evaluate(() => {
    const NativeReader = window.FileReader;
    window.FileReader = class extends NativeReader { readAsDataURL(blob) { window.releasePlanRead = () => super.readAsDataURL(blob); } };
  });
  await late.page.locator('input[type="file"]').setInputFiles(composite);
  await openToolGroup(late.editor, "設施"); await late.editor.getByRole("button", { name: "新增出入口", exact: true }).click();
  await late.svg.click({ position: { x: 100, y: 100 } });
  await late.page.evaluate(() => window.releasePlanRead());
  await late.page.locator('input[type="file"]').waitFor({ state: "attached" });
  await late.page.waitForFunction(() => !document.querySelector('input[type="file"]').disabled);
  assert.equal(await late.page.getByRole("dialog", { name: "框選目前場地", exact: true }).count(), 0);
  assert.equal(await late.svg.locator("image").count(), 0);
  assert.equal(await late.editor.getByRole("combobox", { name: "選取地圖元素" }).locator("option").filter({ hasText: "出入口" }).count(), 1);
  journey.report.checks.push("drawing while image reading is pending cancels empty-map cropping; late image cannot replace the edited canvas");
  await journey.finish();
} catch (error) { await journey.abort(error); }
