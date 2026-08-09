import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { calculateMapFitZoom, centerMapOffset, clampMapZoom, shouldShowMapMedia, zoomOffsetAroundPoint } = await environment.runner.import("/app/map-viewport.ts");
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
  const fitZoom = calculateMapFitZoom({ width: 800, height: 600 }, { width: 1600, height: 1000 }, 50);
  assert.equal(fitZoom, .4375);
  assert.equal(clampMapZoom(.1, fitZoom), fitZoom);
  assert.equal(clampMapZoom(7.2), 6);
  assert.equal(clampMapZoom(5.5), 5.5);
  assert.equal(clampMapZoom(.9, fitZoom), .9);
  assert.deepEqual(centerMapOffset({ width: 800, height: 600 }, { width: 1600, height: 1000 }, fitZoom), { x: 32, y: 63.25 });
});

test("map media appears after the close-inspection zoom threshold", () => {
  assert.equal(shouldShowMapMedia(1.44), false);
  assert.equal(shouldShowMapMedia(1.45), true);
});
