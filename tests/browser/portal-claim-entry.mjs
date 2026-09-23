// staged-data: fixture
// Focused UI regressions: the one-time challenge must survive the claims
// refresh, and a circle someone else owns never offers a form to fill in.
// Real authentication and claim ownership are exercised by portal-circle-claim
// and circle-portal-route; these responses isolate the challenge-only branch.
import assert from "node:assert/strict";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-claim-entry");
try {
  let pending = false;
  let submissions = 0;
  const challenge = "fixture-claim-challenge";
  const page = await journey.page({
    url: `${base}/circle?event=sample&circle=c-900001`,
    routes: async (page) => {
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let body;
        if (url.pathname === "/api/auth/session") body = { email: "circle@example.test", isAdmin: false, isMapContributor: false, expiresAt: Date.now() + 86400000 };
        else if (url.pathname === "/api/circle/search") {
          assert.equal(url.searchParams.get("event"), "sample");
          assert.equal(url.searchParams.get("circle"), "c-900001");
          body = { circles: [{ id: "c-900001", name: "北風畫室", links: [{ provider: "官方網站", url: "https://circle.example/" }], linkCount: 1 }] };
        } else if (url.pathname === "/api/claims" && request.method() === "POST") {
          assert.equal(request.postDataJSON().circleId, "c-900001");
          assert.equal(request.postDataJSON().targetUrl, "https://circle.example/");
          pending = true;
          submissions += 1;
          body = { id: "claim-fixture", status: "pending", challenge, targetUrl: "https://circle.example/" };
        } else if (url.pathname === "/api/claims") {
          body = { eventId: "sample", claims: pending ? [{ id: "claim-fixture", circleId: "c-900001", circleName: "北風畫室", status: "pending", targetUrl: "https://circle.example/" }] : [] };
        } else throw new Error(`unexpected fixture request ${url.pathname}`);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      });
    },
  });
  await page.getByRole("button", { name: "送出認領", exact: true }).waitFor();
  assert.equal(await page.locator("#portal-search").inputValue(), "北風畫室");
  await page.getByLabel("驗證用連結（選填）", { exact: true }).selectOption("https://circle.example/");
  await page.getByRole("button", { name: "送出認領", exact: true }).click();
  await page.getByRole("button", { name: "重新驗證", exact: true }).waitFor();
  await page.getByRole("button", { name: "送出認領", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator("code").filter({ hasText: challenge }).count(), 1, "one-time challenge survives the pending-state render");
  assert.match(await page.locator("body").innerText(), /請把驗證碼公開貼在驗證用連結頁面/);
  assert.equal(submissions, 1);
  await journey.capture(page, "claim-entry-challenge-preserved");
  await page.reload();
  await page.getByRole("button", { name: "重新驗證", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "送出認領", exact: true }).count(), 0, "returning to pending never offers duplicate submission");
  await journey.capture(page, "claim-entry-pending-return");

  // Someone else already holds the circle: the form would only end in a refusal.
  let claimPosts = 0;
  const owned = await journey.page({
    url: `${base}/circle?event=sample&circle=c-900001`,
    routes: async (page) => {
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let body;
        if (url.pathname === "/api/auth/session") body = { email: "visitor@example.test", isAdmin: false, isMapContributor: false, expiresAt: Date.now() + 86400000 };
        else if (url.pathname === "/api/circle/search") body = { circles: [{ id: "c-900001", name: "北風畫室", links: [], linkCount: 1, claimed: true }] };
        else if (url.pathname === "/api/claims" && request.method() === "POST") { claimPosts += 1; body = {}; }
        else if (url.pathname === "/api/claims") body = { eventId: "sample", claims: [] };
        else throw new Error(`unexpected fixture request ${url.pathname}`);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      });
    },
  });
  await owned.getByText("此社團已有通過的認領。若這是你的社團，請聯絡管理者。", { exact: true }).waitFor();
  assert.equal(await owned.getByRole("heading", { name: "北風畫室", exact: true }).count(), 1);
  assert.equal(await owned.getByRole("button", { name: "送出認領", exact: true }).count(), 0, "no form to fill in for an owned circle");
  assert.equal(await owned.locator("#portal-search").count(), 0);
  assert.equal(claimPosts, 0);
  await journey.capture(owned, "claim-entry-owned-elsewhere");
  await journey.finish();
} catch (error) { await journey.abort(error); }
