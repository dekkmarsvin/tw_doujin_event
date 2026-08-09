import type { MapRect } from "./event-map";

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

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
