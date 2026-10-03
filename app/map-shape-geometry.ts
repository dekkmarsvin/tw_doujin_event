import type { MapPoint, MapRect } from "./event-map";

export type MapShape = MapRect & { points?: MapPoint[] };
const EPSILON = 1e-7;

export function polygonBounds(points: readonly MapPoint[]): MapRect {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return { x, y, width: Math.max(...points.map((point) => point.x)) - x, height: Math.max(...points.map((point) => point.y)) - y };
}

function cross(a: MapPoint, b: MapPoint, c: MapPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: MapPoint, b: MapPoint, p: MapPoint) {
  return Math.abs(cross(a, b, p)) < EPSILON && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

function segmentsMeet(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Input boundary for the four drawable area shapes; booth boxes stay rectangles. */
export function isSimplePolygon(value: unknown): value is MapPoint[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 200 || value.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const points = value as MapPoint[];
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) return false;
    if (Math.abs(cross(a, b, c)) < EPSILON && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return false;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsMeet(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return Math.abs(area) > EPSILON;
}

export function pointInPolygon(point: MapPoint, points: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edgeDistance(point: MapPoint, a: MapPoint, b: MapPoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
}

/** A point with a safe interior radius. Scan lines also find narrow concave
 * branches a regular grid would miss; local refinement gives the label room. */
export function shapeInterior(shape: MapShape): MapPoint & { radius: number } {
  if (!shape.points) return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2, radius: Math.min(shape.width, shape.height) / 2 };
  const points = shape.points;
  const distance = (p: MapPoint) => pointInPolygon(p, points) ? Math.min(...points.map((a, i) => edgeDistance(p, a, points[(i + 1) % points.length]))) : -1;
  let best = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2, radius: -1 };
  const offer = (p: MapPoint) => { const radius = distance(p); if (radius > best.radius) best = { ...p, radius }; };
  offer(best);
  const ys = [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);
  for (let k = 1; k < ys.length; k++) {
    for (const fraction of [.25, .5, .75]) {
      const y = ys[k - 1] + (ys[k] - ys[k - 1]) * fraction;
      const xs: number[] = [];
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      });
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) offer({ x: (xs[i] + xs[i + 1]) / 2, y });
    }
  }
  for (let step = Math.max(shape.width, shape.height) / 8, round = 0; round < 8; step /= 2, round++) {
    const base = best;
    for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) offer({ x: base.x + dx, y: base.y + dy });
  }
  return best;
}

/** Used by every move/resize path so the bounding box and vertices stay together. */
export function assignShapeBox(shape: MapShape, box: MapRect): void {
  if (shape.points) shape.points = shape.points.map((point) => ({ x: box.x + (point.x - shape.x) * box.width / shape.width, y: box.y + (point.y - shape.y) * box.height / shape.height }));
  shape.x = box.x; shape.y = box.y; shape.width = box.width; shape.height = box.height;
}

export function cloneShape<T extends MapShape>(shape: T): T {
  return { ...shape, ...(shape.points ? { points: shape.points.map((point) => ({ ...point })) } : {}) };
}
