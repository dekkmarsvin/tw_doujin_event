// staged-data: portal
// Synthetic API responses exercise the real Organizer UI. D1 authorization and
// version guards are covered by amendment handler/repository tests; this is not
// evidence of a production amendment or GitHub App publication.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { amendmentFixture } from "../support/organizer-amendment-fixture.mjs";
import { planCircleIdentityRegistryUpdate } from "../../app/circle-identity-registry.mjs";
import { planOrganizerAmendment } from "../../app/organizer-amendment.mjs";
import { base, start } from "./support/journey.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const fixture = await amendmentFixture(vite.environments.ssr.runner);
await vite.close();
const baseline = structuredClone(fixture.baseline);
baseline.official.days[0].booths.push({ name: "丙社", codes: ["S03"], areaId: "A" }, { name: "丁社", codes: ["S04"], areaId: "A" });
baseline.grouping = { schema: "circle-identity-groups/2", eventId: baseline.event.id,
  groups: ["S01", "S02", "S03", "S04"].map((code) => ({ sources: [`1:${code}`] })), transitions: [] };
const identity = planCircleIdentityRegistryUpdate({ ...baseline,
  eventId: baseline.event.id, allocations: { schema: "circle-id-allocations/1", nextSequence: 1, allocations: [] },
  evidence: { schema: "circle-identity-evidence/1", entries: [] }, today: () => "2026-09-15" });
baseline.allocations = identity.allocations; baseline.evidence = identity.evidence;
const publicBefore = JSON.stringify(baseline.official);
const journey = await start("portal-organizer-amendment");
journey.report.synthetic = true;
journey.report.productionWrites = 0;
journey.report.sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
journey.report.sourceDirty = execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim().length > 0;

function fixtureRoutes(role, existing = false) {
  const state = { created: existing, version: 1, changes: [], impact: [], conflict: false, starts: 0, saves: 0,
    sections: { source: "review", amendment: "import" } };
  const plan = () => planOrganizerAmendment({ ...baseline, changes: state.changes, today: () => "2026-09-15" });
  const summary = (id) => ({ id, tentativeName: "#190 合成修正驗收", eventId: baseline.event.id,
    operation: id === "source" ? "CREATE" : "AMEND", status: id === "source" ? "published" : "draft",
    version: id === "source" ? 1 : state.version, updatedAt: fixture.now, updatedByRole: role, role, workspaceMode: "binder" });
  const detail = (id) => ({ event: { ...summary(id), eventIdLocked: true }, publicationAvailable: false,
    draft: baseline.draft, venueCatalog: { venues: [] }, revisions: [], publication: null,
    import: { source: { fileName: "已發布名單修正", sourceDescription: "合成驗收", mapping: {}, createdByRole: role, createdAt: fixture.now },
      rows: (id === "source" ? baseline.official : plan().official).days.flatMap((day) => day.booths.map((booth, index) => ({
        sourceRow: index + 1, dayId: String(day.day), venueSpaceId: baseline.draft.venue.assignments[0].venueSpaceId,
        areaId: booth.areaId, codes: booth.codes, circleName: booth.name, stableKey: null, identityGroup: null }))) },
    workspace: { mode: "binder", onboardingCompletedAt: fixture.now, resume: { guidedTask: "identity_source", section: state.sections[id] },
      readiness: { completed: 3, total: 6, suggestedNextSection: "import", blockers: [],
        sections: ["event", "venue", "import", "map", "validate", "review"].map((id) => ({ id, state: "available" })) } } });
  return { state, routes: async (page) => {
    await page.route("**/api/**", async (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname; const method = req.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/session") return reply({ email: `${role}@example.test`, isAdmin: role === "admin", hasOrganizerAccess: true, isMapContributor: false });
      if (path === "/api/organizer/events") return reply({ events: state.created ? [summary("amendment"), summary("source")] : [summary("source")] });
      if (path.endsWith("/source/amendments")) {
        assert.equal(method, "POST"); assert.deepEqual(req.postDataJSON(), { expectedVersion: 1 });
        assert.ok(role === "owner" || role === "admin"); state.starts++; state.created = true;
        return reply({ ok: true, candidateId: "amendment", version: 1 }, 201);
      }
      if (path.endsWith("/workspace")) { const id = path.split("/").at(-2); state.sections[id] = req.postDataJSON().lastSection; return reply({ ok: true }); }
      if (path.endsWith("/amendment/amendment")) {
        if (method === "GET") return reply({ version: state.version, changes: state.changes, impact: state.impact,
          baseline: { event: baseline.event, official: baseline.official, sourceCandidateId: "source", sourceVersion: 1, publishedAt: fixture.now } });
        const body = req.postDataJSON(); assert.deepEqual(Object.keys(body).sort(), ["changes", "expectedVersion"]);
        if (state.conflict || body.expectedVersion !== state.version) return reply({ error: "版本已變更，請重新載入。" }, 409);
        let result;
        try { result = planOrganizerAmendment({ ...baseline, changes: body.changes, today: () => "2026-09-15" }); }
        catch (error) { return reply({ error: error.message }, 422); }
        state.changes = body.changes; state.impact = result.impact; state.version++; state.saves++;
        return reply({ ok: true, version: state.version, impact: state.impact });
      }
      if (/\/events\/(source|amendment)$/.test(path)) return reply(detail(path.split("/").at(-1)));
      throw new Error(`Unexpected synthetic UI request: ${method} ${path}`);
    });
  } };
}

