import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR unavailable");
const { createGitHubPublicationDeployment, PUBLICATION_WORKFLOW_ID } = await environment.runner.import("/app/github-publication-deployment.ts");
const { verifyPublicationOrigin, PAGES_PRODUCTION_ORIGIN } = await environment.runner.import("/app/publication-origin.ts");
after(() => vite.close());
const sha = "d".repeat(40);
const dataSha = "b".repeat(40);
const digest = (text) => createHash("sha256").update(text).digest("hex");
function originFixture() {
  const files = new Map();
  for (const id of ["ff47", "ch-20"]) {
    for (const name of ["event", "circles", "reference-records", "map"]) {
      files.set(`/data/events/${id}/${name}.json`, JSON.stringify({ eventId: id, name }));
    }
  }
  const manifest = { schema: "publication-deployment/1", commit: sha,
    events: [{ eventId: "ff47", dataCommit: "e".repeat(40) }, { eventId: "ch-20", dataCommit: dataSha }],
    files: [...files].map(([path, text]) => ({ path, sha256: digest(text) })) };
  const seen = [];
  const fetch = async (url, init) => {
    assert.equal(new URL(url).origin, PAGES_PRODUCTION_ORIGIN);
    assert.equal(init.redirect, "manual"); assert.equal(init.cache, "no-store");
    assert.equal(init.headers, undefined, "no credentials sent to public origin");
    const path = new URL(url).pathname;
    seen.push(path);
    if (path === "/deployment-manifest.json") return Response.json(manifest);
    if (files.has(path)) return new Response(files.get(path));
    if (path === "/") return new Response("Reader", { headers: { "content-type": "text/html" } });
    if (path === "/api/auth/session") return new Response("anonymous", { status: 401 });
    assert.fail(`Unexpected path ${path}`);
  };
  return { manifest, files, fetch, seen };
}
const originInput = { mainSha: sha, dataSha, eventId: "ch-20", eventIds: ["ff47", "ch-20"] };

test("production proof checks the exact commit, new pin and bytes of both existing and new events", async () => {
  const fixture = originFixture();
  const result = await verifyPublicationOrigin({ ...originInput, fetch: fixture.fetch });
  assert.equal(result.manifestSha256, digest(JSON.stringify(fixture.manifest)));
  assert.ok(fixture.seen.includes("/data/events/ff47/map.json"));
  assert.ok(fixture.seen.includes("/data/events/ch-20/map.json"));
  assert.equal(fixture.seen.filter((path) => path === "/deployment-manifest.json").length, 2);
});

test("old deployment, missing event/map, wrong pin, changed old data and redirects never certify published", async () => {
  for (const mutate of [
    (f) => { f.manifest.commit = "e".repeat(40); },
    (f) => { f.manifest.events.pop(); },
    (f) => { f.manifest.events[1].dataCommit = "c".repeat(40); },
    (f) => { f.files.set("/data/events/ff47/map.json", "changed"); },
    (f) => { f.manifest.files = f.manifest.files.filter((file) => file.path !== "/data/events/ch-20/map.json"); },
    (f) => { f.manifest.files[0].path = "/api/admin/secret.json"; },
    (f) => { f.fetch = async () => new Response(null, { status: 302 }); },
    (f) => { const original = f.fetch; f.fetch = async (url, init) => {
      if (f.seen.filter((path) => path === "/deployment-manifest.json").length === 1 && new URL(url).pathname === "/deployment-manifest.json") f.manifest.commit = "e".repeat(40);
      return original(url, init);
    }; },
  ]) {
    const fixture = originFixture(); mutate(fixture);
    await assert.rejects(verifyPublicationOrigin({ ...originInput, fetch: fixture.fetch }), (error) => error.code === "production_smoke_failed" && error.retryable);
  }
});

