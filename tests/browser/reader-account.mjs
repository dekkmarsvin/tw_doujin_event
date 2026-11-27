// staged-data: fixture
// The reader's 我的 menu (#581): anonymous readers send nothing to the API;
// a device that signed in before shows its circles, event and review queue.
import assert from "node:assert/strict";
import { start } from "./support/journey.mjs";

const HINT = "tw-doujin:signed-in";
const now = Date.parse("2026-08-20T00:00:00Z");
const day = 24 * 60 * 60 * 1000;
const journey = await start("reader-account");

/** Answers the portal API for one account; records every path asked. */
function account(asked, { session, claims = [], events = [], queue = null, services = null }) {
  return async (page) => {
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      asked.push(url.pathname);
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/api/auth/session") return session ? reply(session) : reply({ error: "尚未登入。" }, 401);
      if (url.pathname === "/api/claims") return reply({ eventId: url.searchParams.get("event"), claims });
      if (url.pathname === "/api/organizer/events") return reply({ events });
      if (url.pathname.startsWith("/api/organizer/events/")) return reply({ claims: [], pendingClaimCount: 3, organizer: { applications: 0, submissions: 0 } });
      if (url.pathname === "/api/admin/review-queue") return reply(queue);
      if (url.pathname === "/api/admin/site-settings") return reply({ settings: {}, publicationMode: "r2", services });
      return reply({ error: "unexpected" }, 404);
    });
  };
}
const signedInBefore = (setup) => async (page) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), HINT);
  await setup(page);
};
const menu = (page) => page.getByRole("button", { name: /^我的/ });

