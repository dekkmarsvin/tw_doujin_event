import type { MapRect } from "./event-map";

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

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