function fixture() {
  const origin = originFixture();
  const state = { run: { id: 55, workflow_id: PUBLICATION_WORKFLOW_ID, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/deploy-pages.yml",
    run_attempt: 1, status: "completed", conclusion: "success", repository: { full_name: "dekkmarsvin/tw_doujin_event" } },
  jobs: [{ id: 60, run_id: 55, run_attempt: 1, head_sha: sha, name: "Verify and deploy", status: "completed", conclusion: "success",
    steps: ["Deploy to Cloudflare Pages", "Smoke test production deployment"].map((name) => ({ name, status: "completed", conclusion: "success" })) }],
  writes: 0, leaseChecks: 0, intents: 0, latestMain: sha, lostResponse: false, noRun: false, ancestors: [] };
  const input = { job: { id: "job", main_merge_sha: sha, data_merge_sha: dataSha, workflow_run_id: 55, workflow_run_attempt: 1, workflow_retry_attempt: null },
    snapshot: { eventId: "ch-20" }, step: "verifying_production", assertLease: async () => { state.leaseChecks += 1; },
    beginRemoteWrite: async () => { state.intents += 1; } };
  const driver = createGitHubPublicationDeployment({ installationToken: "test-token", originFetch: origin.fetch,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/rerun")) {
        assert.equal(init.method, "POST");
        assert.ok(state.leaseChecks > 0 && state.intents > 0);
        state.writes += 1;
        state.run = { ...state.run, run_attempt: 2, status: "in_progress", conclusion: null };
        state.jobs[0].run_attempt = 2;
        if (state.lostResponse) throw new Error("response lost");
        return new Response(null, { status: 201 });
      }
      if (path.endsWith("/runs")) return Response.json({ total_count: state.noRun ? 0 : 1, workflow_runs: state.noRun ? [] : [state.run] });
      if (path.endsWith("/runs/55")) return Response.json(state.run);
      if (/\/attempts\/\d+\/jobs$/.test(path)) return Response.json({ total_count: state.jobs.length, jobs: state.jobs });
      if (path.endsWith("/git/ref/heads/main")) return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: state.latestMain } });
      if (path.includes("/compare/")) {
        const [base, head] = path.split("/compare/")[1].split("...");
        const ahead = (base === sha && head === state.latestMain) || state.ancestors.some(([a, b]) => a === base && b === head);
        return Response.json({ status: ahead ? "ahead" : "behind", base_commit: { sha: base }, merge_base_commit: { sha: ahead ? base : head } });
      }
      if (path.endsWith(`/git/commits/${sha}`)) return Response.json({ sha, tree: { sha: "a".repeat(40) }, parents: [{ sha: "e".repeat(40) }], message: "main" });
      if (path.endsWith(`/git/trees/${"a".repeat(40)}`)) return Response.json({ sha: "a".repeat(40), truncated: false, tree: [{ path: "data/published-events.json", sha: "f".repeat(40), mode: "100644", type: "blob" }] });
      if (path.endsWith(`/git/blobs/${"f".repeat(40)}`)) return Response.json({ sha: "f".repeat(40), encoding: "base64", content: Buffer.from(JSON.stringify({ schema: "published-events/1", events: ["ff47", "ch-20"] })).toString("base64") });
      assert.fail(`Unexpected API ${path}`);
    } });
  return { state, input, driver, origin };
}

test("first observation pins the failed deployment before reporting failure", async () => {
  const { state, input, driver } = fixture();
  input.step = "waiting_deployment";
  input.job.workflow_run_id = null; input.job.workflow_run_attempt = null;
  state.noRun = true;
  assert.deepEqual(await driver.run(input), { pending: true });
  state.noRun = false;
  state.run.conclusion = "cancelled"; state.jobs[0].conclusion = "cancelled";
  const result = await driver.run(input);
  assert.deepEqual(result, { pending: true, metadata: { workflow_run_id: 55, workflow_run_attempt: 1 } });
  Object.assign(input.job, result.metadata);
  await assert.rejects(driver.run(input), (error) => error.code === "publication_deployment_failed" && error.retryable);
  assert.equal(state.writes, 0, "failure alone never requests a rerun");
});

test("same run and attempt require deployment plus blocking smoke; advisory custom domain is ignored", async () => {
  const { state, input, driver, origin } = fixture();
  state.run.conclusion = "failure"; // A failed advisory job must not replace the blocking job result.
  state.jobs.push({ ...state.jobs[0], id: 61, name: "Observe public production custom domain", conclusion: "failure", steps: [] });
  const result = await driver.run(input);
  assert.equal(result.productionVerified, true);
  assert.equal(result.metadata.production_manifest_sha256, digest(JSON.stringify(origin.manifest)));
  state.jobs[0].steps[1].conclusion = "skipped";
  await assert.rejects(driver.run(input), (error) => error.code === "publication_deployment_failed");
});

