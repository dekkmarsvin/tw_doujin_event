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
    else if (path === "/api/admin/review-queue") body = { claims: [], pendingClaimCount: 0, claimCounts: [], mapDrafts: [], organizer: { applications: 0, submissions: 0 } };
    else if (path === "/api/admin/site-settings") body = { settings: { organizerApplicationMode: "closed", organizerAllowedEmails: [], accountNotificationsEnabled: false,
      accountNotificationsSince: null, adminReviewNotificationsEnabled: false, publicationEnabled: true, contactUrl: "", claimReviewNotice: "", updatedAt: now, updatedBy: "fixture" },
      publicationMode: "disabled", services: null, publicationActivities: [] };
    else if (path === "/api/admin/map-contributions/drafts") body = { drafts: [] };
    else if (path.startsWith("/api/admin/map-contributions/drafts/")) { status = 404; body = { error: "找不到指定草稿。" }; }
    else if (path.endsWith("/claims")) body = { claims: [], eventId: "sample" };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}

try {
  for (const entry of ["circle", "organizer", "admin"]) for (const isAdmin of [false, true]) {
    const name = `${entry}-${isAdmin ? "admin" : "member"}`;
    const page = await journey.page({ url: `${base}/${entry}${entry === "admin" ? "?section=circles&view=claims&event=sample" : ""}`, routes: page => routes(page, { isAdmin }) });
    currentPage = page;
    // The account is shown while signed in; expiry still returns to login on every surface.
    await page.getByRole("banner").getByText(/session@example.test/).waitFor();
    await journey.capture(page, `${name}-signed-in`);
    await page.clock.fastForward(week);
    await page.getByText("登入已到期，請重新登入。", { exact: true }).waitFor();
    if (entry === "admin") {
      const login = page.getByRole("link", { name: "前往社團入口登入", exact: true });
      await login.waitFor();
      const continuation = new URL(await login.getAttribute("href"), base);
      assert.equal(continuation.searchParams.get("adminSection"), "circles");
      assert.equal(continuation.searchParams.get("adminView"), "claims");
      assert.equal(continuation.searchParams.get("adminEvent"), "sample");
    }
    else await page.getByRole("button", { name: "寄出登入連結", exact: true }).waitFor();
    await journey.capture(page, `${name}-expired`);
    await page.close();
  }

  // A deep Admin destination survives the shared circle form and the emailed
  // continuation. The final page still applies the signed-in account's role.
  for (const [destination, isAdmin] of [
    ["/admin?section=circles&view=claims&event=sample&claim=claim-one", true],
    ["/admin?section=events&view=maps&event=sample&draft=map-one", true],
    ["/admin#review-notifications", true],
    ["/admin?section=accounts", false],
  ]) {
    let verified = false;
    let requested;
    const page = await journey.page({ url: `${base}${destination}`, routes: async page => {
      await routes(page, { isAdmin });
      await page.route("https://challenges.cloudflare.com/turnstile/**", route => route.fulfill({ contentType: "text/javascript", body: `
        window.turnstile = { render: (host, options) => { setTimeout(() => options.callback("journey-token")); return "widget"; }, remove: () => {} };
        window.__ff47TurnstileReady();` }));
      await page.route("**/api/auth/config*", route => route.fulfill({ json: { turnstileSitekey: "journey-sitekey" } }));
      await page.route("**/api/auth/session*", route => route.fulfill({ status: verified ? 200 : 401, json: verified
        ? { email: "session@example.test", isAdmin, isMapContributor: false, hasOrganizerAccess: true, expiresAt: now + week }
        : { error: "尚未登入。" } }));
      await page.route("**/api/auth/request-link*", route => {
        requested = route.request().postDataJSON();
        return route.fulfill({ status: 202, json: { ok: true } });
      });
      await page.route("**/api/auth/verify*", route => {
        assert.equal(route.request().postDataJSON().token, "journey-login-token");
        verified = true;
        return route.fulfill({ json: { email: "session@example.test", isAdmin, isMapContributor: false, hasOrganizerAccess: true, expiresAt: now + week } });
      });
      await page.route("**/api/admin/notification-preferences*", route => route.fulfill({ json: { enabled: true, cadence: "five_minutes", version: 1 } }));
    } });
    currentPage = page;
    await page.getByRole("heading", { name: "請先登入", exact: true }).waitFor();
    await page.locator('a[href^="/circle?"]').click();
    await page.getByLabel("Email", { exact: true }).fill("session@example.test");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "寄出登入連結" && !button.disabled));
    await page.getByRole("button", { name: "寄出登入連結", exact: true }).click();
    await page.getByText("若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。", { exact: true }).waitFor();
    assert.equal(requested.audience, "circle");
    assert.equal(requested.destination.event, undefined);
    assert.equal(requested.destination.circle, undefined);
    const link = new URL("/circle", base);
    link.search = new URLSearchParams({ ...requested.destination, login: "journey-login-token" });
    await page.goto(link.href);
    await page.waitForURL(url => url.pathname === "/admin");
    const returned = new URL(page.url());
    assert.equal(`${returned.pathname}${returned.search}${returned.hash}`, destination);
    await page.getByRole("heading", { name: isAdmin ? "網站管理" : "需要管理者權限", exact: true }).waitFor();
    assert.equal(returned.searchParams.has("login"), false);
    await journey.capture(page, `admin-login-continuation-${isAdmin ? new URL(destination, base).searchParams.get("section") || "notifications" : "member"}`);
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
