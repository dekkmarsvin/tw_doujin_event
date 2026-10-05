import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const errors = await environment.runner.import("/app/i18n/api-error.ts");
const contract = await environment.runner.import("/app/i18n/api-contract.ts");
const registry = await environment.runner.import("/app/i18n/api-error-codes.ts");
const fixtures = JSON.parse(await readFile("tests/fixtures/i18n/api-errors.json", "utf8"));
after(() => vite.close());

test("representative and legacy bodies produce messages in all locales without mutating extras", () => {
  for (const fixture of fixtures) {
    const before = structuredClone(fixture.body);
    const failure = errors.readApiFailure(fixture.status, fixture.body);
    for (const chosen of ["zh-Hant", "en", "ja"]) {
      const message = errors.failureMessage(failure, chosen);
      assert.ok(message.length > 0, `${fixture.name}: ${chosen}`);
      if (chosen !== "zh-Hant" && failure.serverMessage) assert.notEqual(message, failure.serverMessage);
    }
    assert.deepEqual(fixture.body, before);
  }
  assert.equal(fixtures.find(f => f.name === "version-conflict").body.currentVersion, 3);
  assert.equal(fixtures.find(f => f.name === "share-expired").body.eventId, "sample");
});

test("code translations precede server text; unknown codes retain Chinese only for zh-Hant", () => {
  const failure = errors.readApiFailure(409, { code: "new_code", error: "舊伺服器錯誤。", params: { count: 2 } });
  const catalog = { "zh-Hant": { new_code: "數量 {count}" }, en: { new_code: "Count {count}" }, ja: {} };
  assert.equal(errors.failureMessage(failure, "en", catalog), "Count 2");
  assert.equal(errors.failureMessage(failure, "ja", catalog), "數量 2");
  assert.equal(errors.failureMessage(failure, "zh-Hant"), "舊伺服器錯誤。");
  assert.notEqual(errors.failureMessage(failure, "en"), "舊伺服器錯誤。");
  assert.ok(errors.failureMessage(errors.readApiFailure(400, { code: "toString" }), "en", catalog));
});

test("malformed envelopes drop invalid parameters and safely classify failures", () => {
  for (const body of [null, 1, [], "<html>", {}]) assert.deepEqual(errors.readApiFailure(413, body), { kind: "http", status: 413, code: null, params: {}, serverMessage: null });
  const failure = errors.readApiFailure(400, { code: 1, error: false, params: { count: 0, name: "A", flag: true, nested: {}, nil: null, values: [], infinite: Infinity } });
  assert.deepEqual(failure.params, { count: 0, name: "A" });
  assert.equal(failure.code, null);
  assert.equal(failure.serverMessage, null);
  assert.deepEqual(errors.readApiFailure(400, { params: ["bad"] }).params, {});
  for (const [status, kind] of [[401, "unauthenticated"], [403, "forbidden"], [404, "not-found"], [410, "gone"], [409, "conflict"], [413, "too-large"], [429, "rate-limited"], [500, "unavailable"], [503, "unavailable"], [400, "unknown"]]) assert.equal(errors.genericFailure(errors.readApiFailure(status, null)), kind);
  assert.equal(errors.genericFailure(errors.networkFailure()), "network");
  assert.equal(errors.genericFailure(errors.invalidResponseFailure(503)), "invalid-response");
  for (const chosen of ["zh-Hant", "en", "ja"]) for (const failure of [errors.networkFailure(), errors.invalidResponseFailure(200)]) assert.ok(errors.failureMessage(failure, chosen));
});

test("the frozen registry has unique condition names, failure statuses and endpoints", () => {
  const names = Object.keys(registry.API_ERROR_CODES);
  assert.equal(new Set(names).size, names.length);
  for (const [code, entry] of Object.entries(registry.API_ERROR_CODES)) {
    assert.match(code, /^[a-z][a-z0-9_]*$/);
    assert.ok(entry.status >= 400 && entry.status < 600, code);
    assert.ok(entry.endpoints.length, code);
  }
  for (const fixture of fixtures) if (fixture.body?.code) assert.equal(registry.API_ERROR_CODES[fixture.body.code].status, fixture.status);
});

test("request-link accepts only exact canonical explicit locales", () => {
  assert.deepEqual(contract.parseRequestLinkLocale(undefined), { ok: true, locale: "zh-Hant" });
  for (const chosen of ["zh-Hant", "en", "ja"]) assert.deepEqual(contract.parseRequestLinkLocale(chosen), { ok: true, locale: chosen });
  for (const chosen of [null, "EN", "en-US", "zh-hant", "", false, {}]) assert.deepEqual(contract.parseRequestLinkLocale(chosen), { ok: false });
});

test("preference writes preserve omitted cadence and validate explicit fields and versions", () => {
  for (const name of ["preferences-put-locale-only", "preferences-put-cadence-only"]) {
    const body = fixtures.find(f => f.name === name).body;
    assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate(body), { ok: true, value: body });
  }
  assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate({ version: 1, cadence: "daily", locale: "en" }), { ok: true, value: { version: 1, cadence: "daily", locale: "en" } });
  assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate({ version: 0, cadence: "off", locale: null }), { ok: true, value: { version: 0, cadence: "off" } });
  assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate({ version: 0, locale: null }), { ok: false, code: "invalid_notification_preferences" });
  for (const body of [null, [], {}, { version: 0 }, { version: -1, locale: "en" }, { version: 0.5, locale: "en" }, { version: "0", locale: "en" }, { version: 0, cadence: "weekly" }, { version: 0, cadence: undefined, locale: "en" }, { version: 0, cadence: "off", extra: true }]) assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate(body), { ok: false, code: "invalid_notification_preferences" });
  for (const chosen of [undefined, "EN", "en-US", "zh-hant", "", false, {}]) assert.deepEqual(contract.parseAccountNotificationPreferencesUpdate({ version: 0, locale: chosen }), { ok: false, code: "invalid_locale" });
});
