import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"));
const jobs = workflow.jobs;
const repository = "dekkmarsvin/tw_doujin_event";
const preview = { event_name: "pull_request", ref_name: "42/merge", repository,
  event: { pull_request: { head: { repo: { full_name: repository } } } } };
const main = { event_name: "push", ref_name: "main", repository, event: {} };
const dispatch = { ...main, event_name: "workflow_dispatch", ref_name: "ci-preview" };

// Evaluate the expressions used by this workflow against job outcomes. Unknown
// syntax fails the test instead of silently treating a condition as true.
function expression(value, github, needs, success = true) {
  const source = value.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replaceAll("needs.verify-preview", 'needs["verify-preview"]');
  return Function("github", "needs", "always", "success", `return (${source});`)(github, needs, () => true, () => success);
}
function context(profile, deploy = "success", verify = "success", scope = "success") {
  return { scope: { result: scope, outputs: { profile } }, deploy: { result: deploy }, "verify-preview": { result: verify } };
}
function applicable(id, github, needs) {
  const job = jobs[id];
  const dependencies = [job.needs].flat().filter(Boolean);
  const success = dependencies.every(name => needs[name].result === "success");
  return (job.if?.includes("always()") || success) && (!job.if || expression(job.if, github, needs, success));
}
function codeSteps(id, github, needs) {
  return jobs[id].steps.filter(step => ["npm test", "npm run lint", "npx tsc --noEmit --incremental false", "node scripts/worker-delivery.mjs --build-only"].includes(step.run))
    .filter(step => !step.if || expression(step.if, github, needs)).map(step => step.run);
}
const commands = ["npm test", "npm run lint", "npx tsc --noEmit --incremental false", "node scripts/worker-delivery.mjs --build-only"];

test("preview deploy and E2E do not wait for code checks; main retains checks before deployment", () => {
  for (const github of [preview, dispatch]) {
    const needs = context("full", "success", "in_progress");
    assert.equal(applicable("deploy", github, needs), true);
    assert.equal(applicable("verify-preview", github, needs), true);
    assert.deepEqual(codeSteps("deploy", github, needs), []);
    assert.deepEqual(codeSteps("verify-preview", github, needs), commands);
  }
  assert.deepEqual([jobs.deploy.needs].flat(), ["scope"]);
  assert.deepEqual(jobs["preview-e2e"].needs, ["scope", "deploy"]);
  assert.equal(applicable("preview-e2e", preview, context("full", "success", "failure")), true);
  for (const github of [main, { ...main, event_name: "workflow_dispatch" }]) {
    assert.equal(applicable("verify-preview", github, context("full")), false);
    assert.equal(applicable("preview-verification", github, context("full")), false);
    assert.deepEqual(codeSteps("deploy", github, context("full")), commands);
    const steps = jobs.deploy.steps;
    assert.ok(steps.findIndex(step => step.run === commands.at(-1)) < steps.findIndex(step => step.name === "Deploy to Cloudflare Pages"));
    assert.ok(steps.some(step => step.name === "Smoke test production deployment" && expression(step.if, github, context("full"))));
  }
});

test("required preview gate rejects failed, cancelled and skipped work even after successful deployment", () => {
  const gate = jobs["preview-verification"];
  assert.deepEqual(gate.needs, ["scope", "deploy", "verify-preview"]);
  const reject = gate.steps.find(step => step.run === "exit 1");
  assert.ok(reject);
  for (const github of [preview, dispatch]) {
    for (const deploy of ["success", "failure", "cancelled", "skipped"]) {
      for (const verify of ["success", "failure", "cancelled", "skipped"]) {
        const needs = context("full", deploy, verify);
        assert.equal(applicable("preview-verification", github, needs), true);
        assert.equal(expression(reject.if, github, needs), deploy !== "success" || verify !== "success");
      }
    }
  }
  const data = context("publication-data", "success", "skipped");
  assert.equal(applicable("verify-preview", preview, data), false);
  assert.equal(applicable("preview-verification", preview, data), true);
  assert.equal(expression(reject.if, preview, data), false);
  assert.equal(expression(reject.if, preview, context("publication-data", "failure", "skipped")), true);
  assert.deepEqual(codeSteps("deploy", main, data), []);
});

test("non-product and fork runs cannot deploy; production checkpoint identity stays unique including skipped jobs", () => {
  for (const profile of ["docs", "tooling"]) {
    for (const github of [main, preview]) {
      for (const id of ["deploy", "verify-preview", "preview-verification"]) assert.equal(Boolean(applicable(id, github, context(profile))), false);
    }
  }
  const fork = { ...preview, event: { pull_request: { head: { repo: { full_name: "external/fork" } } } } };
  for (const id of ["deploy", "verify-preview", "preview-verification"]) assert.equal(Boolean(applicable(id, fork, context("full"))), false);
  assert.equal(applicable("deploy", preview, context("full", "skipped", "skipped", "failure")), false);
  for (const github of [main, preview, dispatch]) {
    const names = Object.entries(jobs).map(([id, job]) => [id, job.name.startsWith("${{") ? expression(job.name, github, context("full")) : job.name]);
    assert.deepEqual(names.filter(([, name]) => name === "Verify and deploy").map(([id]) => id), [github === main ? "deploy" : "preview-verification"]);
  }
});
