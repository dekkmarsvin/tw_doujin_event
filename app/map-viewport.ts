export type MapPoint = { x: number; y: number };
export type MapSize = { width: number; height: number };
export type MapView = { zoom: number; offset: MapPoint };
export type MapPinchOrigin = { distance: number; zoom: number; mapX: number; mapY: number; center: MapPoint; inset?: MapPoint; boundaryCenter?: MapPoint };
export type MapPinchView = MapView & { boundaryCenter?: MapPoint };
export type MapWheelMode = "pan" | "zoom";

export const MAP_MAX_ZOOM = 6;
export const MAP_MEDIA_ZOOM_THRESHOLD = 1.45;

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

export function centerMapOffset(viewport: MapSize, floor: MapSize, zoom: number, inset: MapPoint = { x: 18, y: 18 }): MapPoint {
  return {
    x: (viewport.width - floor.width * zoom) / 2 - inset.x,
    y: (viewport.height - floor.height * zoom) / 2 - inset.y,
  };
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
