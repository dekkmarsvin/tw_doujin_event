import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const {
  calculateMapFitZoom,
  calculatePinchMapView,
  clampMapZoom,
  INITIAL_WHEEL_OVERVIEW_STATE,
  isAtMinimumZoom,
  mapViewFromWheel,
  shouldEnterOverviewFromPinch,
  shouldShowMapMedia,
  stepWheelOverviewGesture,
  zoomOffsetAroundPoint,
} = await environment.runner.import("/app/map-viewport.ts");
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
  assert.equal(shouldShowMapMedia(1.449), false);
  assert.equal(shouldShowMapMedia(1.45), true);
});

test("mobile scroll pans the map without changing zoom", () => {
  const view = { zoom: .8, offset: { x: 35, y: 98 } };
  const next = mapViewFromWheel(view, { x: 12, y: 120 }, { x: 180, y: 40 }, .2, "pan");

  assert.deepEqual(next, { zoom: .8, offset: { x: 23, y: -22 } });
});

test("pinch updates zoom and offset as one inset-aware anchored map view", () => {
  const center = { x: 160, y: 70 };
  const anchor = { distance: 100, zoom: .8, mapX: 200, mapY: 120, center, inset: { x: 10, y: 10 } };
  const next = calculatePinchMapView(anchor, 160, center, .2);

  assert.equal(next.zoom, 1.28);
  assert.equal((center.x - anchor.inset.x - next.offset.x) / next.zoom, anchor.mapX);
  assert.equal((center.y - anchor.inset.y - next.offset.y) / next.zoom, anchor.mapY);
});

test("wheel gesture uses one 280ms boundary so momentum stops at fit and paused scroll-out enters overview", () => {
  const min = 0.5;
  assert.equal(isAtMinimumZoom(0.505, min), true);
  assert.equal(isAtMinimumZoom(0.52, min), false);

  // Momentum burst starting above minimum never enters overview even after reaching minimum.
  let step = stepWheelOverviewGesture(INITIAL_WHEEL_OVERVIEW_STATE, { now: 1000, deltaY: 140, zoom: 0.9, minimum: min });
  assert.equal(step.enterOverview, false);
  step = stepWheelOverviewGesture(step.state, { now: 1080, deltaY: 160, zoom: 0.5, minimum: min });
  assert.equal(step.enterOverview, false);

  // Pause <= 280ms does not reset, pause > 280ms starts a fresh gesture and clears old delta.
  let atMin = stepWheelOverviewGesture(INITIAL_WHEEL_OVERVIEW_STATE, { now: 2000, deltaY: 70, zoom: 0.5, minimum: min });
  assert.equal(atMin.enterOverview, false);
  atMin = stepWheelOverviewGesture(atMin.state, { now: 2300, deltaY: 60, zoom: 0.5, minimum: min });
  assert.equal(atMin.enterOverview, false, "pause > 280ms resets accumulated delta from prior gesture");
  atMin = stepWheelOverviewGesture(atMin.state, { now: 2360, deltaY: 70, zoom: 0.5, minimum: min });
  assert.equal(atMin.enterOverview, true, "contiguous gesture >= 120px enters overview");

  // Zooming back in clears accumulation.
  let zoomIn = stepWheelOverviewGesture(INITIAL_WHEEL_OVERVIEW_STATE, { now: 3000, deltaY: 90, zoom: 0.5, minimum: min });
  zoomIn = stepWheelOverviewGesture(zoomIn.state, { now: 3040, deltaY: -40, zoom: 0.55, minimum: min });
  assert.equal(zoomIn.state.accumulated, 0);
  assert.equal(zoomIn.enterOverview, false);
});

test("pinch only enters overview when started at minimum zoom and pinched past 0.86x", () => {
  assert.equal(shouldEnterOverviewFromPinch({ distance: 100, zoom: 1.0, mapX: 0, mapY: 0, center: { x: 0, y: 0 }, startedAtMinimum: false }, 30, 0.5), false);
  assert.equal(shouldEnterOverviewFromPinch({ distance: 100, zoom: 0.5, mapX: 0, mapY: 0, center: { x: 0, y: 0 }, startedAtMinimum: true }, 90, 0.5), false);
  assert.equal(shouldEnterOverviewFromPinch({ distance: 100, zoom: 0.5, mapX: 0, mapY: 0, center: { x: 0, y: 0 }, startedAtMinimum: true }, 85, 0.5), true);
});
