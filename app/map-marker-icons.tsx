import type { MapAccessDirection, MapAccessPoint } from "./event-map";

const ROTATION: Record<MapAccessDirection, number> = { north: 0, east: 90, south: 180, west: 270 };
export const MAP_ENTRANCE_COLOR = "#267cad";
export const MAP_EXIT_COLOR = "#c8493e";

/**
 * An access point's badge in screen pixels around (0, 0), 22px across. An
 * entrance is round and an exit square, so the two differ in shape and not only
 * in colour; the arrow shows which way people walk through it. The map and the
 * facility list draw the same badge.
 */
export function MapAccessBadge({ kind, direction }: Pick<MapAccessPoint, "kind" | "direction">) {
  const fill = kind === "exit" ? MAP_EXIT_COLOR : MAP_ENTRANCE_COLOR;
  return <>
    {kind === "exit"
      ? <rect x={-10} y={-10} width={20} height={20} rx={3} fill={fill} stroke="#fff" strokeWidth={1.5} />
      : <circle r={11} fill={fill} stroke="#fff" strokeWidth={1.5} />}
    <path transform={ROTATION[direction] ? `rotate(${ROTATION[direction]})` : undefined} d="M0 6V-6M-4.5-1.5 0-6.5 4.5-1.5" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </>;
}
