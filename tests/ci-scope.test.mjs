import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyPaths, determineScope, determineWorkflowScope, findValidatedMainRun } from "../scripts/ci-scope.mjs";

test("only known non-product inputs take a short path", () => {
  assert.equal(classifyPaths(["AGENTS.md", "docs/agents/review-loop.md", "docs/runbooks/local-development.md", ".evidence/a/b.png"]).profile, "docs");
  assert.equal(classifyPaths([".claude/settings.json", ".claude/hooks/session-start.sh", ".gitignore", "README.md"]).profile, "tooling");
  for (const product of ["docs/policy/privacy-notice.md", "docs/new-build-input.md", "app/main.tsx", "functions/api/test.ts", "workers/worker.ts", "data/event-data-pins/ff47.json", "wrangler.jsonc", "package.json", "package-lock.json", "vite.pages.config.ts", ".github/workflows/deploy-pages.yml", "scripts/ci-scope.mjs", "tests/browser-runner.test.mjs", ".claude/hooks/new.sh", "unknown.md"]) {
    assert.equal(classifyPaths(["README.md", product]).profile, "full", product);
  }
  assert.equal(classifyPaths([]).profile, "full");
});

async function repository(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ci-scope-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init"]);
  git(["config", "user.name", "CI fixture"]);
  git(["config", "user.email", "ci@example.test"]);
  const put = async (file, content = file) => { await mkdir(path.dirname(path.join(cwd, file)), { recursive: true }); await writeFile(path.join(cwd, file), content); };
  const commit = () => { git(["add", "-A"]); git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]); return git(["rev-parse", "HEAD"]); };
  await put("README.md");
  return { cwd, git, put, commit, base: commit() };
}

test("push compares the entire range, including product edits before the final docs commit", async t => {
  const r = await repository(t);
  await r.put("app/product.ts"); r.commit();
  await r.put("README.md", "updated");
  const sha = r.commit();
  const scope = determineScope({ eventName: "push", event: { before: r.base }, sha, cwd: r.cwd });
  assert.equal(scope.profile, "full");
  assert.deepEqual(scope.paths, ["README.md", "app/product.ts"]);
});

test("PR classification sees deletions and both sides of renames", async t => {
  const r = await repository(t);
  await r.put("app/retired.ts");
  const base = r.commit();
  await mkdir(path.join(r.cwd, ".evidence"));
  r.git(["mv", "app/retired.ts", ".evidence/retired.md"]);
  const sha = r.commit();
  const scope = determineScope({ eventName: "pull_request", event: { pull_request: { base: { sha: base } } }, sha, cwd: r.cwd });
  assert.equal(scope.profile, "full");
  assert.deepEqual(scope.paths, [".evidence/retired.md", "app/retired.ts"]);
});

test("missing history falls back to full, while a mismatched checkout fails", async t => {
  const r = await repository(t);
  const args = { eventName: "push", event: { before: "f".repeat(40) }, sha: r.base, cwd: r.cwd };
  assert.equal(determineScope(args).profile, "full");
  assert.throws(() => determineScope({ ...args, sha: "a".repeat(40) }), /checkout/);
  assert.equal(determineScope({ ...args, event: { before: "0".repeat(40) } }).profile, "full");
  assert.equal(determineScope({ eventName: "workflow_dispatch", event: {} }).profile, "full");
});

test("a docs push carries unverified product work, but skips products already verified on main", async t => {
  const r = await repository(t);
  await r.put("app/product.ts");
  const product = r.commit();
  await r.put("README.md", "docs after product");
  const sha = r.commit();
  const args = { eventName: "push", event: { before: product, ref: "refs/heads/main" }, sha, cwd: r.cwd };
  assert.equal(determineScope(args).profile, "docs");
  // A slow/cancelled product run has not advanced the successful baseline.
  const pending = await determineWorkflowScope(args, { findBaseline: async () => ({ sha: r.base, runId: 1 }) });
  assert.equal(pending.profile, "full");
  assert.ok(pending.paths.includes("app/product.ts"));
  const delivered = await determineWorkflowScope(args, { findBaseline: async () => ({ sha: product, runId: 2 }) });
  assert.equal(delivered.profile, "docs");
  assert.deepEqual(delivered.paths, ["README.md"]);
  for (const findBaseline of [async () => null, async () => { throw new Error("API unavailable"); }, async () => ({ sha: "f".repeat(40), runId: 1 })]) {
    assert.equal((await determineWorkflowScope(args, { findBaseline })).profile, "full");
  }
});

