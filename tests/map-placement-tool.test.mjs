import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { resolveFacilityPlacement: place } = await vite.environments.ssr.runner.import("/app/map-placement-tool.ts");
after(() => vite.close());

test("a pillar click keeps the original centre and stays inside the map", () => {
  assert.deepEqual(place("pillar", { x: 400, y: 250 }, { x: 401, y: 251 }, { x: 1, y: 1 }, { width: 1000, height: 500 }), { x: 385, y: 242.5, width: 30, height: 15 });
  assert.deepEqual(place("pillar", { x: 0, y: 500 }, { x: 0, y: 500 }, { x: 0, y: 0 }, { width: 1000, height: 500 }), { x: 0, y: 485, width: 30, height: 15 });
});

test("areas are drawn by dragging; a click places no default-sized block", () => {
  const bounds = { width: 1000, height: 500 }, point = { x: 400, y: 250 };
  for (const tool of ["enterprise", "stage", "other", "space-mark", "note"]) {
    assert.equal(place(tool, point, point, { x: 0, y: 0 }, bounds), null, tool);
    assert.equal(place(tool, point, { x: 401, y: 251 }, { x: 1, y: 1 }, bounds), null, `${tool} jitter`);
    assert.deepEqual(place(tool, point, { x: 500, y: 300 }, { x: 100, y: 50 }, bounds), { x: 400, y: 250, width: 100, height: 50 }, `${tool} drag`);
  }
});

test("drag threshold is independent of map zoom and reverse drags retain their bounds", () => {
  for (const scale of [0.25, 1, 4, 8]) {
    const start = { x: 400, y: 300 }, end = { x: 400 - 40 / scale, y: 300 - 20 / scale };
    assert.deepEqual(place("enterprise", start, end, { x: -40, y: -20 }, { width: 1000, height: 500 }), { ...end, width: 40 / scale, height: 20 / scale });
    assert.equal(place("pillar", start, end, { x: 20, y: 2 }, { width: 1000, height: 500 }), null);
  }
});

test("access points use clicks only and a cancelled-looking drag cannot create one", () => {
  const point = { x: 120, y: 70 }, bounds = { width: 200, height: 100 };
  assert.deepEqual(place("access", point, point, { x: 0, y: 0 }, bounds), { ...point, width: 0, height: 0 });
  assert.equal(place("access", point, { x: 140, y: 70 }, { x: 20, y: 0 }, bounds), null);
  assert.deepEqual(place("service", point, point, { x: 1, y: 1 }, bounds), { ...point, width: 0, height: 0 }, "a service point is placed by a click too");
  assert.equal(place("service", point, { x: 140, y: 70 }, { x: 20, y: 0 }, bounds), null);
});
