import { rowLabelPlacement, type EventMapLayout, type MapAccessDirection, type MapAccessPoint } from "./event-map";

/** Layout units to CSS px, and the reader's text-size multiplier. */
export type MapMarkerPresentation = { screenScale: number; fontScale: number };

/** Previews that do not measure the page draw one layout unit as one pixel. */
export const DEFAULT_MAP_MARKER_PRESENTATION: MapMarkerPresentation = { screenScale: 1, fontScale: 1 };

/** An access point's badge keeps this on-screen size at every zoom. */
export const MAP_ACCESS_BADGE_PX = 22;

/** Each label kind keeps its old size in layout units while that stays inside
 * its on-screen bounds; below the floor it stops shrinking with the map, and
 * above the ceiling it stops growing. */
const ACCESS_LABEL = { units: 10, minPx: 11, maxPx: 14 };
const ROW_LABEL = { units: 22, minPx: 12, maxPx: 28 };
const LANDMARK_LABEL = { units: 12, minPx: 11, maxPx: 16 };
const LABEL_GAP_PX = 4;
const LANDMARK_PADDING_PX = 3;
const COLLISION_MARGIN_PX = 2;
/** The label is drawn on a central baseline; this is half its line box. */
const HALF_LINE_EM = .6;

/** A label drawn in screen pixels around a layout anchor. */
export type MapMarkerLabel = {
  text: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  fontPx: number;
  anchor: "start" | "middle" | "end";
};

type Box = { left: number; top: number; right: number; bottom: number };

/** Keys are `row:<label>`, `access:<id>`, `service:<id>` and `landmark:<id>`. */
export function mapMarkerLabelKey(kind: "row" | "access" | "service" | "landmark", id: string) {
  return `${kind}:${id}`;
}

/** Conservative width, in ems: ASCII runs narrow, anything else is a full em.
 * Rendering never measures the DOM, so this errs toward hiding a label that
 * would have fitted rather than drawing one that collides. */
export function mapLabelEms(text: string) {
  let ems = 0;
  for (const character of text) ems += character.codePointAt(0)! < 0x7f ? .62 : 1;
  return ems;
}

function usable(presentation: MapMarkerPresentation): MapMarkerPresentation {
  const screenScale = Number.isFinite(presentation.screenScale) && presentation.screenScale > 0 ? presentation.screenScale : 1;
  const fontScale = Number.isFinite(presentation.fontScale) && presentation.fontScale > 0 ? presentation.fontScale : 1;
  return { screenScale, fontScale };
}

function boundedPx(rule: { units: number; minPx: number; maxPx: number }, { screenScale, fontScale }: MapMarkerPresentation) {
  return Math.min(rule.maxPx * fontScale, Math.max(rule.minPx * fontScale, rule.units * screenScale));
}

/** Where an access point's name sits: on the side facing out of the hall. A
 * reader walks in through an entrance, so its name is behind the arrow; they
 * walk out through an exit, so its name is ahead of it. A doorway used both
 * ways points into the hall, like an entrance. */
export function accessLabelSide(point: Pick<MapAccessPoint, "kind" | "direction">): MapAccessDirection {
  if (point.kind === "exit") return point.direction;
  return ({ north: "south", south: "north", east: "west", west: "east" } as const)[point.direction];
}

function badgeLabel(point: { x: number; y: number }, text: string, side: MapAccessDirection, fontPx: number): MapMarkerLabel {
  const offset = MAP_ACCESS_BADGE_PX / 2 + LABEL_GAP_PX;
  const vertical = offset + fontPx * HALF_LINE_EM;
  const base = { text, x: point.x, y: point.y, fontPx };
  switch (side) {
    case "north": return { ...base, dx: 0, dy: -vertical, anchor: "middle" };
    case "south": return { ...base, dx: 0, dy: vertical, anchor: "middle" };
    case "east": return { ...base, dx: offset, dy: 0, anchor: "start" };
    case "west": return { ...base, dx: -offset, dy: 0, anchor: "end" };
  }
}

function labelBox(label: MapMarkerLabel, screenScale: number): Box {
  const width = mapLabelEms(label.text) * label.fontPx;
  const x = label.x * screenScale + label.dx;
  const y = label.y * screenScale + label.dy;
  const left = label.anchor === "start" ? x : label.anchor === "end" ? x - width : x - width / 2;
  const half = label.fontPx * HALF_LINE_EM;
  return { left, right: left + width, top: y - half, bottom: y + half };
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right + COLLISION_MARGIN_PX && b.left < a.right + COLLISION_MARGIN_PX
    && a.top < b.bottom + COLLISION_MARGIN_PX && b.top < a.bottom + COLLISION_MARGIN_PX;
}

