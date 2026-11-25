type MapPoint = { x: number; y: number };
type MapSize = { width: number; height: number };
export type MapRect = MapSize & MapPoint;

/**
 * Height of the collapsed selection row above the mobile workspace entries. The
 * snap points, the fit reservation and the stylesheet all describe the same
 * strip, so they read this one value — the CSS through the `--mobile-peek-summary`
 * custom property the shell publishes.
 */
export const MOBILE_SUMMARY_PEEK_HEIGHT = 58;

/** All bounds use map-local CSS pixels, never layout or device pixels. */
export function availableMapRect(viewport: MapSize, obstacles: { top?: MapRect; bottom?: MapRect; detail?: MapRect } = {}): MapRect {
  const clampX = (x: number) => Math.max(0, Math.min(viewport.width, x));
  const clampY = (y: number) => Math.max(0, Math.min(viewport.height, y));
  const x = clampX(16);
  const y = clampY(obstacles.top ? obstacles.top.y + obstacles.top.height + 16 : 16);
  const right = clampX(obstacles.detail ? obstacles.detail.x - 16 : viewport.width - 16);
  const bottom = clampY(obstacles.bottom ? obstacles.bottom.y - 16 : viewport.height - 16);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Mobile controls sit on the right; the sheet covers the bottom. */
export function mobileAvailableMapRect(viewport: MapSize, obstacles: { top?: MapRect; bottom?: MapRect; controls?: MapRect } = {}): MapRect {
  const rect = availableMapRect(viewport, { top: obstacles.top, bottom: obstacles.bottom });
  const right = obstacles.controls ? Math.min(rect.x + rect.width, obstacles.controls.x - 12) : rect.x + rect.width;
  return { ...rect, width: Math.max(0, right - rect.x) };
}

export function offsetMapPointInRect(point: MapPoint, rect: MapRect, zoom: number, inset: MapPoint): MapPoint {
  return { x: rect.x + rect.width / 2 - inset.x - point.x * zoom, y: rect.y + rect.height / 2 - inset.y - point.y * zoom };
}

export function fitMapInRect(rect: MapRect, floor: MapSize, inset: MapPoint): MapView | null {
  if (rect.width <= 72 || rect.height <= 72 || floor.width <= 0 || floor.height <= 0) return null;
  // The rect already keeps a 16px gap from the map edges and the floating
  // tools, so a second padding would only shrink the floor for no reason.
  const zoom = calculateMapFitZoom(rect, floor, 0);
  return { zoom, offset: offsetMapPointInRect({ x: floor.width / 2, y: floor.height / 2 }, rect, zoom, inset) };
}

/** Preserve the layout point at the old viewport center across a resize. */
export function resizeMapView(view: MapView, before: MapSize, after: MapSize, minimum: number, inset: MapPoint, previousInset = inset): MapView {
  const point = { x: (before.width / 2 - previousInset.x - view.offset.x) / view.zoom, y: (before.height / 2 - previousInset.y - view.offset.y) / view.zoom };
  const zoom = clampMapZoom(view.zoom, minimum);
  return { zoom, offset: offsetMapPointInRect(point, { x: 0, y: 0, ...after }, zoom, inset) };
}
export type MapView = { zoom: number; offset: MapPoint };
export type MapPinchOrigin = { distance: number; zoom: number; mapX: number; mapY: number; center: MapPoint; inset?: MapPoint; boundaryCenter?: MapPoint; startedAtMinimum?: boolean };
type MapPinchView = MapView & { boundaryCenter?: MapPoint };
type MapWheelMode = "pan" | "zoom";

const MAP_MAX_ZOOM = 6;
const MAP_MEDIA_ZOOM_THRESHOLD = 1.45;
export const MAP_MINIMUM_ZOOM_EPSILON = 0.006;
export const MAP_OVERVIEW_WHEEL_GAP_MS = 280;
export const MAP_OVERVIEW_WHEEL_THRESHOLD = 120;
export const MAP_OVERVIEW_PINCH_RATIO = 0.86;

export type WheelOverviewState = {
  active: boolean;
  startedAtMinimum: boolean;
  accumulated: number;
  lastAt: number;
};

export const INITIAL_WHEEL_OVERVIEW_STATE: WheelOverviewState = {
  active: false,
  startedAtMinimum: false,
  accumulated: 0,
  lastAt: 0,
};

export function isAtMinimumZoom(zoom: number, minimum: number) {
  return minimum > 0 && zoom <= minimum + MAP_MINIMUM_ZOOM_EPSILON;
}

/**
 * Tracks a single wheel gesture with one pause boundary (`280ms`): momentum
 * zooming out from a higher magnification stops at `fit`, and only a fresh
 * zoom-out gesture starting at minimum zoom enters the venue overview once it
 * accumulates `120` px.
 */
export function stepWheelOverviewGesture(
  state: WheelOverviewState,
  input: { now: number; deltaY: number; zoom: number; minimum: number },
): { state: WheelOverviewState; enterOverview: boolean } {
  const isNewGesture = !state.active || input.now - state.lastAt > MAP_OVERVIEW_WHEEL_GAP_MS;
  const startedAtMinimum = isNewGesture ? isAtMinimumZoom(input.zoom, input.minimum) : state.startedAtMinimum;
  const accumulatedBase = isNewGesture ? 0 : state.accumulated;

  if (input.deltaY <= 0) {
    return {
      state: { active: true, startedAtMinimum: false, accumulated: 0, lastAt: input.now },
      enterOverview: false,
    };
  }
  if (!startedAtMinimum || !isAtMinimumZoom(input.zoom, input.minimum)) {
    return {
      state: { active: true, startedAtMinimum, accumulated: 0, lastAt: input.now },
      enterOverview: false,
    };
  }
  const accumulated = accumulatedBase + input.deltaY;
  if (accumulated >= MAP_OVERVIEW_WHEEL_THRESHOLD) {
    return { state: INITIAL_WHEEL_OVERVIEW_STATE, enterOverview: true };
  }
  return {
    state: { active: true, startedAtMinimum: true, accumulated, lastAt: input.now },
    enterOverview: false,
  };
}

export function shouldEnterOverviewFromPinch(origin: MapPinchOrigin, distance: number, minimum: number) {
  if (!origin.startedAtMinimum || minimum <= 0) return false;
  const requestedZoom = origin.zoom * distance / Math.max(1, origin.distance);
  return requestedZoom <= minimum * MAP_OVERVIEW_PINCH_RATIO;
}

export function clampMapZoom(value: number, minimum = .35, maximum = MAP_MAX_ZOOM) {
  return Math.max(Math.min(minimum, maximum), Math.min(maximum, value));
}

/** Smallest zoom that keeps the complete floor inside the viewport. */
export function calculateMapFitZoom(viewport: MapSize, floor: MapSize, padding = 36) {
  if (viewport.width <= 0 || viewport.height <= 0 || floor.width <= 0 || floor.height <= 0) return 1;
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  return Math.min(MAP_MAX_ZOOM, usableWidth / floor.width, usableHeight / floor.height);
}

export function shouldShowMapMedia(zoom: number) {
  return zoom >= MAP_MEDIA_ZOOM_THRESHOLD;
}

export function zoomOffsetAroundPoint(offset: MapPoint, currentZoom: number, nextZoom: number, point: MapPoint, inset: MapPoint = { x: 0, y: 0 }): MapPoint {
  if (currentZoom <= 0 || nextZoom === currentZoom) return offset;
  return {
    x: point.x - inset.x - (point.x - inset.x - offset.x) / currentZoom * nextZoom,
    y: point.y - inset.y - (point.y - inset.y - offset.y) / currentZoom * nextZoom,
  };
}

export function calculatePinchMapView(origin: MapPinchOrigin, distance: number, center: MapPoint, minimum = .35, maximum = MAP_MAX_ZOOM): MapPinchView {
  const requestedZoom = origin.zoom * distance / Math.max(1, origin.distance);
  const zoom = clampMapZoom(requestedZoom, minimum, maximum);
  const constrained = requestedZoom <= Math.min(minimum, maximum) || requestedZoom >= Math.max(minimum, maximum);
  const boundaryCenter = constrained ? origin.boundaryCenter ?? center : undefined;
  const anchor = boundaryCenter ?? center;
  return {
    zoom,
    offset: {
      x: anchor.x - (origin.inset?.x ?? 0) - origin.mapX * zoom,
      y: anchor.y - (origin.inset?.y ?? 0) - origin.mapY * zoom,
    },
    ...(boundaryCenter ? { boundaryCenter } : {}),
  };
}

export function mapViewFromWheel(
  view: MapView,
  delta: MapPoint,
  point: MapPoint,
  minimumZoom: number,
  mode: MapWheelMode,
  inset: MapPoint = { x: 0, y: 0 },
): MapView {
  if (mode === "pan") {
    return {
      zoom: view.zoom,
      offset: { x: view.offset.x - delta.x, y: view.offset.y - delta.y },
    };
  }

  const zoom = clampMapZoom(+(view.zoom * Math.exp(-delta.y * .0012)).toFixed(3), minimumZoom);
  if (zoom === view.zoom) return view;
  return { zoom, offset: zoomOffsetAroundPoint(view.offset, view.zoom, zoom, point, inset) };
}
