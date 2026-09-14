import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, environments: { ssr: {} }, logLevel: "silent" });
const { publicationProgress, publicationFailureMessage } = await vite.environments.ssr.runner.import("/app/organizer-publication-presentation.ts");
const { publicationRolloutProblems, PUBLICATION_REQUIRED_CHECKS } = await vite.environments.ssr.runner.import("/app/publication-rollout.ts");
after(() => vite.close());

test("failed deployment preserves completed data stages and never looks published", () => {
  assert.deepEqual(publicationProgress({ step: "waiting_deployment", status: "failed" }).map(({ state }) => state), ["complete", "complete", "failed", "pending"]);
  assert.deepEqual(publicationProgress({ step: "verifying_production", status: "publishing" }).map(({ state }) => state), ["complete", "complete", "complete", "current"]);
  assert.match(publicationFailureMessage({ failureCode: "event_id_collision", retryable: false }), /首次發布不能覆寫/);
  assert.match(publicationFailureMessage({ failureCode: "infrastructure_error", retryable: true, started: true }), /內容沒有被退件/);
});

test("a job that never started says so instead of reading as a failure part-way through", () => {
  assert.deepEqual(publicationProgress({ step: "assemble", status: "failed" }).map(({ state }) => state),
    ["failed", "pending", "pending", "pending"]);
  const neverStarted = { failureCode: "queued_timeout", retryable: true, started: false };
  assert.match(publicationFailureMessage(neverStarted), /發布沒有開始/);
  assert.notEqual(publicationFailureMessage(neverStarted),
    publicationFailureMessage({ failureCode: "infrastructure_error", retryable: true, started: false }));

  // The step cannot carry this. Approval creates the job on `preparing_data`
  // and the older path used `assemble`, so both names describe a job that
  // never ran; retry then keeps whichever step it failed on.
  for (const step of ["assemble", "preparing_data"]) {
    assert.deepEqual(publicationProgress({ step, status: "failed" }).map(({ state }) => state),
      ["failed", "pending", "pending", "pending"]);
  }

  // Retry keeps the step the job failed on, so the same timeout also lands on
  // jobs that did publish part-way. The stage list shows 準備活動資料 complete
  // for those, and telling the owner nothing started contradicts it.
  const stalledAfterRetry = { failureCode: "queued_timeout", retryable: true, started: true };
  assert.deepEqual(publicationProgress({ step: "preparing_main", status: "failed" }).map(({ state }) => state),
    ["complete", "failed", "pending", "pending"]);
  assert.doesNotMatch(publicationFailureMessage(stalledAfterRetry), /發布沒有開始/);
  assert.equal(publicationFailureMessage(stalledAfterRetry),
    publicationFailureMessage({ failureCode: "infrastructure_error", retryable: true, started: true }));
});

test("an active ruleset alone is not rollout approval", () => {
  const ruleset = { enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, bypass_actors: [],
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
  const problems = publicationRolloutProblems("main", [ruleset], 1);
  assert.equal(problems.length, 4);
  const valid = { ...ruleset, rules: [{ type: "pull_request" }, { type: "required_status_checks", parameters: {
    required_status_checks: PUBLICATION_REQUIRED_CHECKS.main.map((context) => ({ context })),
  } }] };
  assert.deepEqual(publicationRolloutProblems("main", [valid], 1), []);
  for (const ref_name of [{ include: ["~DEFAULT_BRANCH"] }, { exclude: [] }, { include: ["~DEFAULT_BRANCH"], exclude: "" }]) {
    assert.ok(publicationRolloutProblems("main", [{ ...valid, conditions: { ref_name } }], 1).length);
  }
  // ADR-0046 prohibits the publication App bypass; human governance is separate.
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "OrganizationAdmin", actor_id: 1 }] }], 1), []);
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "Integration", actor_id: 1 }] }], 1), ["app_bypasses_ruleset"]);
  assert.ok(publicationRolloutProblems("main", [{ ...valid, enforcement: "disabled" }], 1).length);
  assert.ok(publicationRolloutProblems("main", [valid], 0).includes("unverified_app_identity"));
});
