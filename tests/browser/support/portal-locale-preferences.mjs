import assert from "node:assert/strict";
import { base } from "./journey.mjs";

export async function verifyLocalePreferences(journey) {
  let preferences = { cadence: "hourly", version: 7, locale: "ja" };
  let mode = "pass", release, started;
  const writes = [];
  const page = await journey.page({ url: `${base}/circle?event=sample&lang=en`, routes: async p => {
    await p.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({ json: { email: "locale-fixture@example.test", isAdmin: false, isMapContributor: false } });
      if (path === "/api/claims") return route.fulfill({ json: { claims: [], eventId: "sample" } });
      if (path === "/api/account/notification-preferences") {
        if (request.method() === "GET") return route.fulfill({ json: preferences });
        const body = request.postDataJSON();
        writes.push(body);
        started?.();
        if (mode === "hold") await new Promise(resolve => { release = resolve; });
        if (mode === "fail") return route.fulfill({ status: 503, json: { code: "service_unavailable", error: "暫時無法儲存。" } });
        if (mode === "conflict" || body.version !== preferences.version) return route.fulfill({ status: 409, json: { code: "version_conflict", error: "設定已變更，請重新載入後再儲存。" } });
        preferences = { ...preferences, ...body, version: preferences.version + 1 };
        return route.fulfill({ json: preferences });
      }
      return route.fulfill({ json: {} });
    });
  } });
  const language = page.getByRole("banner").getByRole("combobox").filter({ has: page.locator('option[value="en"]') });
  await page.getByRole("button", { name: "Account", exact: true }).waitFor();
  assert.equal(writes.length, 0, "a URL changes only the interface, not saved notification language");
  mode = "hold";
  const pending = new Promise(resolve => { started = resolve; });
  await language.selectOption("zh-Hant");
  await pending;
  await language.selectOption("ja");
  await page.getByRole("button", { name: "アカウント", exact: true }).waitFor();
  assert.equal(writes.length, 1, "a second choice waits for the current write's version");
  mode = "pass"; release();
  await page.waitForResponse(r => r.request().method() === "PUT" && r.request().postDataJSON().locale === "ja");
  assert.deepEqual(writes.slice(0, 2), [{ version: 7, locale: "zh-Hant" }, { version: 8, locale: "ja" }]);
  assert.equal(preferences.cadence, "hourly");

  mode = "fail";
  await language.selectOption("en");
  await page.getByRole("alert").waitFor();
  assert.equal(preferences.locale, "ja");
  assert.equal(await language.inputValue(), "en", "failed persistence does not revert the user's interface language");
  mode = "pass";
  await page.getByRole("button", { name: "Retry saving notification language", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(preferences.locale, "en");

  mode = "conflict";
  await language.selectOption("ja");
  await page.getByRole("alert").waitFor();
  preferences = { ...preferences, cadence: "off", version: preferences.version + 1 };
  const count = writes.length;
  mode = "pass";
  await page.getByRole("button", { name: "設定を再読み込み", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "通知言語の保存を再試行", exact: true }).waitFor();
  assert.equal(writes.length, count, "conflict recovery reads without replaying a stale write");
  await page.getByRole("button", { name: "通知言語の保存を再試行", exact: true }).click();
  await page.getByRole("button", { name: "通知言語の保存を再試行", exact: true }).waitFor({ state: "hidden" });
  assert.equal(preferences.locale, "ja");
  assert.equal(preferences.cadence, "off", "a locale retry preserves the other device's cadence");
  assert.ok(writes.every(write => !Object.hasOwn(write, "cadence")), "locale writes never include cadence");
  await page.getByRole("button", { name: "アカウント", exact: true }).click();
  const dialogRead = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/account/notification-preferences");
  await page.getByRole("button", { name: "通知設定", exact: true }).click();
  await dialogRead;
  const dialog = page.getByRole("dialog", { name: "通知設定", exact: true });
  assert.equal(await dialog.getByLabel("サークル情報の更新", { exact: true }).inputValue(), "off");
  const cadenceWrite = page.waitForResponse(r => r.request().method() === "PUT" && Object.hasOwn(r.request().postDataJSON(), "cadence"));
  await dialog.getByLabel("サークル情報の更新", { exact: true }).selectOption("hourly");
  await cadenceWrite;
  await dialog.getByText("保存しました", { exact: true }).waitFor();
  assert.deepEqual(Object.keys(writes.at(-1)).sort(), ["cadence", "version"]);
  await journey.capture(page, "account-notification-locale-ja");
  await page.close();

  // A newly signed-in account with no preference is initialized once. This
  // uses another document, so rerenders cannot be mistaken for a new session.
  let initialized = 0;
  const fresh = await journey.page({ url: `${base}/circle?event=sample&lang=en`, routes: async p => {
    await p.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({ json: { email: "new-locale@example.test", isAdmin: false, isMapContributor: false } });
      if (path === "/api/claims") return route.fulfill({ json: { claims: [], eventId: "sample" } });
      if (path === "/api/account/notification-preferences") {
        if (route.request().method() === "PUT") {
          initialized++;
          assert.deepEqual(route.request().postDataJSON(), { version: 0, locale: "en" });
          return route.fulfill({ json: { cadence: "daily", version: 1, locale: "en" } });
        }
        return route.fulfill({ json: { cadence: "daily", version: 0, locale: null } });
      }
      return route.fulfill({ json: {} });
    });
  } });
  await fresh.getByRole("button", { name: "Account", exact: true }).waitFor();
  await fresh.locator("#portal-search").fill("unclaimed name");
  await fresh.getByRole("button", { name: "Account", exact: true }).click();
  assert.equal(initialized, 1);
  await journey.capture(fresh, "account-notification-locale-initialized-en");
  await fresh.close();
}
