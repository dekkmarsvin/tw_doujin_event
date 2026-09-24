import type { EventMapLayout, MapRect } from "./event-map";
import { clamp, rectFromDrag } from "./map-layout-editor-geometry";

export const FACILITY_TOOLS = ["pillar", "entrance", "exit", "service", "enterprise", "stage", "other"] as const;
export type FacilityTool = typeof FACILITY_TOOLS[number];
export type PlacementTool = "row" | "slot" | "guide-x" | "guide-y" | FacilityTool;
export const PLACEMENT_LABELS: Record<PlacementTool, string> = {
  row: "排／排段", slot: "手動畫攤位", pillar: "柱子", entrance: "入口", exit: "出口", service: "服務設施",
  enterprise: "企業攤", stage: "舞台", other: "其他區域",
  "guide-x": "垂直輔助線", "guide-y": "水平輔助線",
};
export const PLACEMENT_DRAG_THRESHOLD_PX = 3;
type Point = { x: number; y: number };

/** Entrances, exits and service points are points: a click places one. */
export function isPointFacilityTool(tool: FacilityTool | null): tool is "entrance" | "exit" | "service" {
  return tool === "entrance" || tool === "exit" || tool === "service";
}

export function facilityPreview(tool: FacilityTool, point: Point, bounds: Pick<EventMapLayout, "width" | "height">): MapRect {
  const width = bounds.width * (tool === "pillar" ? .03 : .16);
  const height = bounds.height * (tool === "pillar" ? .03 : .1);
  return { x: clamp(point.x - width / 2, 0, bounds.width - width), y: clamp(point.y - height / 2, 0, bounds.height - height), width, height };
}

/** Classify in screen pixels, then create in map coordinates. A tiny jitter is
 * still a click at the original press; a one-dimensional drag creates nothing. */
export function resolveFacilityPlacement(tool: FacilityTool, start: Point, end: Point, screenDelta: Point, bounds: Pick<EventMapLayout, "width" | "height">): MapRect | null {
  const click = Math.hypot(screenDelta.x, screenDelta.y) < PLACEMENT_DRAG_THRESHOLD_PX;
  if (isPointFacilityTool(tool)) {
    return click ? { x: clamp(start.x, 0, bounds.width), y: clamp(start.y, 0, bounds.height), width: 0, height: 0 } : null;
  }
  if (click) return facilityPreview(tool, start, bounds);
  if (Math.abs(screenDelta.x) < PLACEMENT_DRAG_THRESHOLD_PX || Math.abs(screenDelta.y) < PLACEMENT_DRAG_THRESHOLD_PX) return null;
  const rect = rectFromDrag(start, end, bounds);
  return rect.width > 0 && rect.height > 0 ? rect : null;
}
