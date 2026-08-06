export type MapPoint = { x: number; y: number };

export function clampMapZoom(value: number) {
  return Math.max(.35, Math.min(1.8, value));
}

export function zoomOffsetAroundPoint(offset: MapPoint, currentZoom: number, nextZoom: number, point: MapPoint): MapPoint {
  if (currentZoom <= 0 || nextZoom === currentZoom) return offset;
  return {
    x: point.x - (point.x - offset.x) / currentZoom * nextZoom,
    y: point.y - (point.y - offset.y) / currentZoom * nextZoom,
  };
}
