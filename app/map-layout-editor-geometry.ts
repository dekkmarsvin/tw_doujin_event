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

/** A point the contributor marked on the plan, tagged with which booth of the
 * row it sits on. The index is that booth's ordinal, so anchors need not be
 * adjacent or given in order: marking the 1st, 5th and 12th booth is enough. */
export type RowAnchor = { index: number; x: number; y: number };

type RowInference = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  slotCount: number;
  startNumber: number;
  /** How far the worst-placed anchor sits from where the fitted line puts it,
   * in layout units. A large value means an anchor landed on the wrong booth. */
  residual: number;
};

type RowInferenceResult =
  | { ok: true; inference: RowInference; errors: [] }
  | { ok: false; inference: null; errors: string[] };

function fitAxis(indices: readonly number[], values: readonly number[]) {
  const count = indices.length;
  const sumIndex = indices.reduce((total, value) => total + value, 0);
  const sumValue = values.reduce((total, value) => total + value, 0);
  const sumIndexSquared = indices.reduce((total, value) => total + value * value, 0);
  const sumProduct = indices.reduce((total, value, position) => total + value * values[position], 0);
  const slope = (count * sumProduct - sumIndex * sumValue) / (count * sumIndexSquared - sumIndex * sumIndex);
  return { slope, intercept: (sumValue - slope * sumIndex) / count };
}

/** Fits a line through three or more marked booths by least squares on each
 * axis, then extrapolates it to every booth between the lowest and highest
 * anchor ordinal. The result feeds `generateRowSlots` as endpoints and a count,
 * so anchors change how a row is described, not how it is built.
 *
 * Two anchors already determine a line, but three is the smallest number that
 * can disagree: the fit absorbs the imprecision of clicking a booth centre by
 * eye, and `residual` reports how far the worst anchor missed, which is the
 * only signal that one of them was put on the wrong booth.
 *
 * Nothing here knows about any particular venue. It takes marked points and
 * ordinals, so it works on any plan whose booths are evenly spaced along a
 * line, which is what makes a row a row. */
export function inferRowFromAnchors(anchors: readonly RowAnchor[]): RowInferenceResult {
  const errors: string[] = [];
  if (anchors.length < 3) errors.push("至少需要三個錨點。");
  if (anchors.some(({ index }) => !Number.isInteger(index) || index < 0)) errors.push("錨點編號必須是 0 或正整數。");
  if (anchors.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) errors.push("錨點座標必須是有效數字。");
  if (new Set(anchors.map(({ index }) => index)).size !== anchors.length) errors.push("錨點編號不可重複。");
  if (errors.length) return { ok: false, inference: null, errors };

  const indices = anchors.map(({ index }) => index);
  const x = fitAxis(indices, anchors.map((anchor) => anchor.x));
  const y = fitAxis(indices, anchors.map((anchor) => anchor.y));
  const at = (index: number) => ({ x: x.slope * index + x.intercept, y: y.slope * index + y.intercept });
  const startNumber = Math.min(...indices);
  const endNumber = Math.max(...indices);
  const residual = Math.max(...anchors.map((anchor) => Math.hypot(at(anchor.index).x - anchor.x, at(anchor.index).y - anchor.y)));
  return { ok: true, inference: { start: at(startNumber), end: at(endNumber), slotCount: endNumber - startNumber + 1, startNumber, residual }, errors: [] };
}

export type RowDraft = { slots: BoothSlot[]; keep: boolean[] };

/** Turns a pointer drag into a canvas-bounded rectangle. Pointer capture keeps
 * reporting coordinates after the pointer leaves the SVG, so both endpoints
 * are clamped before the rectangle is built. */
