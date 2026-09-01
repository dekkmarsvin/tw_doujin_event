import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localPortalWranglerArgs, readLocalPortalEnvironment } from "../scripts/local-portal-environment.mjs";

function parseEnv(source) {
  return Object.fromEntries(source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      assert.ok(separator > 0, `invalid local portal env line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

test("one command runs the real portal auth boundary with isolated local-only resources", async () => {
  const [packageSource, envSource, runbook] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../config/local-portal.env", import.meta.url), "utf8"),
    readFile(new URL("../docs/runbooks/local-development.md", import.meta.url), "utf8"),
  ]);
  const scripts = JSON.parse(packageSource).scripts;
  const env = parseEnv(envSource);
  assert.deepEqual(await readLocalPortalEnvironment(), env);
  const wranglerArgs = localPortalWranglerArgs(env);

  assert.match(scripts["dev:portal"], /scripts\/run-local-portal\.mjs/);
  assert.doesNotMatch(scripts["dev:portal"], /--remote|pages deploy/);
  assert.match(scripts["smoke:portal"], /scripts\/smoke-local-portal\.mjs/);
  assert.deepEqual(wranglerArgs.slice(0, 3), ["pages", "dev", "dist"]);

  assert.equal(env.EVENT_ID, "sample");
  assert.equal(env.ADMIN_EMAILS, "local-admin@example.test");
  assert.equal(env.PREVIEW_MAIL_SINK, "d1");
  assert.equal(env.PREVIEW_TEST_RECIPIENTS, "local-admin@example.test");
  assert.equal(env.TURNSTILE_SITEKEY, "1x00000000000000000000AA");
  assert.equal(env.TURNSTILE_SECRET, "1x0000000000000000000000000000000AA");
  assert.equal(env.THUMBNAIL_PUBLIC_ORIGIN, "http://127.0.0.1:8788/__local-thumbnail");
  assert.match(env.SESSION_SECRET, /^local-test-/);
  assert.match(env.HASH_PEPPER, /^local-test-/);
  assert.notEqual(env.SESSION_SECRET, env.HASH_PEPPER);
  assert.ok(env.PREVIEW_E2E_TOKEN);
  assert.equal(env.MAILGUN_API_KEY, undefined);
  assert.equal(env.MAILGUN_DOMAIN, undefined);
  for (const [name, value] of Object.entries(env)) {
    assert.ok(wranglerArgs.includes(`${name}=${value}`), `${name} must override wrangler.jsonc locally`);
  }
  assert.ok(!wranglerArgs.includes("--remote"));
  assert.deepEqual(wranglerArgs.slice(3, 9), ["--ip", "127.0.0.1", "--port", "8788", "--persist-to", ".wrangler/local-portal"]);

  assert.match(runbook, /npm run dev:portal/);
  assert.match(runbook, /npm run smoke:portal/);
  assert.match(runbook, /\.wrangler\/local-portal/);
  assert.match(runbook, /不會寄出真實 email/);
  assert.match(runbook, /不得用於 production/);
});