try {
  const ownerRoutes = fixtureRoutes("owner");
  const page = await journey.page({ url: `${base}/organizer`, routes: ownerRoutes.routes });
  await page.getByRole("button", { name: "開始修正已發布名單", exact: true }).click();
  await page.getByRole("heading", { name: "已發布名單修正", exact: true }).waitFor();
  assert.equal(ownerRoutes.state.starts, 1);
  assert.equal(await page.getByRole("button", { name: /發布後修正/ }).count(), 1);
  const form = page.getByRole("form", { name: "修正宣告表單" });
  await form.waitFor();
  const add = async (kind, source, name, code) => {
    await form.getByRole("combobox", { name: "變動類型", exact: true }).selectOption(kind);
    if (source) await form.getByRole("checkbox", { name: new RegExp(source) }).check();
    if (name) await form.getByRole("textbox", { name: kind === "released" ? "接手社團名稱" : "新增社團名稱", exact: true }).fill(name);
    if (code) {
      await form.getByRole("combobox", { name: "展區", exact: true }).selectOption("A");
      await form.getByRole("textbox", { name: "攤位代碼", exact: true }).fill(code);
    }
    if (kind === "moved") { await form.scrollIntoViewIfNeeded(); await journey.capture(page, "organizer-amendment-move-form"); }
    await form.getByRole("button", { name: "加入修正清單", exact: true }).click();
  };
  await add("withdrawn", "S01"); await add("released", "S02", "接手社");
  await add("moved", "S03", null, "S05"); await add("added", null, "新增社", "S06");
  // Navigation must not silently throw away any declaration.
  await page.getByRole("button", { name: /送審與發布/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "尚有未儲存變更" });
  await dialog.waitFor(); await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "儲存修正並檢視影響", exact: true }).click();
  await page.getByRole("heading", { name: "1. 退出", exact: true }).waitFor();
  assert.equal(ownerRoutes.state.saves, 1);
  assert.deepEqual(ownerRoutes.state.changes.map((item) => item.kind), ["withdrawn", "released", "moved", "added"]);
  const impact = page.getByRole("region", { name: "已儲存修正的影響" });
  assert.match(await impact.innerText(), /接手社.*1:S02/s);
  assert.match(await impact.innerText(), /丙社.*1:S05/s);
  assert.match(await impact.innerText(), /新增社.*1:S06/s);
  assert.equal(ownerRoutes.state.impact[2].before[0].circleId, ownerRoutes.state.impact[2].after[0].circleId);
  assert.notEqual(ownerRoutes.state.impact[1].before[0].circleId, ownerRoutes.state.impact[1].after[0].circleId);
  assert.equal(JSON.stringify(baseline.official), publicBefore);
  await journey.capture(page, "organizer-amendment-four-declarations");
  await impact.scrollIntoViewIfNeeded(); await journey.capture(page, "organizer-amendment-saved-impact");
  await page.reload(); await page.getByRole("heading", { name: "4. 新增", exact: true }).waitFor();
  assert.equal(await page.locator('input[type="file"]').count(), 0, "AMEND cannot replace a workbook");
  // Edit a saved declaration without inferring disappearance as withdrawal.
  await page.getByRole("button", { name: "修改此宣告", exact: true }).nth(1).click();
  await form.getByRole("textbox", { name: "接手社團名稱", exact: true }).fill("確認接手社");
  await form.getByRole("button", { name: "更新清單中的宣告", exact: true }).click();
  ownerRoutes.state.conflict = true;
  await page.getByRole("button", { name: "儲存修正並檢視影響", exact: true }).click();
  await page.getByRole("button", { name: "捨棄未儲存修正並讀取最新版本", exact: true }).waitFor();
  assert.match(await page.getByRole("heading", { name: /^修正清單/ }).locator("..").innerText(), /確認接手社/);
  assert.equal(ownerRoutes.state.changes[1].circleName, "接手社", "conflict preserves the server winner");
  await journey.capture(page, "organizer-amendment-conflict-preserves-input");
  ownerRoutes.state.conflict = false;
  await page.getByRole("button", { name: "捨棄未儲存修正並讀取最新版本", exact: true }).click();
  await page.getByRole("heading", { name: "4. 新增", exact: true }).waitFor();
  await page.getByRole("button", { name: /送審與發布/ }).first().click();
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "送出審閱", exact: true }).isDisabled(), true);
  await journey.capture(page, "organizer-amendment-publication-not-enabled");
  await page.close();
  for (const role of ["editor", "admin"]) {
    const routes = fixtureRoutes(role);
    const actor = await journey.page({ url: `${base}/organizer`, routes: routes.routes, viewport: { width: 1100, height: 900 } });
    await actor.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
    assert.equal(await actor.getByRole("button", { name: "開始修正已發布名單", exact: true }).count(), role === "admin" ? 1 : 0);
    await journey.capture(actor, `organizer-amendment-${role}-entry`); await actor.close();
  }
  const editorRoutes = fixtureRoutes("editor", true);
  const editor = await journey.page({ url: `${base}/organizer`, routes: editorRoutes.routes, viewport: { width: 1100, height: 900 } });
  await editor.getByRole("heading", { name: "已發布名單修正", exact: true }).waitFor();
  assert.equal(await editor.getByRole("combobox", { name: "變動類型", exact: true }).isEnabled(), true);
  await editor.getByRole("combobox", { name: "變動類型", exact: true }).selectOption("released");
  await editor.getByRole("checkbox", { name: /S02/ }).check();
  await editor.getByRole("textbox", { name: "接手社團名稱", exact: true }).fill("協作者確認接手社");
  await journey.capture(editor, "organizer-amendment-editor-form-1100");
  await editor.getByRole("button", { name: "加入修正清單", exact: true }).click();
  await editor.getByRole("button", { name: "儲存修正並檢視影響", exact: true }).click();
  await editor.getByRole("heading", { name: "1. 換手", exact: true }).waitFor();
  assert.equal(editorRoutes.state.saves, 1);
  await editor.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
