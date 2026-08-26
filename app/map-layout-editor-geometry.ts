import type { BoothRow, BoothSlot, MapOrientation, MapRect } from "./event-map";

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

/** A row is described by where it starts, where it ends, how many booths sit on
 * it, and how those booths are numbered. Row labels are plain strings, so the
 * Chinese branch labels some organizers use need no special handling.
 *
 * Orientation is deliberately absent: it is derived from the endpoints rather
 * than entered separately, because both renderers position the row label from
 * `orientation` and a value that contradicts the geometry puts that label on
 * the wrong axis. Correcting an unusual row stays possible after creation. */
export type RowDefinition = {
  label: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  slotCount: number;
  slotWidth: number;
  slotHeight: number;
  codePrefix: string;
  startNumber: number;
  numberPadding: number;
};

export type RowGenerationResult =
  | { ok: true; row: BoothRow; errors: [] }
  | { ok: false; row: null; errors: string[] };

/** A row that spans further across than down is horizontal. A row with no
 * extent at all — a single booth, or coincident endpoints — is called vertical,
 * matching how every recognized row so far is stored. */
export function rowOrientationFromEndpoints(start: { x: number; y: number }, end: { x: number; y: number }): MapOrientation {
  return Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? "horizontal" : "vertical";
}

export function formatSlotCode(prefix: string, value: number, padding: number) {
  return `${prefix}${String(value).padStart(Math.max(0, padding), "0")}`;
}

/** Evenly distributes `slotCount` booth rectangles between the two endpoints.
 * Each rectangle is centred on its step, so a row reads the same whether it was
 * traced left-to-right or right-to-left. */
export function generateRowSlots(definition: RowDefinition, bounds: Pick<MapRect, "width" | "height">): RowGenerationResult {
  const errors: string[] = [];
  const label = definition.label.trim();
  if (!label) errors.push("排標籤不可留空。");
  if (!Number.isInteger(definition.slotCount) || definition.slotCount < 1) errors.push("格數必須是大於 0 的整數。");
  if (!(definition.slotWidth > 0) || !(definition.slotHeight > 0)) errors.push("每格寬高必須大於 0。");
  if (!Number.isInteger(definition.startNumber) || definition.startNumber < 0) errors.push("起始編號必須是 0 或正整數。");
  if (!Number.isInteger(definition.numberPadding) || definition.numberPadding < 0) errors.push("補零位數必須是 0 或正整數。");
  for (const value of [definition.start.x, definition.start.y, definition.end.x, definition.end.y]) {
    if (!Number.isFinite(value)) { errors.push("起點與終點座標必須是有效數字。"); break; }
  }
  if (errors.length) return { ok: false, row: null, errors };

  const steps = Math.max(1, definition.slotCount - 1);
  const stepX = (definition.end.x - definition.start.x) / steps;
  const stepY = (definition.end.y - definition.start.y) / steps;
  const slots: BoothSlot[] = [];
  for (let index = 0; index < definition.slotCount; index += 1) {
    const centerX = definition.start.x + stepX * index;
    const centerY = definition.start.y + stepY * index;
    const x = clampToBound(centerX - definition.slotWidth / 2, definition.slotWidth, bounds.width);
    const y = clampToBound(centerY - definition.slotHeight / 2, definition.slotHeight, bounds.height);
    slots.push({
      code: formatSlotCode(definition.codePrefix, definition.startNumber + index, definition.numberPadding),
      rect: { x, y, width: definition.slotWidth, height: definition.slotHeight },
    });
  }
  const duplicate = slots.find((slot, index) => slots.findIndex(({ code }) => code === slot.code) !== index);
  if (duplicate) return { ok: false, row: null, errors: [`這一排會產生重複的攤位代碼 ${duplicate.code}。`] };

  return { ok: true, row: { label, orientation: rowOrientationFromEndpoints(definition.start, definition.end), confidence: 1, slots }, errors: [] };
}

function clampToBound(value: number, size: number, bound: number) {
  return Math.max(0, Math.min(value, Math.max(0, bound - size)));
}

export type SnapGuide = {
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
  targetId: string;
};

type SnapTarget = { id: string; rect: MapRect };
type SnapMode = "move" | ResizeCorner;
type HorizontalEdge = "left" | "right";
type VerticalEdge = "top" | "bottom";

type AxisCandidate<Edge extends string> = {
  delta: number;
  edge: Edge;
  position: number;
  target: SnapTarget;
};

