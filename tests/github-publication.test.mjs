import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const github = await environment.runner.import("/app/github-publication.ts");
const publication = await environment.runner.import("/app/publication-bundle-assembler.ts");
after(() => vite.close());

test("webhook handler verifies exact bytes before delivery idempotency", async () => {
  const deliveries = new Set();
  let processed = 0;
  const handler = github.createGitHubWebhookHandler({
    secret: "secret", now: () => 123,
    recordDelivery: async ({ deliveryId }) => {
      if (deliveries.has(deliveryId)) return "duplicate";
      deliveries.add(deliveryId); return "recorded";
    },
    onDelivery: async () => { processed += 1; },
  });
  const body = JSON.stringify({ action: "completed" });
  const signature = await publication.signGitHubWebhookForTest("secret", body);
  const request = () => new Request("https://example.test/api/integrations/github/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature, "x-github-delivery": "delivery-1", "x-github-event": "check_run" }, body,
  });
  assert.equal((await handler(request())).status, 202);
  assert.equal((await handler(request())).status, 202);
  assert.equal(processed, 1);
  const bad = new Request("https://example.test/api/integrations/github/webhook", { method: "POST", headers: { "x-hub-signature-256": signature, "x-github-delivery": "delivery-2", "x-github-event": "check_run" }, body: `${body} ` });
  assert.equal((await handler(bad)).status, 401);
});

test("a failed webhook delivery remains retryable with the same delivery id", async () => {
  let stored = null;
  let attempts = 0;
  const completions = [];
  const handler = github.createGitHubWebhookHandler({
    secret: "secret", now: () => 123,
    recordDelivery: async ({ deliveryId, payloadSha256 }) => {
      if (!stored) { stored = { deliveryId, payloadSha256, processed: false }; return "recorded"; }
      if (stored.payloadSha256 !== payloadSha256) return "mismatch";
      return stored.processed ? "duplicate" : "recorded";
    },
    completeDelivery: async (result) => {
      completions.push(result);
      if (result.processed) stored.processed = true;
    },
    onDelivery: async () => { attempts += 1; if (attempts === 1) throw new Error("transient"); },
  });
  const body = JSON.stringify({ action: "completed" });
  const signature = await publication.signGitHubWebhookForTest("secret", body);
  const request = () => new Request("https://example.test/api/integrations/github/webhook", {
    method: "POST", headers: { "x-hub-signature-256": signature, "x-github-delivery": "retry-1", "x-github-event": "check_run" }, body,
  });
  assert.equal((await handler(request())).status, 500);
  assert.equal((await handler(request())).status, 202);
  assert.equal((await handler(request())).status, 202);
  assert.equal(attempts, 2);
  assert.deepEqual(completions.map(({ processed }) => processed), [false, true]);
});

test("GitHub adapter refuses a changed PR head before merge", async () => {
  const calls = [];
  const adapter = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", installationToken: "token", fetch: async (url, init) => {
      calls.push([String(url), init?.method ?? "GET"]);
      return new Response(JSON.stringify({ number: 12, state: "open", base: { ref: "main" }, head: { ref: "organizer/job-1/data", sha: "changed" }, user: { login: "organizer-app[bot]" } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(adapter.mergeOwnedPullRequest({
    repository: "tw_doujin_event-data", pullNumber: 12, jobId: "job-1", stage: "data",
    expectedHeadSha: "expected", requiredChecks: ["data / check"],
  }), /head SHA changed/);
  assert.deepEqual(calls.map(([, method]) => method), ["GET"]);
});
