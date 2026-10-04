import type { MapAccessDirection, MapAccessPoint, MapServicePointKind, MapSpaceMark } from "./event-map";
import type { CSSProperties } from "react";
import type { MapMarkerLabel, MapMarkerPresentation } from "./map-marker-presentation";

const ROTATION: Record<MapAccessDirection, number> = { north: 0, east: 90, south: 180, west: 270 };
export const MAP_ENTRANCE_COLOR = "#267cad";
export const MAP_EXIT_COLOR = "#c8493e";
export const MAP_BOTH_WAYS_COLOR = "#5b5fa8";
export const MAP_SERVICE_COLOR = "#2e6b5a";

const glyph = { fill: "none", stroke: "#fff", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * An access point's badge in screen pixels around (0, 0), about 22px across.
 * An entrance is round, an exit square and a doorway used both ways a diamond,
 * so they differ in shape and not only in colour; the arrow shows which way
 * people walk through it. A doorway used both ways carries two arrows side by
 * side, one in and one out, rather than one line headed at both ends, which
 * read as up-and-down and sat too close to the elevator badge. The map, the
 * editor and the facility list draw the same badge.
 */
export function MapAccessBadge({ kind, direction }: Pick<MapAccessPoint, "kind" | "direction">) {
  const rotation = ROTATION[direction] ? `rotate(${ROTATION[direction]})` : undefined;
  if (kind === "both") return <>
    <path d="M0-11.5 11.5 0 0 11.5-11.5 0Z" fill={MAP_BOTH_WAYS_COLOR} stroke="#fff" strokeWidth={1.5} />
    <path transform={rotation} d="M-3 5.5V-5.5M-6-2.5-3-5.5 0-2.5M3-5.5V5.5M0 2.5 3 5.5 6 2.5" {...glyph} strokeWidth={2} />
  </>;
  return <>
    {kind === "exit"
      ? <rect x={-10} y={-10} width={20} height={20} rx={3} fill={MAP_EXIT_COLOR} stroke="#fff" strokeWidth={1.5} />
      : <circle r={11} fill={MAP_ENTRANCE_COLOR} stroke="#fff" strokeWidth={1.5} />}
    <path transform={rotation} d="M0 6V-6M-4.5-1.5 0-6.5 4.5-1.5" {...glyph} />
  </>;
}

/** A service point's badge, 21px across: one rounded square for every service,
 * told apart by the pictogram inside it rather than by colour. */
export function MapServiceBadge({ kind }: { kind: MapServicePointKind }) {
  return <>
    <rect x={-10.5} y={-10.5} width={21} height={21} rx={5} fill={MAP_SERVICE_COLOR} stroke="#fff" strokeWidth={1.5} />
    {kind === "toilet" && <text x={0} y={.5} fill="#fff" fontSize={9} fontWeight={800} textAnchor="middle" dominantBaseline="central" fontFamily="system-ui, sans-serif">WC</text>}
    {kind === "accessible-toilet" && <>
      <circle cx={-1.2} cy={-6} r={1.6} fill="#fff" />
      <path d="M-1.4-3.4V1.4H3.2L4.8 5.4M-1.4-.8H2.4M-3.6-1A4.3 4.3 0 1 0 2.4 4.4" {...glyph} strokeWidth={1.8} />
    </>}
    {kind === "information" && <>
      <circle cx={0} cy={-5.2} r={1.6} fill="#fff" />
      <path d="M0-1.8V5.8" {...glyph} strokeWidth={2.6} />
    </>}
    {kind === "cloakroom" && <path d="M-1.6-4.6A1.7 1.7 0 1 1 0-2.9V-1.8L-7 3.8H7L0-1.8" {...glyph} strokeWidth={1.8} />}
    {kind === "first-aid" && <path d="M0-6V6M-6 0H6" {...glyph} strokeWidth={3.2} strokeLinecap="butt" />}
    {kind === "stairs" && <path d="M-7 6H-3.5V2.5H0V-1H3.5V-4.5H7" {...glyph} strokeWidth={2} />}
    {kind === "elevator" && <path d="M-3.5-1.5 0-6 3.5-1.5ZM-3.5 1.5 0 6 3.5 1.5Z" fill="#fff" />}
    {kind === "ticket-office" && <>
      <path d="M-7-5H7V-2A2 2 0 0 0 7 2V5H-7V2A2 2 0 0 0-7-2Z" {...glyph} strokeWidth={1.6} />
      <path d="M2-3V-2M2-.5V.5M2 2V3" {...glyph} strokeWidth={1.3} />
    </>}
    {kind === "changing-room" && <path d="M-3-6A3 3 0 0 0 3-6L7-3 5 0 3-1V6H-3V-1L-5 0-7-3Z" {...glyph} strokeWidth={1.6} />}
  </>;
}

/** Passive table annotations share their shape in the editor and Reader. Text
 * stays within the table; dashed edges and an X distinguish them at overview. */
export function MapSpaceMarkDrawing({ mark, presentation = { screenScale: 1, fontScale: 1 } }: { mark: MapSpaceMark; presentation?: MapMarkerPresentation }) {
  const { rect, kind } = mark;
  const scale = presentation.screenScale > 0 ? presentation.screenScale : 1;
  const labelPx = Math.min(12 * presentation.fontScale, Math.max(7 * presentation.fontScale, 7 * scale));
  const fontSize = Math.min(labelPx / scale, rect.width / 2.4, rect.height * .45);
  const inset = Math.min(rect.width, rect.height) * .15;
  return <>
    <rect {...rect} fill="#f3f2ed" stroke="#7d7b76" strokeWidth={1} strokeDasharray={kind === "reserved" ? "3 2" : undefined} vectorEffect="non-scaling-stroke" />
    {kind === "cancelled" && <path d={`M${rect.x + inset} ${rect.y + inset}L${rect.x + rect.width - inset} ${rect.y + rect.height - inset}M${rect.x + rect.width - inset} ${rect.y + inset}L${rect.x + inset} ${rect.y + rect.height - inset}`} fill="none" stroke="#6d6b66" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2} style={{ fontSize, textAnchor: "middle", dominantBaseline: "central", fill: "#6d6b66", stroke: "#f3f2ed", strokeWidth: 2 / scale, paintOrder: "stroke", fontWeight: 700, pointerEvents: "none" }}>{kind === "reserved" ? "空桌" : "取消"}</text>
  </>;
}

/** A placed name. An area name on several lines stays centred on its anchor,
 * so a stack of single characters reads as vertical text. */
export function MapMarkerText({ label, className, style }: { label: MapMarkerLabel; className?: string; style?: CSSProperties }) {
  const lines = label.lines;
  return <text className={className} x={label.dx} y={label.dy} textAnchor={label.anchor} style={{ fontSize: label.fontPx, ...style }}>
    {lines ? lines.map((line, index) => <tspan key={index} x={label.dx} dy={`${index ? 1.2 : -(lines.length - 1) * .6}em`}>{line}</tspan>) : label.text}
  </text>;
}