/**
 * Sizes and places every row, access point and landmark label for one zoom, and
 * returns only the ones to draw. Access and service point badges are always
 * drawn, so they are placed first as obstacles; labels then claim space in
 * priority order — access points and rows, then service points, then
 * landmarks — and a label that would overlap one
 * already placed is left out. A landmark name also has to fit inside its own
 * area at the smallest size, or it is left out. Hidden names stay available
 * through the accessible names the renderer gives each element.
 */
export function layoutMapMarkerLabels(layout: Pick<EventMapLayout, "width" | "height" | "rows" | "accessPoints" | "landmarks" | "servicePoints">, requested: MapMarkerPresentation): Map<string, MapMarkerLabel> {
  const presentation = usable(requested);
  const { screenScale, fontScale } = presentation;
  const servicePoints = layout.servicePoints ?? [];
  const placed: Box[] = [...layout.accessPoints, ...servicePoints].map((point) => {
    const half = MAP_ACCESS_BADGE_PX / 2;
    return { left: point.x * screenScale - half, right: point.x * screenScale + half, top: point.y * screenScale - half, bottom: point.y * screenScale + half };
  });
  const candidates: [string, MapMarkerLabel][] = [];

  const accessPx = boundedPx(ACCESS_LABEL, presentation);
  for (const point of layout.accessPoints) {
    if (point.label.trim()) candidates.push([mapMarkerLabelKey("access", point.id), badgeLabel(point, point.label, accessLabelSide(point), accessPx)]);
  }
  const rowPx = boundedPx(ROW_LABEL, presentation);
  for (const row of layout.rows) {
    const placement = rowLabelPlacement(row);
    if (!placement) continue;
    const dy = (placement.side === "below" ? 1 : -1) * rowPx * HALF_LINE_EM;
    candidates.push([mapMarkerLabelKey("row", row.label), { text: row.label, x: placement.x, y: placement.y, dx: 0, dy, fontPx: rowPx, anchor: "middle" }]);
  }
  // A service point's badge already says what it is; only a name that tells
  // two of a kind apart is drawn, below the badge.
  for (const point of servicePoints) {
    const text = point.label?.trim();
    if (text) candidates.push([mapMarkerLabelKey("service", point.id), badgeLabel(point, text, "south", accessPx)]);
  }
  const landmarkPx = boundedPx(LANDMARK_LABEL, presentation);
  for (const landmark of layout.landmarks) {
    if (!landmark.label.trim()) continue;
    const width = landmark.rect.width * screenScale - LANDMARK_PADDING_PX * 2;
    const height = landmark.rect.height * screenScale - LANDMARK_PADDING_PX * 2;
    const fontPx = Math.min(landmarkPx, width / mapLabelEms(landmark.label), height / (HALF_LINE_EM * 2));
    if (!(fontPx >= LANDMARK_LABEL.minPx * fontScale)) continue;
    candidates.push([mapMarkerLabelKey("landmark", landmark.id), {
      text: landmark.label, x: landmark.rect.x + landmark.rect.width / 2, y: landmark.rect.y + landmark.rect.height / 2, dx: 0, dy: 0, fontPx, anchor: "middle",
    }]);
  }

  // A name by the edge of the plan slides back along its own side rather than
  // running off the drawing, where the fitted map would cut it short. It never
  // slides toward what it names, which would put it on top of the badge.
  const planWidth = layout.width * screenScale;
  const planHeight = layout.height * screenScale;
  const labels = new Map<string, MapMarkerLabel>();
  for (const [key, candidate] of candidates) {
    const initial = labelBox(candidate, screenScale);
    const alongX = candidate.anchor === "middle";
    const shiftX = !alongX ? 0 : initial.left < 0 ? -initial.left : initial.right > planWidth ? planWidth - initial.right : 0;
    const shiftY = alongX ? 0 : initial.top < 0 ? -initial.top : initial.bottom > planHeight ? planHeight - initial.bottom : 0;
    const label = shiftX || shiftY ? { ...candidate, dx: candidate.dx + shiftX, dy: candidate.dy + shiftY } : candidate;
    const box = labelBox(label, screenScale);
    if (placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    labels.set(key, label);
  }
  return labels;
}