export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: Pick<MapRect, "width" | "height">,
): MapRect {
  const startX = Math.max(0, Math.min(bounds.width, start.x));
  const startY = Math.max(0, Math.min(bounds.height, start.y));
  const endX = Math.max(0, Math.min(bounds.width, end.x));
  const endY = Math.max(0, Math.min(bounds.height, end.y));
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/** The booths an inferred draft still carries after the contributor went
 * through it. An inferred row is never written into the layout as a whole:
 * only what survives this filter is committed, so a booth nobody looked at
 * cannot reach a submission. */
export function confirmedDraftSlots(draft: RowDraft): BoothSlot[] {
  return draft.slots.filter((slot, index) => draft.keep[index]);
}

type RowGenerationResult =
  | { ok: true; row: BoothRow; errors: [] }
  | { ok: false; row: null; errors: string[] };

/** A row that spans further across than down is horizontal. A row with no
 * extent at all — a single booth, or coincident endpoints — is called vertical,
 * matching how every recognized row so far is stored. */
export function rowOrientationFromEndpoints(start: { x: number; y: number }, end: { x: number; y: number }): MapOrientation {
  return Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? "horizontal" : "vertical";
}

/** The long axis of a drawn rectangle, by the same rule endpoints use, so a tall
 * frame proposes a vertical row and a wide one a horizontal row. */
export function rowOrientationFromRect(rect: MapRect): MapOrientation {
  return rowOrientationFromEndpoints({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height });
}

export function formatSlotCode(prefix: string, value: number, padding: number) {
  return `${prefix}${String(value).padStart(Math.max(0, padding), "0")}`;
}

/** The checks every way of describing a row shares: what it is called, how many
 * booths it holds and how they are numbered. Geometry is left to the caller,
 * because a pair of endpoints and a drawn rectangle describe it differently. */
function rowNamingErrors(definition: Pick<RowDefinition, "label" | "slotCount" | "startNumber" | "numberPadding">) {
  const errors: string[] = [];
  if (!definition.label.trim()) errors.push("排標籤不可留空。");
  if (!Number.isInteger(definition.slotCount) || definition.slotCount < 1) errors.push("格數必須是大於 0 的整數。");
  if (!Number.isInteger(definition.startNumber) || definition.startNumber < 0) errors.push("起始編號必須是 0 或正整數。");
  if (!Number.isInteger(definition.numberPadding) || definition.numberPadding < 0) errors.push("補零位數必須是 0 或正整數。");
  return errors;
}

/** Evenly distributes `slotCount` booth rectangles between the two endpoints.
 * Each rectangle is centred on its step, so a row reads the same whether it was
 * traced left-to-right or right-to-left.
 *
 * Centre pitch and booth size are two separate inputs here, which is why this is
 * no longer the ordinary way to add a row: values that do not match leave gaps
 * or overlaps. It stays for the rows one rectangle cannot describe — a slanted
 * row, or one whose booths are deliberately spaced apart. */
export function generateRowSlots(definition: RowDefinition, bounds: Pick<MapRect, "width" | "height">): RowGenerationResult {
  const errors = rowNamingErrors(definition);
  const label = definition.label.trim();
  if (!(definition.slotWidth > 0) || !(definition.slotHeight > 0)) errors.push("每格寬高必須大於 0。");
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

/** Which end of the drawn segment carries the lowest booth number. A vertical
 * segment is numbered from its top or its bottom, a horizontal one from its left
 * or its right, which is enough for the two facing sides of one aisle to run in
 * opposite directions while sharing a row label. */
export type RowNumberingStart = "top" | "bottom" | "left" | "right";

/** A segment described the way it is drawn: one rectangle around the whole run
 * of booths, cut into `slotCount` equal pieces. The rectangle is the outline
 * rather than a pair of centres, so booth size follows from the drawing instead
 * of being a second number that has to be made to agree with it. */
export type RowFrameDefinition = {
  label: string;
  frame: MapRect;
  orientation: MapOrientation;
  slotCount: number;
  numberingStart: RowNumberingStart;
  codePrefix: string;
  startNumber: number;
  numberPadding: number;
};

/** Cuts a run of length `total` into `count` pieces that touch exactly: every
 * piece begins where the previous one ended. Each cut is measured from the start
 * of the run rather than by adding up the pieces, so a long row cannot drift.
 *
 * A booth is stored as a start and a size, and `a + (b - a)` can round just past
 * `b`. One unit in the last place is enough for the overlap check in
 * `map-contribution-draft.ts` — which counts a shared edge as fine and any true
 * intersection as a problem — to reject the row, so the size is stepped down
 * until the next booth cannot begin inside this one. */
export function seamlessSpans(start: number, total: number, count: number): { start: number; size: number }[] {
  const edges = Array.from({ length: count + 1 }, (unused, index) => start + total * index / count);
  return edges.slice(0, count).map((edge, index) => {
    let size = edges[index + 1] - edge;
    for (let guard = 0; guard < 4 && edge + size > edges[index + 1]; guard += 1) size -= Math.abs(size) * Number.EPSILON;
    return { start: edge, size: Math.max(0, size) };
  });
}

/** Turns one drawn rectangle into a segment of booths. This is the ordinary way
 * a row is added: the contributor traces the run on the plan and says how many
 * booths are in it, and neither coordinates nor booth size is typed in.
 *
 * Numbering runs from `numberingStart` towards the other end, which changes the
 * order the codes are handed out in and nothing else — the rectangles are the
 * same either way, and nothing is added to the stored layout to record it. */
export function generateRowSlotsFromRect(definition: RowFrameDefinition, bounds: Pick<MapRect, "width" | "height">): RowGenerationResult {
  const errors = rowNamingErrors(definition);
  const label = definition.label.trim();
  const vertical = definition.orientation === "vertical";
  if (!(vertical ? ["top", "bottom"] : ["left", "right"]).includes(definition.numberingStart)) {
    errors.push(vertical ? "直排的編號起點必須是上或下。" : "橫排的編號起點必須是左或右。");
  }
  const drawn = definition.frame;
  if ([drawn.x, drawn.y, drawn.width, drawn.height].some((value) => !Number.isFinite(value))) errors.push("框選範圍必須是有效數字。");
  if (errors.length) return { ok: false, row: null, errors };

  // A pointer drag is clamped to the sheet already, but a rectangle that
  // survived a canvas resize, or arrived from a field, need not be.
  const left = clamp(drawn.x, 0, bounds.width);
  const top = clamp(drawn.y, 0, bounds.height);
  const frame = {
    x: left,
    y: top,
    width: clamp(drawn.x + drawn.width, 0, bounds.width) - left,
    height: clamp(drawn.y + drawn.height, 0, bounds.height) - top,
  };
  if (!(frame.width > 0) || !(frame.height > 0)) return { ok: false, row: null, errors: ["框選範圍的寬與高都必須大於 0。"] };

  const spans = seamlessSpans(vertical ? frame.y : frame.x, vertical ? frame.height : frame.width, definition.slotCount);
  const reversed = definition.numberingStart === "bottom" || definition.numberingStart === "right";
  const slots: BoothSlot[] = spans.map((span, index) => ({
    code: formatSlotCode(definition.codePrefix, definition.startNumber + (reversed ? definition.slotCount - 1 - index : index), definition.numberPadding),
    rect: vertical
      ? { x: frame.x, y: span.start, width: frame.width, height: span.size }
      : { x: span.start, y: frame.y, width: span.size, height: frame.height },
  }));
  return { ok: true, row: { label, orientation: definition.orientation, confidence: 1, slots }, errors: [] };
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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
  // Recognition traces the plan's own line spacing, so a real slot is routinely
  // shorter than the handle-sized minimum. Floor each axis at whatever it already
  // measures: a corner grab must never enlarge the rectangle it is there to edit.
  const minWidth = Math.min(minimumSize, rect.width);
  const minHeight = Math.min(minimumSize, rect.height);
  const left = movesLeft ? Math.max(0, Math.min(rect.x + dx, originalRight - minWidth)) : rect.x;
  const top = movesTop ? Math.max(0, Math.min(rect.y + dy, originalBottom - minHeight)) : rect.y;
  const right = movesLeft ? originalRight : Math.min(bounds.width, Math.max(originalRight + dx, rect.x + minWidth));
  const bottom = movesTop ? originalBottom : Math.min(bounds.height, Math.max(originalBottom + dy, rect.y + minHeight));
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
