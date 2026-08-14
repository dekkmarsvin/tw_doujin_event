import assert from "node:assert/strict";
import test, { after } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { previewE2eAuthorized, previewRecipientAllowed, repositoryFor } = await environment.runner.import("/functions/_portal.ts");
const { onRequestDelete, onRequestGet } = await environment.runner.import("/functions/api/preview/mail.ts");
const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "preview-mail-route-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const env = {
  PREVIEW_MAIL_SINK: "d1",
  PREVIEW_TEST_RECIPIENTS: "preview-admin@example.test, preview-circle@example.test",
  PREVIEW_E2E_TOKEN: "a-private-preview-token",
  ADMIN_EMAILS: "preview-admin@example.test",
  DB: database,
};

test("preview mail sink accepts only explicit test recipients", () => {
  assert.equal(previewRecipientAllowed(env, "PREVIEW-ADMIN@example.test"), true);
  assert.equal(previewRecipientAllowed(env, "preview-circle@example.test"), true);
  assert.equal(previewRecipientAllowed(env, "real-user@example.com"), false);
  assert.equal(previewRecipientAllowed({ ...env, PREVIEW_MAIL_SINK: undefined }, "preview-admin@example.test"), false);
});

test("mail retrieval requires the separate preview token and hides when disabled", () => {
  const request = (token) => new Request("https://preview.example/api/preview/mail", { headers: token ? { "x-preview-e2e-token": token } : {} });
  assert.equal(previewE2eAuthorized(env, request("a-private-preview-token")), true);
  assert.equal(previewE2eAuthorized(env, request("a-private-preview-tokee")), false);
  assert.equal(previewE2eAuthorized(env, request()), false);
  assert.equal(previewE2eAuthorized({ ...env, PREVIEW_MAIL_SINK: undefined }, request("a-private-preview-token")), false);
});

test("preview route reads and clears captured mail only with its dedicated token", async () => {
  const repository = repositoryFor(env);
  await repository.storePreviewMail({ email: "preview-circle@example.test", subject: "login", text: "one-time link", now: 1_786_500_000_000 });

  const authorized = new Request("https://preview.example/api/preview/mail?email=preview-circle%40example.test", {
    headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN },
  });
  const read = await onRequestGet({ request: authorized, env });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).message.text, "one-time link");

  const hidden = await onRequestGet({ request: new Request(authorized.url), env });
  assert.equal(hidden.status, 404);

  const cleared = await onRequestDelete({ request: new Request("https://preview.example/api/preview/mail", {
    method: "DELETE",
    headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN },
  }), env });
  assert.equal(cleared.status, 200);
  assert.equal(await repository.latestPreviewMail("preview-circle@example.test"), null);
  assert.equal(await repository.isAdminEmail("preview-admin@example.test"), true);
});
