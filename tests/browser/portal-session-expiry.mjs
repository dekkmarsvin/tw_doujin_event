// staged-data: fixture
import assert from "node:assert/strict";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-session-expiry");
const now = Date.parse("2026-09-15T00:00:00Z");
const week = 7 * 24 * 60 * 60 * 1000;
let currentPage;

async function routes(page, { isAdmin, failure = 0 }) {
  await page.clock.install({ time: now });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let body = {};
    if (path === "/api/auth/session") body = { email: "session@example.test", isAdmin, isMapContributor: false, hasOrganizerAccess: true, expiresAt: now + week };
    else if (path === "/api/auth/config") body = { turnstileSitekey: "" };
    else if (path === "/api/organizer/events") { status = failure || 200; body = failure ? { error: failure === 401 ? "尚未登入。" : "沒有權限。" } : { events: [] }; }
    else if (path === "/api/admin/admins") body = { admins: [], self: "session@example.test" };
    else if (path === "/api/admin/map-contributions/drafts") body = { drafts: [] };
    else if (path.endsWith("/claims")) body = { claims: [], eventId: "sample" };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}

try {
  for (const entry of ["circle", "organizer", "admin"]) for (const isAdmin of [false, true]) {
    const name = `${entry}-${isAdmin ? "admin" : "member"}`;
    const page = await journey.page({ url: `${base}/${entry}`, routes: page => routes(page, { isAdmin }) });
    currentPage = page;
    await page.getByRole("button", { name: "登出", exact: true }).waitFor();
    assert.equal(await page.locator("time").getAttribute("datetime"), new Date(now + week).toISOString());
    await journey.capture(page, `${name}-session-deadline`);
    await page.clock.fastForward(week);
    await page.getByText(entry === "admin" ? "登入已到期，請前往社團入口重新登入。" : "登入已到期，請重新登入。", { exact: true }).waitFor();
    if (entry === "admin") await page.getByRole("link", { name: "前往社團入口登入", exact: true }).waitFor();
    else await page.getByRole("button", { name: "寄出登入連結", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "登出", exact: true }).count(), 0);
    await journey.capture(page, `${name}-expired`);
    await page.close();
  }

  // An early server revocation updates the login display; a role denial does not.
  for (const failure of [401, 403]) {
    const page = await journey.page({ url: `${base}/organizer`, routes: page => routes(page, { isAdmin: true, failure }) });
    currentPage = page;
    if (failure === 401) {
      await page.getByText("登入已到期，請重新登入。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "寄出登入連結", exact: true }).waitFor();
    } else {
      await page.getByText("沒有權限。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "登出", exact: true }).waitFor();
    }
    await journey.capture(page, `organizer-session-response-${failure}`);
    await page.close();
  }
  await journey.finish();
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await journey.capture(currentPage, "session-failure");
    console.error(await currentPage.locator("body").innerText());
  }
  await journey.abort(error);
}