test("deployment metadata from another SHA, event, workflow, repository or attempt is refused", async () => {
  for (const mutate of [
    (s) => { s.run.head_sha = "a".repeat(40); }, (s) => { s.run.head_branch = "other"; },
    (s) => { s.run.event = "workflow_dispatch"; }, (s) => { s.run.workflow_id += 1; },
    (s) => { s.run.repository.full_name = "someone/other"; }, (s) => { s.run.run_attempt = 2; },
    (s) => { s.jobs[0].run_attempt = 2; }, (s) => { s.jobs[0].head_sha = "a".repeat(40); },
  ]) {
    const { state, input, driver } = fixture(); mutate(state);
    await assert.rejects(driver.run(input), (error) => error.code === "publication_deployment_identity");
    assert.equal(state.writes, 0);
  }
});

test("an authorized retry accepts empty 201, reconciles a lost response and pins only the next attempt", async () => {
  for (const lost of [false, true]) {
    const { state, input, driver } = fixture();
    input.job.workflow_retry_attempt = 2;
    state.jobs[0].conclusion = "failure"; state.run.conclusion = "failure";
    state.lostResponse = lost;
    if (lost) await assert.rejects(driver.run(input), (error) => error.code === "github_api_request");
    else assert.deepEqual(await driver.run(input), { pending: true });
    assert.deepEqual(await driver.run(input), { pending: true, metadata: { workflow_run_attempt: 2 } });
    input.job.workflow_run_attempt = 2;
    state.jobs[0].status = "in_progress";
    assert.deepEqual(await driver.run(input), { pending: true });
    state.jobs[0].status = "completed"; state.jobs[0].conclusion = "success";
    assert.equal((await driver.run(input)).productionVerified, true);
    assert.equal(state.writes, 1);
  }
});

test("retry cannot redeploy a superseded main commit or continue after losing its lease", async () => {
  const { state, input, driver } = fixture();
  input.job.workflow_retry_attempt = 2; state.latestMain = "a".repeat(40);
  await assert.rejects(driver.run(input), (error) => error.code === "publication_deployment_superseded" && !error.retryable);
  assert.equal(state.writes, 0);
  state.latestMain = sha;
  input.assertLease = async () => { throw new Error("lost lease"); };
  await assert.rejects(driver.run(input), /lost lease/);
  assert.equal(state.writes, 0);
});

test("queued deployment keeps its checkpoint; a superseded failure never offers a futile rerun", async () => {
  const { state, input, driver } = fixture();
  const checkpoint = structuredClone(input.job);
  state.run.status = "queued"; state.run.conclusion = null; state.jobs = [];
  assert.deepEqual(await driver.run(input), { pending: true });
  assert.deepEqual(input.job, checkpoint);
  const cancelled = fixture();
  cancelled.state.jobs[0].conclusion = "cancelled";
  cancelled.state.latestMain = "a".repeat(40);
  await assert.rejects(cancelled.driver.run(cancelled.input), error => error.code === "publication_deployment_superseded" && !error.retryable);
  assert.equal(cancelled.state.writes, 0);
});

test("only a confirmed newer main at production is superseded; an older origin stays retryable", async () => {
  for (const confirmed of [false, true]) {
    const { state, input, driver, origin } = fixture();
    state.latestMain = "a".repeat(40);
    origin.manifest.commit = confirmed ? state.latestMain : "e".repeat(40);
    const checkpoint = structuredClone(input.job);
    await assert.rejects(driver.run(input), error => confirmed
      ? error.code === "publication_deployment_superseded" && !error.retryable
      : error.code === "production_smoke_failed" && error.retryable);
    assert.deepEqual(input.job, checkpoint);
    assert.equal(state.writes, 0);
  }
});

test("a newer deployed ancestor remains superseded after a docs-only main advance", async () => {
  const { state, input, driver, origin } = fixture();
  const deployed = "c".repeat(40);
  state.latestMain = "a".repeat(40);
  origin.manifest.commit = deployed;
  state.ancestors = [[sha, deployed], [deployed, state.latestMain]];
  await assert.rejects(driver.run(input), error => error.code === "publication_deployment_superseded" && !error.retryable);
  assert.equal(state.writes, 0);
  state.ancestors = [[sha, deployed]]; // A different branch's artifact is not proof.
  await assert.rejects(driver.run(input), error => error.code === "production_smoke_failed" && error.retryable);
});
