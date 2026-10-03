import { pathArrowhead, type MapNote, type MapPath } from "./map-annotations";
import { mapLabelFontSize } from "./map-label-presentation";
import type { MapMarkerPresentation } from "./map-marker-presentation";

/** Same drawing in authoring and the Reader. Text is fitted to the author's
 * rectangle, so larger Reader text stays inside the space checked for publication. */
export function MapNoteDrawing({ note, presentation = { screenScale: 1, fontScale: 1 } }: { note: MapNote; presentation?: MapMarkerPresentation }) {
  const lines = note.text.split("\n");
  const scale = presentation.screenScale > 0 ? presentation.screenScale : 1;
  const fontSize = mapLabelFontSize({ width: note.rect.width, height: note.rect.height / (1 + (lines.length - 1) * 1.3) }, lines.reduce((longest, line) => [...line].length > [...longest].length ? line : longest, ""), false, { screenScale: scale, targetPx: 16 * presentation.fontScale, paddingPx: 2 }) ?? 1;
  return <g data-note-id={note.id} role="img" aria-label={note.text} fill="#354b42" pointerEvents="none"><title>{note.text}</title>{lines.map((line, index) => <text key={index} x={note.rect.x + note.rect.width / 2} y={note.rect.y + note.rect.height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.3} textAnchor="middle" dominantBaseline="central" style={{ fontSize, fontWeight: 600 }}>{line}</text>)}</g>;
}

export function MapPathDrawing({ path }: { path: MapPath }) {
  const head = pathArrowhead(path);
  if (head.length !== 3) return null;
  return <g data-path-id={path.id} role="img" aria-label="動線箭頭" pointerEvents="none" fill="none" stroke="#476858" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>動線箭頭</title><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(" ")} /><polyline points={head.map(point => `${point.x},${point.y}`).join(" ")} /></g>;
}
