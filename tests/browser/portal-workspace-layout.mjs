// staged-data: fixture
// The signed-in /circle page as one column: every section spans the masthead's
// width, the claim row is cut on the editor's own form/preview line, the event
// is chosen under the title, and account deletion sits after the event's work.
// A circle with nothing claimed is shown where to begin.
// Responses are fixtures: real claims and editing run in portal-circle-claim.
import assert from "node:assert/strict";
import { base, start } from "./support/journey.mjs";

const verified = { id: "claim-1", circleId: "c-900001", circleName: "北風畫室", status: "verified", targetUrl: null };
const pending = { id: "claim-2", circleId: "c-900002", circleName: "南星工房", status: "pending", targetUrl: "https://circle.example/" };

/** `claimsGate` holds the claim list back until the journey releases it. */
function portalRoutes(claimsByEvent, claimsGate) {
  return async (page) => {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname === "/api/auth/session") body = { email: "circle@example.test", isAdmin: false, isMapContributor: false, expiresAt: Date.now() + 86400000 };
      else if (url.pathname === "/api/claims") {
        await claimsGate;
        const event = url.searchParams.get("event");
        body = { eventId: event, claims: claimsByEvent[event] ?? [] };
      } else if (url.pathname === "/api/circle/search") body = { circles: [] };
      else if (url.pathname === "/api/circle/c-900001/overrides") body = { fields: {}, status: "active", postEventHidden: false, retention: null, retentionExpiresAt: null };
      else if (url.pathname === "/api/circle/c-900001/preview") body = { records: [], baseRecords: [], projectedAt: new Date().toISOString() };
      else throw new Error(`unexpected fixture request ${url.pathname}`);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
  };
}

const box = (locator) => locator.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { left: Math.round(rect.left), right: Math.round(rect.right) };
});

const journey = await start("portal-workspace-layout");
try {
  for (const width of [1440, 1024]) {
    const page = await journey.page({ url: `${base}/circle?event=sample`, viewport: { width, height: 900 }, routes: portalRoutes({ sample: [verified, pending] }) });
    const editor = page.locator("#circle-editor-c-900001");
    await editor.getByRole("complementary", { name: "即時公開預覽" }).waitFor();
    const masthead = await box(page.getByRole("banner"));
    const mine = await box(page.getByRole("heading", { name: "我的社團", exact: true }).locator(".."));
    const claim = await box(page.getByRole("heading", { name: "認領社團", exact: true }).locator(".."));
    const account = await box(page.getByRole("region", { name: "帳號", exact: true }));
    const form = await box(page.locator("#editor-fields-c-900001"));
    const preview = await box(editor.getByRole("complementary", { name: "即時公開預覽" }));
    const detail = JSON.stringify({ width, masthead, mine, claim, form, preview, account });
    for (const section of [mine, await box(editor), account]) assert.equal(section.left, masthead.left, `sections share the masthead's left edge: ${detail}`);
    for (const section of [claim, await box(editor), account]) assert.equal(section.right, masthead.right, `sections share the masthead's right edge: ${detail}`);
    assert.equal(mine.right, form.right, `my circles end where the editor's form ends: ${detail}`);
    assert.equal(claim.left, preview.left, `the claim starts where the editor's preview starts: ${detail}`);

    // The event belongs under the title, not in a card of its own.
    assert.equal(await page.getByRole("banner").getByLabel("活動", { exact: true }).inputValue(), "sample");
    assert.equal(await page.getByRole("heading", { name: "活動", exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "編輯資料", exact: true }).getAttribute("href"), "#circle-editor-c-900001");
    assert.equal(await page.getByRole("list", { name: "開始使用", exact: true }).count(), 0, "a circle with claims is past the first step");

    // Account-wide and irreversible: after the event's work, closed until asked for.
    const deletion = page.getByRole("region", { name: "帳號", exact: true }).locator("details");
    assert.equal(await deletion.evaluate((node) => node.open), false);
    assert.ok(await editor.evaluate((node, region) => Boolean(node.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING), await deletion.elementHandle()), "account deletion follows the editors");
    await deletion.getByText("刪除帳號", { exact: true }).click();
    await page.getByRole("button", { name: "永久刪除帳號", exact: true }).waitFor();
    assert.match(await deletion.innerText(), /所有活動/);
    await journey.capture(page, `workspace-${width}-claimed`);
    await page.close();
  }

  // Nothing claimed in this event: the claim form is the page's one task and
  // says it is the first step — but only once the claims have answered.
  let release;
  const claimsGate = new Promise((resolve) => { release = resolve; });
  const first = await journey.page({ url: `${base}/circle?event=sample`, viewport: { width: 1440, height: 900 }, routes: portalRoutes({ sample: [verified] }, claimsGate) });
  await first.locator("#portal-search").waitFor();
  assert.equal(await first.getByRole("list", { name: "開始使用", exact: true }).count(), 0, "no first-step guide before the claims answer");
  release();
  await first.getByRole("link", { name: "編輯資料", exact: true }).waitFor();
  // Clear On Move: nothing typed toward a deletion outlives an event switch.
  const deletion = first.getByRole("region", { name: "帳號", exact: true }).locator("details");
  await deletion.getByText("刪除帳號", { exact: true }).click();
  await first.locator("#delete-account-confirm").fill("circle@example.test");
  await first.getByRole("banner").getByLabel("活動", { exact: true }).selectOption("sample-two");
  const steps = first.getByRole("list", { name: "開始使用", exact: true });
  await steps.waitFor();
  assert.deepEqual(await steps.getByRole("listitem").allTextContents(), ["1認領社團從這裡開始", "2驗證身分", "3編輯社團資料"]);
  assert.equal(await steps.getByRole("listitem").first().getAttribute("aria-current"), "step");
  assert.equal(new URL(first.url()).searchParams.get("event"), "sample-two");
  assert.equal(await deletion.evaluate((node) => node.open), false, "the account section resets with the event");
  const masthead = await box(first.getByRole("banner"));
  const claim = await box(first.getByRole("heading", { name: "認領社團", exact: true }).locator(".."));
  assert.deepEqual(claim, masthead, "alone, the claim spans the row");
  await journey.capture(first, "workspace-1440-first-claim");
  await first.close();

  const phone = await journey.page({ url: `${base}/circle?event=sample-two`, viewport: { width: 390, height: 844 }, routes: portalRoutes({}) });
  await phone.getByRole("list", { name: "開始使用", exact: true }).waitFor();
  await journey.capture(phone, "workspace-390-first-claim");
  await phone.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
