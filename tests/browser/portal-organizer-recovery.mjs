// staged-data: portal
// Synthetic UI journey; handler/D1/GitHub tests own restoration verification.
import assert from "node:assert/strict";
import path from "node:path";
import { base, output, start } from "./support/journey.mjs";

const id = "failed-amendment";
const jobId = "retained-failed-job";
const draft = { schema: "organizer-event-draft/1", event: { id: "event-alpha", name: "未公開修正恢復驗證",
  days: [{ id: "1", label: "活動日", date: "2026-10-09" }] }, venue: { assignments: [] },
  officialSource: { label: "合成測試資料", url: "https://example.test" } };
const journey = await start("portal-organizer-recovery");

async function routes(page, role, result) {
  let state = "failed";
  const bodies = [];
  let release, seen;
  const gate = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { seen = resolve; });
  const event = () => ({ id, tentativeName: draft.event.name, eventId: "event-alpha", operation: "AMEND",
    status: state, version: 2, updatedAt: 1789980000000, updatedByRole: "admin", role, workspaceMode: "binder" });
  const reply = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/auth/session", (route) => reply(route, { email: `${role}@example.test`, isAdmin: role === "admin",
    isMapContributor: false, hasOrganizerAccess: true }));
  await page.route("**/api/organizer/events", (route) => reply(route, { events: [event()] }));
  await page.route(`**/api/organizer/events/${id}`, (route) => reply(route, {
    event: { ...event(), eventIdLocked: true }, draft, venueCatalog: { venues: [] }, revisions: [], import: null,
    publicationAvailable: true, recoveryAvailable: role === "admin" && state === "failed",
    publication: { id: jobId, status: "failed", step: "merging_main", error: "approved snapshot mismatch",
      failureCode: "snapshot_mismatch", retryable: false, started: true, candidateVersion: 2, updatedAt: 1789980000000 },
    workspace: { mode: "binder", onboardingCompletedAt: 1789980000000, resume: { guidedTask: "identity_source", section: "review" },
      readiness: { completed: 0, total: 6, suggestedNextSection: "review", blockers: [], sections:
        ["event", "venue", "import", "map", "validate", "review"].map((section) => ({ id: section, state: "available" })) } },
  }));
  await page.route(`**/api/organizer/events/${id}/workspace`, (route) => reply(route, { ok: true }));
  await page.route(`**/api/admin/organizer/events/${id}/abandon`, async (route) => {
    bodies.push(route.request().postDataJSON()); seen();
    await gate;
    if (result === "expired") return reply(route, { error: "尚未登入。" }, 401);
    if (result === "refused") return reply(route, { error: "還原紀錄或公開基準未通過核對，這次修正仍維持失敗狀態。" }, 409);
    state = "abandoned";
    return reply(route, { ok: true, status: state, sourceCandidateId: "published-source" });
  });
  return { bodies, requested, release: () => release(), get state() { return state; } };
}

async function open(role, result, viewport) {
  let control;
  const page = await journey.page({ url: `${base}/organizer`, viewport, routes: async (tab) => { control = await routes(tab, role, result); } });
  await page.getByRole("heading", { name: "送審與發布狀態", exact: true }).waitFor();
  return { page, control };
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1040, height: 768 }]) {
    const { page, control } = await open("admin", "success", viewport);
    const button = page.getByRole("button", { name: "核對還原並終止", exact: true });
    assert.equal(await button.isDisabled(), true);
    await page.getByLabel("資料還原 PR 編號", { exact: true }).fill("7");
    assert.equal(await button.isDisabled(), true);
    await page.getByLabel("終止原因", { exact: true }).fill("未公開產物已由還原 PR 復原");
    const panel = page.locator("div").filter({ has: page.getByRole("heading", { name: "終止失敗修正", exact: true }) }).last();
    await panel.screenshot({ path: path.join(output, `recovery-form-${viewport.width}.png`) });
    await button.click();
    await control.requested;
    assert.equal(await button.isDisabled(), true, "cannot duplicate a pending recovery");
    control.release();
    await page.getByText("這次修正已終止，失敗紀錄保留。原公開內容未變；請在活動清單選擇已發布版本，再開始修正。", { exact: true }).waitFor();
    assert.equal(control.state, "abandoned");
    assert.deepEqual(control.bodies, [{ expectedVersion: 2, restorationPullNumber: 7, reason: "未公開產物已由還原 PR 復原" }]);
    assert.equal(await button.count(), 0);
    assert.equal(await page.getByRole("button", { name: "重試發布", exact: true }).count(), 0);
    await page.getByText("技術詳細資訊", { exact: true }).click();
    await page.getByText(`工作：${jobId}`, { exact: true }).waitFor();
    await journey.capture(page, `recovery-retained-history-${viewport.width}`);
    await page.getByRole("group", { name: "活動項目" }).getByRole("button", { name: /^活動/ }).click();
    assert.equal(await page.getByLabel(/^活動名稱/).isDisabled(), true, "retired content is read-only");
    await page.close();
  }
  for (const result of ["refused", "expired"]) {
    const { page, control } = await open("admin", result);
    await page.getByLabel("資料還原 PR 編號", { exact: true }).fill("7");
    await page.getByLabel("終止原因", { exact: true }).fill("核對還原");
    await page.getByRole("button", { name: "核對還原並終止", exact: true }).click();
    await control.requested; control.release();
    await page.getByText(result === "expired" ? "登入已到期，請重新登入。" : "還原紀錄或公開基準未通過核對，這次修正仍維持失敗狀態。", { exact: true }).waitFor();
    assert.equal(control.state, "failed");
    await journey.capture(page, `recovery-${result}`);
    await page.close();
  }
  for (const role of ["owner", "editor"]) {
    const { page, control } = await open(role, "success");
    assert.equal(await page.getByRole("button", { name: "核對還原並終止", exact: true }).count(), 0);
    assert.equal(control.bodies.length, 0);
    journey.report.checks.push(`${role} cannot initiate restoration recovery`);
    await page.close();
  }
  const mobile = await journey.page({ url: `${base}/organizer`, viewport: { width: 390, height: 844 },
    routes: (page) => routes(page, "admin", "success") });
  await mobile.getByRole("heading", { name: "請改用桌機", exact: true }).waitFor();
  assert.equal(await mobile.getByRole("button", { name: "核對還原並終止", exact: true }).count(), 0);
  await journey.capture(mobile, "recovery-mobile-desktop-guidance");
  await mobile.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