test("PR, dispatch and product changes do not need a deployment lookup", async t => {
  const r = await repository(t);
  await r.put("README.md", "docs");
  const docs = r.commit();
  const noLookup = { findBaseline: () => { assert.fail("unnecessary baseline lookup"); } };
  const pr = await determineWorkflowScope({ eventName: "pull_request", event: { pull_request: { base: { sha: r.base } } }, sha: docs, cwd: r.cwd }, noLookup);
  assert.equal(pr.profile, "docs");
  assert.equal((await determineWorkflowScope({ eventName: "workflow_dispatch", event: {} }, noLookup)).profile, "full");
  await r.put("app/product.ts");
  assert.equal((await determineWorkflowScope({ eventName: "push", event: { before: docs }, sha: r.commit(), cwd: r.cwd }, noLookup)).profile, "full");
});

test("baseline lookup skips lightweight runs and requires an identifiable successful deploy", async () => {
  const run = { head_branch: "main", event: "push", path: ".github/workflows/deploy-pages.yml", status: "completed", conclusion: "success", id: 20, head_sha: "a".repeat(40) };
  const deploy = { name: "Verify and deploy", status: "completed", conclusion: "success" };
  const calls = [];
  const lookup = responses => findValidatedMainRun({ repository: "owner/repo", token: "fixture", fetchImpl: async url => {
    calls.push(url);
    const data = responses.shift();
    assert.ok(data, `unexpected call ${url}`);
    return { ok: true, json: async () => data };
  } });
  assert.deepEqual(await lookup([
    { workflow_runs: [{ ...run, id: 21 }, run] },
    { jobs: [{ ...deploy, conclusion: "skipped" }], total_count: 1 },
    { jobs: [deploy], total_count: 1 },
  ]), { sha: run.head_sha, runId: 20 });
  assert.match(calls[1], /runs\/21\/jobs/);
  assert.match(calls[2], /runs\/20\/jobs/);
  for (const jobs of [[], [deploy, deploy], [{ ...deploy, conclusion: "failure" }], [{ ...deploy, name: "Unexpected job" }]]) {
    await assert.rejects(lookup([{ workflow_runs: [run] }, { jobs, total_count: jobs.length }]));
  }
  await assert.rejects(lookup([{ workflow_runs: [run] }, { jobs: [deploy], total_count: 2 }]), /Incomplete/);
  await assert.rejects(lookup([{ workflow_runs: [{ ...run, path: "other.yml" }] }]), /identity/);
  assert.equal(await lookup([{ workflow_runs: [{ ...run, event: "workflow_dispatch" }, run] }]), null);
  assert.equal(await lookup([{ workflow_runs: [] }]), null);
  assert.equal(await findValidatedMainRun({ repository: "owner/repo" }), null);
  await assert.rejects(findValidatedMainRun({ repository: "owner/repo", token: "fixture", fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});

test("the real CLI reports docs applicability and fails on malformed event input", async t => {
  const r = await repository(t);
  await r.put("docs/runbooks/example with spaces.md");
  const sha = r.commit();
  const eventFile = path.join(r.cwd, "event.json");
  await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: r.base } } }));
  const script = new URL("../scripts/ci-scope.mjs", import.meta.url);
  const env = { ...process.env, GITHUB_EVENT_PATH: eventFile, GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: sha };
  delete env.GITHUB_OUTPUT; delete env.GITHUB_STEP_SUMMARY;
  const run = () => spawnSync(process.execPath, [fileURLToPath(script)], { cwd: r.cwd, env, encoding: "utf8" });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).profile, "docs");
  await writeFile(eventFile, JSON.stringify({ before: r.base, ref: "refs/heads/main" }));
  env.GITHUB_EVENT_NAME = "push";
  delete env.GITHUB_TOKEN;
  assert.equal(JSON.parse(run().stdout).profile, "full");
  await writeFile(eventFile, "broken JSON");
  assert.notEqual(run().status, 0);
});
