import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const github = await environment.runner.import("/app/github-publication.ts");
const publication = await environment.runner.import("/app/publication-bundle-assembler.ts");
const failures = await environment.runner.import("/app/organizer-publication.ts");
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

test("GitHub adapter invalidates and retries one 401 with a provider token", async () => {
  let token = "old-token";
  const invalidated = [];
  const calls = [];
  const adapter = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin",
    tokenProvider: {
      getToken: async () => token,
      invalidate: (rejected) => { invalidated.push(rejected); token = "new-token"; },
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), authorization: init.headers.authorization });
      return calls.length === 1
        ? new Response("rejected", { status: 401 })
        : new Response(JSON.stringify({ full_name: "dekkmarsvin/tw_doujin_event-data" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await adapter.readRepositoryMetadata("tw_doujin_event-data"), { full_name: "dekkmarsvin/tw_doujin_event-data" });
  assert.deepEqual(invalidated, ["old-token"]);
  assert.deepEqual(calls.map(({ authorization }) => authorization), ["Bearer old-token", "Bearer new-token"]);
});

test("a repeated 401 stops after one retry and a 403 never refreshes", async () => {
  let invalidations = 0;
  let calls = 0;
  const adapter = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", tokenProvider: {
      getToken: async () => "token",
      invalidate: () => { invalidations += 1; },
    },
    fetch: async () => { calls += 1; return new Response("secret response sentinel", { status: calls === 1 ? 401 : 401 }); },
  });
  await assert.rejects(adapter.readRepositoryMetadata("tw_doujin_event-data"), (error) => {
    assert.equal(error instanceof failures.PublicationFailure, true);
    assert.equal(error.code, "github_api_response");
    assert.doesNotMatch(error.message, /secret response sentinel/u);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(invalidations, 1);

  calls = 0;
  invalidations = 0;
  const forbidden = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", tokenProvider: {
      getToken: async () => "token",
      invalidate: () => { invalidations += 1; },
    },
    fetch: async () => { calls += 1; return new Response("forbidden sentinel", { status: 403 }); },
  });
  await assert.rejects(forbidden.readRepositoryMetadata("tw_doujin_event-data"), (error) => {
    assert.equal(error.code, "github_api_response");
    assert.doesNotMatch(error.message, /forbidden sentinel/u);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(invalidations, 0);
});

test("adapter fetch and JSON exceptions become fixed safe PublicationFailures", async () => {
  const sentinel = "AUTHORIZATION_SECRET_SENTINEL";
  const providerFailure = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin",
    tokenProvider: {
      getToken: async () => { throw new failures.PublicationFailure("secret_code", sentinel, false); },
      invalidate: () => {},
    },
    fetch: async () => new Response("unexpected", { status: 200 }),
  });
  await assert.rejects(providerFailure.readRepositoryMetadata("tw_doujin_event-data"), (error) => {
    assert.equal(error instanceof failures.PublicationFailure, true);
    assert.equal(error.code, "github_app_request");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /AUTHORIZATION_SECRET_SENTINEL/u);
    return true;
  });

  const fetchFailure = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", installationToken: "token", fetch: async () => { throw new Error(sentinel); },
  });
  await assert.rejects(fetchFailure.readRepositoryMetadata("tw_doujin_event-data"), (error) => {
    assert.equal(error instanceof failures.PublicationFailure, true);
    assert.equal(error.code, "github_api_request");
    assert.doesNotMatch(error.message, /AUTHORIZATION_SECRET_SENTINEL/u);
    return true;
  });

  const jsonFailure = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", installationToken: "token", fetch: async () => new Response(sentinel, { status: 200 }),
  });
  await assert.rejects(jsonFailure.readRepositoryMetadata("tw_doujin_event-data"), (error) => {
    assert.equal(error.code, "github_api_response");
    assert.doesNotMatch(error.message, /AUTHORIZATION_SECRET_SENTINEL/u);
    return true;
  });
});
