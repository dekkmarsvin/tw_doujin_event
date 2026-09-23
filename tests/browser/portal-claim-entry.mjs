// staged-data: fixture
// Focused UI regression: the one-time challenge must survive the claims refresh.
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
  await journey.finish();
} catch (error) { await journey.abort(error); }
