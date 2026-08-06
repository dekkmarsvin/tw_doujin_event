import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { clampMapZoom, zoomOffsetAroundPoint } = await environment.runner.import("/app/map-viewport.ts");
after(() => vite.close());

test("button zoom preserves the map coordinate at the viewport center", () => {
  const offset = { x: -120, y: 48 };
  const point = { x: 400, y: 260 };
  const beforeZoom = .8;
  const afterZoom = .9;
  const mapPoint = { x: (point.x - offset.x) / beforeZoom, y: (point.y - offset.y) / beforeZoom };
  const next = zoomOffsetAroundPoint(offset, beforeZoom, afterZoom, point);

  assert.equal((point.x - next.x) / afterZoom, mapPoint.x);
  assert.equal((point.y - next.y) / afterZoom, mapPoint.y);
});

test("map zoom remains inside the supported range", () => {
  assert.equal(clampMapZoom(.1), .35);
  assert.equal(clampMapZoom(2.5), 1.8);
  assert.equal(clampMapZoom(.9), .9);
});
