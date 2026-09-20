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
  assert.doesNotMatch(publicationFailureMessage(stalledAfterRetry, true), /發布沒有開始/);
  assert.equal(publicationFailureMessage(stalledAfterRetry, true),
    publicationFailureMessage({ failureCode: "infrastructure_error", retryable: true, started: true }, true));
});

// #234: with publication switched off the retry button is disabled, so a
// message inviting a retry sends the owner at a control that cannot be used.
test("a failure message never offers a retry the owner cannot take", () => {
  const neverStarted = { failureCode: "queued_timeout", retryable: true, started: false };
  const midway = { failureCode: "infrastructure_error", retryable: true, started: true };

  for (const job of [neverStarted, midway]) {
    assert.match(publicationFailureMessage(job, true), /可以重試發布/);
    assert.doesNotMatch(publicationFailureMessage(job, false), /重試/);
    assert.match(publicationFailureMessage(job, false), /內容沒有被退件/, "the owner still learns the content stands");
  }
  // What happened is still said: a job that never started does not become a
  // mid-publication failure just because publishing is off.
  assert.match(publicationFailureMessage(neverStarted, false), /發布沒有開始/);
  assert.doesNotMatch(publicationFailureMessage(midway, false), /發布沒有開始/);

  // Codes that were never retryable read the same either way -- they already
  // point at the administrator rather than at a button.
  for (const failureCode of ["event_id_collision", "snapshot_mismatch", "amendment_baseline_changed"]) {
    const job = { failureCode, retryable: false, started: true };
    assert.equal(publicationFailureMessage(job, false), publicationFailureMessage(job, true));
  }
});

test("an active ruleset alone is not rollout approval", () => {
  const ruleset = { enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, bypass_actors: [],
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
  const problems = publicationRolloutProblems("main", [ruleset], 1);
  assert.deepEqual(problems, ["missing_pull_request_rule", "missing_check:Verify and deploy", "missing_check:Full preview portal E2E",
    "missing_check:Browser acceptance", "missing_check:Organizer publication approval"]);
  // A required check pinned to the App that reports it. Without the pin the
  // rule accepts the name from anything holding checks write, which is how
  // this App satisfies its own approval check (ADR-0066 decision 2).
  const valid = { ...ruleset, rules: [{ type: "pull_request" }, { type: "required_status_checks", parameters: {
    required_status_checks: PUBLICATION_REQUIRED_CHECKS.main.map((context) => ({ context, integration_id: 15368 })),
  } }] };
  assert.deepEqual(publicationRolloutProblems("main", [valid], 1), []);
  const unpinned = { ...ruleset, rules: [{ type: "pull_request" }, { type: "required_status_checks", parameters: {
    required_status_checks: PUBLICATION_REQUIRED_CHECKS.main.map((context, index) => index === 0 ? { context } : { context, integration_id: 15368 }),
  } }] };
  assert.deepEqual(publicationRolloutProblems("main", [unpinned], 1), [`unpinned_check:${PUBLICATION_REQUIRED_CHECKS.main[0]}`]);
  for (const ref_name of [{ include: ["~DEFAULT_BRANCH"] }, { exclude: [] }, { include: ["~DEFAULT_BRANCH"], exclude: "" }]) {
    assert.ok(publicationRolloutProblems("main", [{ ...valid, conditions: { ref_name } }], 1).length);
  }
  // Both are reports, not gates, and they are separate because they mean
  // different things: the App bypassing itself is a misconfiguration, a human
  // or role bypassing is a governance choice (ADR-0058 decision 3). Any actor
  // type counts -- an org admin merges a publication PR just as effectively as
  // an integration does.
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "OrganizationAdmin", actor_id: 1 }] }], 1), ["human_bypasses_ruleset"]);
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }] }], 1), ["human_bypasses_ruleset"]);
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "Integration", actor_id: 1 }] }], 1), ["app_bypasses_ruleset"]);
  // A different integration is not this App, so it reads as a human choice.
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "Integration", actor_id: 99 }] }], 1), []);
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "Integration", actor_id: 1 }, { actor_type: "Team", actor_id: 7 }] }], 1),
    ["app_bypasses_ruleset", "human_bypasses_ruleset"]);
  assert.ok(publicationRolloutProblems("main", [{ ...valid, enforcement: "disabled" }], 1).length);
  assert.ok(publicationRolloutProblems("main", [valid], 0).includes("unverified_app_identity"));
});


test("amendment conflicts explain why blind retry cannot overwrite changed public data", () => {
  for (const failureCode of ["amendment_baseline_changed", "amendment_base_conflict"]) {
    assert.match(publicationFailureMessage({ failureCode, retryable: false }), /公開版本或發布資料已變更/);
    assert.match(publicationFailureMessage({ failureCode, retryable: false }), /不能直接重試覆寫/);
  }
});
