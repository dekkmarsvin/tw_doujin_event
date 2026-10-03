import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { assignShapeBox, cloneShape, isSimplePolygon, pointInPolygon, polygonBounds, shapeInterior } = await vite.environments.ssr.runner.import("/app/map-shape-geometry.ts");
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
