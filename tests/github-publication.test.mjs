import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const github = await environment.runner.import("/app/github-publication.ts");
const publication = await environment.runner.import("/app/publication-bundle-assembler.ts");
const failures = await environment.runner.import("/app/organizer-publication.ts");
const { readPublishedEventAtOrigin, PAGES_PRODUCTION_ORIGIN } = await environment.runner.import("/app/publication-runtime.ts");
after(() => vite.close());

test("cron published-event lookup uses a fixed anonymous origin and fails closed except on 404", async () => {
  let seen;
  const existing = await readPublishedEventAtOrigin("ff47", async (url, init) => {
    seen = { url, init }; return Response.json({ id: "ff47" });
  });
  assert.equal(existing.id, "ff47");
  assert.equal(seen.url, `${PAGES_PRODUCTION_ORIGIN}/data/events/ff47/event.json`);
  assert.equal(seen.init.redirect, "manual");
  assert.equal(seen.init.headers, undefined);
  assert.equal(await readPublishedEventAtOrigin("missing", async () => new Response("Not found", { status: 404 })), null);
  for (const response of [new Response(null, { status: 302, headers: { location: "https://other.example/" } }), new Response("bad", { status: 500 }), new Response("html"), Response.json({ id: "different" })]) {
    await assert.rejects(readPublishedEventAtOrigin("ch-20", async () => response), (error) => error.code === "published_collection_unavailable" && error.retryable);
  }
  await assert.rejects(readPublishedEventAtOrigin("../ff47", async () => assert.fail("must not fetch")), (error) => error.code === "publication_identity");
});

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

// ADR-0066 decision 3: "some App opened it" was never the guarantee. The PR
// author has to be the identity that produced the approval on the same head.
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function mergeAdapter({ author, approvalApp, checks = [] }) {
  const seen = [];
  const adapter = github.createGitHubPublicationAdapter({
    owner: "dekkmarsvin", installationToken: "token", fetch: async (url, init) => {
      const target = String(url);
      seen.push([target, init?.method ?? "GET"]);
      const body = target.includes("/check-runs")
        ? { check_runs: [
            { id: 2, name: "Organizer publication approval", status: "completed", conclusion: "success", head_sha: HEAD, ...(approvalApp === undefined ? {} : { app: approvalApp }) },
            ...checks,
          ] }
        : target.includes("/merge")
          ? { merged: true, sha: "merged-sha" }
          : { number: 12, state: "open", base: { ref: "main" }, head: { ref: "organizer/job-1/data", sha: HEAD }, user: { login: author } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const merge = () => adapter.mergeOwnedPullRequest({
    repository: "tw_doujin_event-data", pullNumber: 12, jobId: "job-1", stage: "data",
    expectedHeadSha: HEAD, requiredChecks: ["data / check"],
  });
  return { merge, seen };
}

test("a publication PR must be opened by the App that approved it", async () => {
  const approvalApp = { id: 4931208, slug: "tw-doujin-map-pilot" };
  const passing = [{ id: 3, name: "data / check", status: "completed", conclusion: "success", head_sha: HEAD }];

  // Another App on the same repository could open a branch-shaped PR; the old
  // check accepted it because the login merely ended in "[bot]".
  const impostor = mergeAdapter({ author: "someone-else[bot]", approvalApp, checks: passing });
  await assert.rejects(impostor.merge, /not opened by the App that approved it/);
  assert.equal(impostor.seen.some(([, method]) => method === "PUT"), false, "an unmatched author never reaches the merge");

  // An approval with no App identity fails closed rather than falling back to
  // the old suffix test.
  const anonymous = mergeAdapter({ author: "tw-doujin-map-pilot[bot]", approvalApp: null, checks: passing });
  await assert.rejects(anonymous.merge, /no App identity/);

  // The matching author proceeds, and the required checks still decide.
  const matched = mergeAdapter({ author: "tw-doujin-map-pilot[bot]", approvalApp, checks: passing });
  assert.equal((await matched.merge()).merged, true);

  const failing = mergeAdapter({ author: "tw-doujin-map-pilot[bot]", approvalApp,
    checks: [{ id: 3, name: "data / check", status: "completed", conclusion: "failure", head_sha: HEAD }] });
  await assert.rejects(failing.merge, /Required check is not successful/);
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
