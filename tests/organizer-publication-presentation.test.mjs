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
  assert.match(publicationFailureMessage("event_id_collision", false), /首次發布不能覆寫/);
  assert.match(publicationFailureMessage("infrastructure_error", true), /內容沒有被退件/);
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
  assert.deepEqual(publicationRolloutProblems("main", [{ ...valid, bypass_actors: [{ actor_type: "Integration", actor_id: 1 }] }], 1), ["app_bypasses_ruleset"]);
  assert.ok(publicationRolloutProblems("main", [{ ...valid, enforcement: "disabled" }], 1).length);
  assert.ok(publicationRolloutProblems("main", [valid], 0).includes("unverified_app_identity"));
});
