import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { resolveCircleSelection } = await environment.runner.import("/app/map-view-state.ts");
after(() => vite.close());

const records = [
  { recordId: "d1-a01", circle: { id: "circle-a" }, day: 1, code: "A01" },
  { recordId: "d1-a02", circle: { id: "circle-a" }, day: 1, code: "A02" },
  { recordId: "d2-a01", circle: { id: "circle-a" }, day: 2, code: "A01" },
];
const byId = new Map(records.map((record) => [record.recordId, record]));

test("restores a canonical circle only when its day and booth mutually agree", () => {
  assert.equal(resolveCircleSelection(records, byId, 1, "circle-a", "A01")?.recordId, "d1-a01");
  assert.equal(resolveCircleSelection(records, byId, 1, "circle-a", "A02")?.recordId, "d1-a02");
  assert.equal(resolveCircleSelection(records, byId, 2, "circle-a", "A01")?.recordId, "d2-a01");
  assert.equal(resolveCircleSelection(records, byId, 1, "circle-a", "Z99"), null);
});

test("supports a valid circle-only or booth-only deep link", () => {
  assert.equal(resolveCircleSelection(records, byId, 1, "d1-a02", null)?.code, "A02");
  assert.equal(resolveCircleSelection(records, byId, 2, null, "A01")?.recordId, "d2-a01");
  assert.equal(resolveCircleSelection(records, byId, 1, null, "Z99"), null);
});

test("resolves a booth-scoped alias before matching its circle and booth", () => {
  const aliases = (circleId) => circleId === "1-a02-0" ? ["circle-a"] : [circleId];
  assert.equal(resolveCircleSelection(records, byId, 1, "1-a02-0", "A02", aliases)?.recordId, "d1-a02");
  assert.equal(resolveCircleSelection(records, byId, 2, "1-a02-0", null, aliases)?.recordId, "d2-a01");
  assert.equal(resolveCircleSelection(records, byId, 1, "1-zz9-0", null, aliases), null);
});
