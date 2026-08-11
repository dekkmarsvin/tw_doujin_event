import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { calculateMapFitZoom, calculatePinchMapView, centerMapOffset, clampMapZoom, shouldShowMapMedia, zoomOffsetAroundPoint } = await environment.runner.import("/app/map-viewport.ts");
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

test("pinch zoom at the supported limit ignores alternating pointer-center jitter", () => {
  const gesture = { distance: 90, zoom: 6, mapX: 208.25, mapY: 194.35, center: { x: 195, y: 500 } };
  const afterLeftPointer = calculatePinchMapView(gesture, 95, { x: 192.5, y: 500 });
  const afterRightPointer = calculatePinchMapView({ ...gesture, boundaryCenter: afterLeftPointer.boundaryCenter }, 100, { x: 195, y: 500 });

  assert.equal(afterLeftPointer.zoom, 6);
  assert.deepEqual(afterLeftPointer, afterRightPointer);
});

test("pinch zoom keeps the first boundary center when entering the supported limit", () => {
  const gesture = { distance: 100, zoom: 5.99, mapX: 20, mapY: 30, center: { x: 100, y: 100 } };
  const atBoundary = calculatePinchMapView(gesture, 600 / 5.99, { x: 101, y: 100 });
  const beyondBoundary = calculatePinchMapView({ ...gesture, boundaryCenter: atBoundary.boundaryCenter }, 102, { x: 99, y: 100 });

  assert.equal(atBoundary.zoom, 6);
  assert.deepEqual(atBoundary, beyondBoundary);
});

test("pinch zoom below the limit follows the live two-pointer center", () => {
  const view = calculatePinchMapView({ distance: 100, zoom: 2, mapX: 50, mapY: 50, center: { x: 100, y: 100 } }, 150, { x: 120, y: 130 });
  assert.deepEqual(view, { zoom: 3, offset: { x: -30, y: -20 } });
});

test("map media appears after the close-inspection zoom threshold", () => {
  assert.equal(shouldShowMapMedia(1.44), false);
  assert.equal(shouldShowMapMedia(1.45), true);
});