export function resizeRectFromCorner(rect: MapRect, corner: ResizeCorner, dx: number, dy: number, bounds: Pick<MapRect, "width" | "height">, minimumSize = 24): MapRect {
  const originalRight = rect.x + rect.width;
  const originalBottom = rect.y + rect.height;
  const movesLeft = corner === "nw" || corner === "sw";
  const movesTop = corner === "nw" || corner === "ne";
  const left = movesLeft ? Math.max(0, Math.min(rect.x + dx, originalRight - minimumSize)) : rect.x;
  const top = movesTop ? Math.max(0, Math.min(rect.y + dy, originalBottom - minimumSize)) : rect.y;
  const right = movesLeft ? originalRight : Math.min(bounds.width, Math.max(originalRight + dx, rect.x + minimumSize));
  const bottom = movesTop ? originalBottom : Math.min(bounds.height, Math.max(originalBottom + dy, rect.y + minimumSize));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function hasRequiredOverlap(start: number, length: number, targetStart: number, targetLength: number, ratio: number) {
  const overlap = Math.max(0, Math.min(start + length, targetStart + targetLength) - Math.max(start, targetStart));
  return overlap >= Math.min(length, targetLength) * ratio;
}

function nearestCandidate<Edge extends string>(candidates: AxisCandidate<Edge>[], threshold: number) {
  return candidates
    .filter((candidate) => Math.abs(candidate.delta) <= threshold)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.target.id.localeCompare(b.target.id) || a.edge.localeCompare(b.edge))[0];
}

export function snapRectToAdjacentRects(
  rect: MapRect,
  targets: SnapTarget[],
  options: {
    bounds: Pick<MapRect, "width" | "height">;
    mode: SnapMode;
    threshold: number;
    minimumSize?: number;
    overlapRatio?: number;
  },
): { rect: MapRect; guides: SnapGuide[] } {
  const minimumSize = options.minimumSize ?? 24;
  const overlapRatio = options.overlapRatio ?? .25;
  const horizontalEdges: HorizontalEdge[] = options.mode === "move" ? ["left", "right"] : options.mode === "nw" || options.mode === "sw" ? ["left"] : ["right"];
  const verticalEdges: VerticalEdge[] = options.mode === "move" ? ["top", "bottom"] : options.mode === "nw" || options.mode === "ne" ? ["top"] : ["bottom"];
  const horizontalCandidates: AxisCandidate<HorizontalEdge>[] = [];
  const verticalCandidates: AxisCandidate<VerticalEdge>[] = [];

  targets.forEach((target) => {
    if (hasRequiredOverlap(rect.y, rect.height, target.rect.y, target.rect.height, overlapRatio)) {
      if (horizontalEdges.includes("left")) horizontalCandidates.push({ delta: target.rect.x + target.rect.width - rect.x, edge: "left", position: target.rect.x + target.rect.width, target });
      if (horizontalEdges.includes("right")) horizontalCandidates.push({ delta: target.rect.x - (rect.x + rect.width), edge: "right", position: target.rect.x, target });
    }
    if (hasRequiredOverlap(rect.x, rect.width, target.rect.x, target.rect.width, overlapRatio)) {
      if (verticalEdges.includes("top")) verticalCandidates.push({ delta: target.rect.y + target.rect.height - rect.y, edge: "top", position: target.rect.y + target.rect.height, target });
      if (verticalEdges.includes("bottom")) verticalCandidates.push({ delta: target.rect.y - (rect.y + rect.height), edge: "bottom", position: target.rect.y, target });
    }
  });

  const horizontal = nearestCandidate(horizontalCandidates, options.threshold);
  const vertical = nearestCandidate(verticalCandidates, options.threshold);
  const snapped = { ...rect };
  const accepted: { horizontal?: AxisCandidate<HorizontalEdge>; vertical?: AxisCandidate<VerticalEdge> } = {};

  if (horizontal) {
    if (options.mode === "move") snapped.x += horizontal.delta;
    else if (horizontal.edge === "left") { snapped.x += horizontal.delta; snapped.width -= horizontal.delta; }
    else snapped.width += horizontal.delta;
    if (snapped.x >= 0 && (options.mode === "move" || snapped.width >= minimumSize) && snapped.x + snapped.width <= options.bounds.width) accepted.horizontal = horizontal;
    else Object.assign(snapped, { x: rect.x, width: rect.width });
  }

  if (vertical) {
    if (options.mode === "move") snapped.y += vertical.delta;
    else if (vertical.edge === "top") { snapped.y += vertical.delta; snapped.height -= vertical.delta; }
    else snapped.height += vertical.delta;
    if (snapped.y >= 0 && (options.mode === "move" || snapped.height >= minimumSize) && snapped.y + snapped.height <= options.bounds.height) accepted.vertical = vertical;
    else Object.assign(snapped, { y: rect.y, height: rect.height });
  }

  const guides: SnapGuide[] = [];
  if (accepted.horizontal) guides.push({
    axis: "x",
    position: accepted.horizontal.position,
    start: Math.min(snapped.y, accepted.horizontal.target.rect.y),
    end: Math.max(snapped.y + snapped.height, accepted.horizontal.target.rect.y + accepted.horizontal.target.rect.height),
    targetId: accepted.horizontal.target.id,
  });
  if (accepted.vertical) guides.push({
    axis: "y",
    position: accepted.vertical.position,
    start: Math.min(snapped.x, accepted.vertical.target.rect.x),
    end: Math.max(snapped.x + snapped.width, accepted.vertical.target.rect.x + accepted.vertical.target.rect.width),
    targetId: accepted.vertical.target.id,
  });
  return { rect: snapped, guides };
}
