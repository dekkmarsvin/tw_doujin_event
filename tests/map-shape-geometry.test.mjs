import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { arcThroughPoints, assignShapeBox, circleThroughPoints, cloneShape, isSimplePolygon, pointInPolygon, polygonBounds, rectInsidePolygon, shapeInterior } = await vite.environments.ssr.runner.import("/app/map-shape-geometry.ts");
const { createBlankEventMapLayout, validateEventMapLayout, scaleEventMapLayout } = await vite.environments.ssr.runner.import("/app/event-map.ts");
const { parseMapContributionDraftContent } = await vite.environments.ssr.runner.import("/app/map-contribution-draft.ts");
const { applySelectionBoxes } = await vite.environments.ssr.runner.import("/app/map-layout-editor-selection.ts");
const { layoutMapMarkerLabels } = await vite.environments.ssr.runner.import("/app/map-marker-presentation.ts");
const { mapFacilityDirectory } = await vite.environments.ssr.runner.import("/app/map-facility-directory.ts");
after(() => vite.close());
const concave = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 110 }, { x: 10, y: 110 }];

test("concave areas keep their name and locator inside the shape, away from the missing corner", () => {
  const shape = { ...polygonBounds(concave), points: concave };
  assert.equal(isSimplePolygon(concave), true);
  assert.equal(pointInPolygon({ x: 60, y: 60 }, concave), false);
  const anchor = shapeInterior(shape);
  assert.equal(pointInPolygon(anchor, concave), true);
  assert.ok(anchor.radius > 9 && anchor.radius < 15);
  assert.deepEqual(shapeInterior({ x: 0, y: 0, width: 50, height: 30 }), { x: 25, y: 15, radius: 15 });
});

test("move, resize and history clones preserve the vertices and bounding box together", () => {
  const original = { ...polygonBounds(concave), points: concave };
  const moved = cloneShape(original);
  assignShapeBox(moved, { x: 20, y: 30, width: 200, height: 50 });
  assert.deepEqual(polygonBounds(moved.points), { x: 20, y: 30, width: 200, height: 50 });
  assert.deepEqual(moved.points[0], { x: 20, y: 30 });
  moved.points[0].x++;
  assert.deepEqual(original.points, concave);
});

test("rejects self intersections, repeated vertices, backtracking, zero area and malformed coordinates", () => {
  for (const points of [[], concave.slice(0, 2), [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }], [...concave, concave[0]], [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], [{ x: NaN, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]]) assert.equal(isSimplePolygon(points), false);
});

test("all four shapes save, scale and batch-move while rectangles retain their prior schema", () => {
  const layout = createBlankEventMapLayout("SAMPLE", 200, 200);
  layout.floor = { ...polygonBounds(concave), points: structuredClone(concave) };
  layout.landmarks = ["enterprise", "stage", "other"].map(kind => ({ id: kind, kind, label: kind, rect: structuredClone(layout.floor) }));
  assert.equal(parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout }).layout.floor.points.length, 6);
  const scaled = scaleEventMapLayout(layout, { width: 220, height: 115 });
  assert.equal(validateEventMapLayout(scaled).ok, true);
  const scaledBounds = polygonBounds(scaled.floor.points);
  for (const [key, expected] of Object.entries({ x: 11, y: 5.75, width: 110, height: 57.5 })) assert.ok(Math.abs(scaledBounds[key] - expected) < 1e-7);
  applySelectionBoxes(scaled, [{ kind: "floor" }, { kind: "landmark", itemIndex: 1 }], [{ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 0, width: 100, height: 50 }]);
  assert.equal(validateEventMapLayout(scaled).ok, true);
  assert.deepEqual(polygonBounds(scaled.landmarks[1].rect.points), { x: 50, y: 0, width: 100, height: 50 });
  const malformed = structuredClone(layout); malformed.floor.width++;
  assert.equal(parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout: malformed }), null);
  const badSlot = { code: "A01", rect: layout.floor };
  layout.rows = [{ label: "A", orientation: "vertical", confidence: 1, slots: [badSlot] }];
  assert.equal(parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout }), null, "booths cannot use polygon fields");
});

test("shared area name and facility locator lie inside a concave area", () => {
  const points = concave.map(point => ({ x: point.x * 4, y: point.y * 4 }));
  const layout = createBlankEventMapLayout("SAMPLE", 500, 500);
  layout.landmarks = [{ id: "stage", kind: "stage", label: "舞台", rect: { ...polygonBounds(points), points } }];
  const label = layoutMapMarkerLabels(layout, { screenScale: 1, fontScale: 1 }).get("landmark:stage");
  assert.ok(label); assert.equal(pointInPolygon(label, points), true);
  const directory = mapFacilityDirectory(layout);
  assert.equal(pointInPolygon(directory.entries[0].point, points), true);
});

test("three clicks make an arc that bends toward the middle click and ends on the outer two", () => {
  const onCircle = (points, x, y, r) => points.every(p => Math.abs(Math.hypot(p.x - x, p.y - y) - r) < 1e-9);
  const up = arcThroughPoints({ x: -10, y: 0 }, { x: 0, y: -10 }, { x: 10, y: 0 });
  assert.deepEqual([up[0], up.at(-1)], [{ x: -10, y: 0 }, { x: 10, y: 0 }]);
  assert.ok(onCircle(up, 0, 0, 10) && up.every(p => p.y <= 1e-9), "the arc runs on the middle click's side");
  assert.ok(arcThroughPoints({ x: -10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }).every(p => p.y >= -1e-9));
  const wide = arcThroughPoints({ x: 0, y: -10 }, { x: -10, y: 0 }, { x: 10, y: 0 });
  assert.ok(wide.some(p => p.y > 9), "an arc longer than half a turn still passes the middle click");
  assert.equal(arcThroughPoints({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }), null);
  assert.equal(arcThroughPoints({ x: -10, y: 0 }, { x: 0, y: -10 }, { x: 10, y: 0 }, 5).length, 5, "the arc fits the vertices left");
  const circle = circleThroughPoints({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 });
  assert.ok(onCircle(circle, 0, 0, 10) && isSimplePolygon(circle));
});

test("a box is inside a concave area only when no edge of the area cuts it", () => {
  assert.equal(rectInsidePolygon({ x: 12, y: 40, width: 16, height: 60 }, concave), true);
  assert.equal(rectInsidePolygon({ x: 12, y: 12, width: 60, height: 60 }, concave), false, "every corner may be inside while the missing corner cuts through");
  assert.equal(rectInsidePolygon({ x: 0, y: 40, width: 16, height: 20 }, concave), false);
});