try {
  // Anonymous: no request reaches the API, and 登入 keeps the event.
  {
    const asked = [];
    const page = await journey.mapPage({ routes: account(asked, {}) });
    await menu(page).click();
    const signIn = page.getByRole("link", { name: "社團或主辦登入", exact: true });
    assert.equal(await signIn.getAttribute("href"), "/circle?event=sample");
    assert.deepEqual(asked, [], "an anonymous reader asks the server nothing");
    await journey.capture(page, "reader-account-anonymous");
    await page.close();
  }

  // A circle: its claims in this event, each with what it can do next.
  {
    const asked = [];
    const page = await journey.mapPage({ routes: signedInBefore(account(asked, {
      session: { email: "circle@example.test", isAdmin: false, hasOrganizerAccess: false, expiresAt: now + 7 * day },
      claims: [
        { id: "claim-1", circleId: "c-900001", circleName: "北風畫室", status: "verified", method: null, targetUrl: null, evidenceUrl: null, createdAt: now },
        { id: "claim-2", circleId: "c-900002", circleName: "南星工房", status: "rejected", method: null, targetUrl: null, evidenceUrl: null, createdAt: now },
      ],
    })) });
    // A claim that needs more evidence is the reader's to act on.
    await page.getByRole("button", { name: "我的：circle@example.test（需要留意）", exact: true }).click();
    const panel = page.locator("[data-reader-menu]");
    await panel.getByText("已認領", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("link", { name: "編輯", exact: true }).getAttribute("href"), "/circle?event=sample&circle=c-900001");
    assert.equal(await panel.getByRole("link", { name: "社團頁", exact: true }).getAttribute("href"), "/events/sample/circles/c-900001/");
    await panel.getByText("需補件", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("link", { name: "重新認領", exact: true }).getAttribute("href"), "/circle?event=sample&circle=c-900002");
    assert.ok(!asked.includes("/api/organizer/events") && !asked.includes("/api/admin/review-queue"), "a circle is not asked about workspaces it cannot open");
    await journey.capture(page, "reader-account-circle");
    await page.close();
  }

  // An admin who is also a member of this event's workspace (real API returns role: "admin" with isMember: true).
  {
    const asked = [];
    const page = await journey.mapPage({ routes: signedInBefore(account(asked, {
      session: { email: "admin@example.test", isAdmin: true, hasOrganizerAccess: true, expiresAt: now + 7 * day },
      events: [
        { id: "cand-old", eventId: "sample", tentativeName: "舊版", status: "published", version: 1, updatedAt: now - day, updatedByRole: "owner", role: "admin", isMember: true, workspaceMode: "guided" },
        { id: "cand-new", eventId: "sample", tentativeName: "範例創作市集", status: "approved", version: 2, updatedAt: now, updatedByRole: "owner", role: "admin", isMember: true, workspaceMode: "guided" },
        { id: "cand-other-admin", eventId: "sample", tentativeName: "別人的活動", status: "draft", version: 3, updatedAt: now + day, updatedByRole: "owner", role: "admin", isMember: false, workspaceMode: "guided" },
        { id: "cand-other", eventId: "other", tentativeName: "別的活動", status: "draft", version: 1, updatedAt: now, updatedByRole: "admin", role: "admin", isMember: false, workspaceMode: "guided" },
      ],
      queue: { claims: [], pendingClaimCount: 4, claimCounts: [], organizer: { applications: 1, submissions: 2 } },
      services: { requestedAt: Date.now(), checkedAt: Date.now(), mail: { status: "unavailable", source: "Mailgun", reason: "金鑰驗證失敗。" }, publication: { status: "available", source: "活動資料發布", reason: "" } },
    })) });
    // A service that is down outranks everything else waiting.
    await page.getByRole("button", { name: "我的：admin@example.test（有問題）", exact: true }).click();
    const panel = page.locator("[data-reader-menu]");
    await panel.getByText("送審（含發布未完成）", { exact: true }).waitFor();
    await panel.getByText("不可用", { exact: true }).waitFor();
    // The newest workspace this admin is a member of (ignoring newer non-member admin rows).
    await panel.getByText("發布未完成", { exact: true }).waitFor();
    await panel.getByText("本場待審認領 3", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("link", { name: "編輯活動", exact: true }).getAttribute("href"), "/organizer?candidate=cand-new");
    await journey.capture(page, "reader-account-admin");
    // Signing out in another visible tab removes the hint and clears the panel immediately.
    await page.evaluate((key) => {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent("storage", { key, oldValue: "1", newValue: null, storageArea: localStorage }));
    }, HINT);
    await panel.getByRole("link", { name: "社團或主辦登入", exact: true }).waitFor();
    assert.equal(await panel.getByText("admin@example.test").count(), 0, "signing out in another tab clears the old email");
    await page.close();
  }

  // Mailgun unknown is shown as 無法確認 (not 可用), and stale unavailable (>7d) shows the last check date instead of red.
  {
    const asked = [];
    const page = await journey.mapPage({ routes: signedInBefore(account(asked, {
      session: { email: "admin@example.test", isAdmin: true, hasOrganizerAccess: false, expiresAt: now + 7 * day },
      queue: { claims: [], pendingClaimCount: 0, claimCounts: [], organizer: { applications: 0, submissions: 0 } },
      services: { requestedAt: Date.now(), checkedAt: Date.now(), mail: { status: "unknown", source: "Mailgun", reason: "無法確認。" }, publication: { status: "available", source: "活動資料發布", reason: "" } },
    })) });
    await page.getByRole("button", { name: "我的：admin@example.test", exact: true }).click();
    const panel = page.locator("[data-reader-menu]");
    await panel.getByText("無法確認", { exact: true }).waitFor();
    await page.close();
  }
  {
    const asked = [];
    const stale = Date.now() - 8 * day;
    const page = await journey.mapPage({ routes: signedInBefore(account(asked, {
      session: { email: "admin@example.test", isAdmin: true, hasOrganizerAccess: false, expiresAt: now + 7 * day },
      queue: { claims: [], pendingClaimCount: 0, claimCounts: [], organizer: { applications: 0, submissions: 0 } },
      services: { requestedAt: stale, checkedAt: stale, mail: { status: "unavailable", source: "Mailgun", reason: "金鑰驗證失敗。" }, publication: { status: "available", source: "活動資料發布", reason: "" } },
    })) });
    await page.getByRole("button", { name: "我的：admin@example.test", exact: true }).click();
    const panel = page.locator("[data-reader-menu]");
    await panel.getByText(/^上次檢查 /).waitFor();
    await page.close();
  }

  // A session that ended mid-flight (session 200, subsequent /api/claims 401) clears the mark and does not keep the old email.
  {
    const asked = [];
    const page = await journey.mapPage({ routes: signedInBefore(async (p) => {
      await p.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        asked.push(url.pathname);
        const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/api/auth/session") return reply({ email: "stale@example.test", isAdmin: false, hasOrganizerAccess: false, expiresAt: now + 7 * day });
        if (url.pathname === "/api/claims") return reply({ error: "尚未登入。" }, 401);
        return reply({ error: "unexpected" }, 404);
      });
    }) });
    await page.waitForFunction((key) => localStorage.getItem(key) === null, HINT);
    await menu(page).click();
    await page.getByRole("link", { name: "社團或主辦登入", exact: true }).waitFor();
    assert.equal(await page.locator("[data-reader-menu]").getByText("stale@example.test").count(), 0);
    await page.close();
  }

  // A session that ended clears the device's mark, and the reader is anonymous again.
  {
    const asked = [];
    const page = await journey.mapPage({ routes: signedInBefore(account(asked, {})) });
    await page.waitForFunction((key) => localStorage.getItem(key) === null, HINT);
    await menu(page).click();
    await page.getByRole("link", { name: "社團或主辦登入", exact: true }).waitFor();
    assert.deepEqual(asked, ["/api/auth/session"]);
    await page.close();
  }
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
