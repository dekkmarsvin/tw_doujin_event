import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { planClaimBatch } = await environment.runner.import("/app/admin/claim-batch.ts");
after(() => vite.close());

const claim = (id, eventId, circleId, circleClaimed = false) => ({
  id, eventId, circleId, circleName: `社團 ${circleId}`, circleClaimed,
  evidenceUrl: null, evidenceNote: null, targetUrl: null, createdAt: 0,
});

const queue = [
  claim("a", "ch-20", "c-1"),
  claim("b", "ch-20", "c-2"),
  claim("c", "ch-20", "c-2"),
  claim("d", "ch-20", "c-3", true),
  claim("e", "pf45-rf14", "c-2"),
  claim("f", "pf45-rf14", "c-4"),
];
const ids = (list) => list.map((item) => item.id);

test("an approval leaves out circles with an owner and circles ticked twice, in queue order", () => {
  const plan = planClaimBatch(queue, new Set(["f", "d", "c", "b", "a", "e"]), "approve");
  // The same circle id in another event is another circle: e goes through.
  assert.deepEqual(ids(plan.go), ["a", "e", "f"]);
  assert.deepEqual(plan.skipped.map(({ ids: skippedIds, count, reason }) => [skippedIds, count, reason]), [
    [["b", "c"], 2, "duplicate"],
    [["d"], 1, "claimed"],
  ]);
});

test("one claim for a circle that has another pending claim unticked still goes through", () => {
  // Only ticking both is ambiguous; the other pending claim is refused by the
  // server once this one is approved, and stays in the queue to be decided.
  const plan = planClaimBatch(queue, new Set(["b"]), "approve");
  assert.deepEqual(ids(plan.go), ["b"]);
  assert.deepEqual(plan.skipped, []);
});

test("a rejection sends everything ticked", () => {
  const plan = planClaimBatch(queue, new Set(["b", "c", "d"]), "reject");
  assert.deepEqual(ids(plan.go), ["b", "c", "d"]);
  assert.deepEqual(plan.skipped, []);
});

test("nothing ticked plans nothing", () => {
  const plan = planClaimBatch(queue, new Set(), "approve");
  assert.deepEqual(plan.go, []);
  assert.deepEqual(plan.skipped, []);
});
