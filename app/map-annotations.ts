import type { MapPoint, MapRect } from "./event-map";

export const MAP_NOTE_MAX_LENGTH = 120;
export const MAP_NOTE_MAX_LINES = 3;
export const MAP_PATH_MAX_POINTS = 100;
export type MapNote = { id: string; text: string; rect: MapRect };
export type MapPath = { id: string; points: MapPoint[] };

export function pathBounds(path: MapPath): MapRect {
  const x = Math.min(...path.points.map((point) => point.x)), y = Math.min(...path.points.map((point) => point.y));
  return { x, y, width: Math.max(...path.points.map((point) => point.x)) - x, height: Math.max(...path.points.map((point) => point.y)) - y };
}

export function transformPath(path: MapPath, box: MapRect): void {
  const from = pathBounds(path);
  const maxX = Math.max(...path.points.map((point) => point.x)), maxY = Math.max(...path.points.map((point) => point.y));
  const coordinate = (value: number, min: number, max: number, start: number, size: number) => value === min ? start : value === max ? start + size : start + (value - min) * size / (max - min);
  path.points = path.points.map((point) => ({ x: coordinate(point.x, from.x, maxX, box.x, box.width), y: coordinate(point.y, from.y, maxY, box.y, box.height) }));
}

export function validNoteText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAP_NOTE_MAX_LENGTH && value.split("\n").length <= MAP_NOTE_MAX_LINES && ![...value].some((character) => { const code = character.charCodeAt(0); return code === 127 || (code < 32 && code !== 9 && code !== 10); });
}

export function validPathPoints(value: unknown, width: number, height: number): value is MapPoint[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= MAP_PATH_MAX_POINTS
    && value.every((point, index) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height
      && (index === 0 || point.x !== value[index - 1].x || point.y !== value[index - 1].y));
}

function rectsOverlap(a: MapRect, b: MapRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Segment/box clipping also catches a diagonal crossing a booth with both
 * endpoints outside it. Touching an edge is allowed; crossing its interior is not. */
function segmentCrossesBox(a: MapPoint, b: MapPoint, box: MapRect): boolean {
  let low = 0, high = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, box.x, box.x + box.width], [a.y, b.y - a.y, box.y, box.y + box.height]]) {
    if (delta === 0) { if (origin <= min || origin >= max) return false; continue; }
    const first = (min - origin) / delta, last = (max - origin) / delta;
    low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
    if (low >= high) return false;
  }
  return low < high;
}

export function annotationBoothConflicts(notes: readonly MapNote[], paths: readonly MapPath[], booths: readonly { code: string; rect: MapRect }[]): string[] {
  const errors: string[] = [];
  notes.forEach((note, index) => { const codes = booths.filter((booth) => rectsOverlap(note.rect, booth.rect)).map((booth) => booth.code); if (codes.length) errors.push(`文字註記 ${index + 1} 與攤位 ${codes.join("、")} 重疊，請移到空白處。`); });
  paths.forEach((path, index) => {
    const head = pathArrowhead(path);
    const segments = [...path.points.slice(1).map((point, i) => [path.points[i], point]), ...head.slice(1).map((point, i) => [head[i], point])];
    const codes = booths.filter((booth) => segments.some(([a, b]) => segmentCrossesBox(a, b, booth.rect))).map((booth) => booth.code);
    if (codes.length) errors.push(`動線箭頭 ${index + 1} 穿過攤位 ${codes.join("、")}，請調整頂點。`);
  });
  return errors;
}

export function pathArrowhead(path: MapPath): MapPoint[] {
  const last = path.points.at(-1), previous = path.points.at(-2);
  if (!last || !previous) return [];
  const angle = Math.atan2(last.y - previous.y, last.x - previous.x);
  const length = Math.hypot(last.x - previous.x, last.y - previous.y);
  const size = Math.min(10, length / 2);
  const head = [-.5, .5].map((turn) => ({ x: last.x - size * Math.cos(angle + turn), y: last.y - size * Math.sin(angle + turn) }));
  return [head[0], last, head[1]];
}
