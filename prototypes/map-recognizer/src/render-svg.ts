/**
 * Draws a recognised layout as a standalone SVG in the plan's own pixel
 * space, so it can sit exactly over the uploaded image for comparison.
 *
 * Rows that need a person's check are marked by both fill and a dashed
 * outline, never by colour alone.
 */
import { rowLabelAnchor, type EventMapLayout } from "../../../app/event-map";

const escape = (text: string) => text.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const n = (value: number) => Math.round(value * 10) / 10;

/** Rows below this are drawn as needing a check. */
export const CHECK_THRESHOLD = 0.5;

export function renderLayoutSvg(layout: EventMapLayout): string {
  const parts: string[] = [];
  const cellShort = (() => {
    const sides = layout.rows.flatMap((row) => row.slots.map((slot) => Math.min(slot.rect.width, slot.rect.height))).sort((a, b) => a - b);
    return sides.length ? sides[sides.length >> 1] : 12;
  })();
  const { floor } = layout;
  parts.push(`<rect class="floor" x="${n(floor.x)}" y="${n(floor.y)}" width="${n(floor.width)}" height="${n(floor.height)}"/>`);
  for (const landmark of layout.landmarks) {
    const { rect } = landmark;
    const size = Math.max(8, Math.min(cellShort * 1.2, rect.height * 0.3, (rect.width / Math.max(1, landmark.label.length)) * 0.9));
    parts.push(`<g class="landmark"><rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"/><text x="${n(rect.x + rect.width / 2)}" y="${n(rect.y + rect.height / 2)}" font-size="${n(size)}">${escape(landmark.label)}</text></g>`);
  }
  for (const pillar of layout.pillars) parts.push(`<rect class="pillar" x="${n(pillar.x)}" y="${n(pillar.y)}" width="${n(pillar.width)}" height="${n(pillar.height)}"/>`);
  for (const row of layout.rows) {
    const check = row.confidence < CHECK_THRESHOLD || row.label.startsWith("?");
    parts.push(`<g class="row${check ? " check" : ""}" data-row="${escape(row.label)}">`);
    for (const slot of row.slots) {
      const { rect } = slot;
      const text = slot.code.startsWith(row.label) ? slot.code.slice(row.label.length).replace(/^[-_]/u, "") || slot.code : slot.code;
      const size = Math.max(3, Math.min(rect.height * 0.55, (rect.width / Math.max(1, text.length)) * 1.45));
      parts.push(`<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"><title>${escape(slot.code)}</title></rect><text x="${n(rect.x + rect.width / 2)}" y="${n(rect.y + rect.height / 2)}" font-size="${n(size)}">${escape(text)}</text>`);
    }
    const anchor = rowLabelAnchor(row);
    if (anchor) parts.push(`<text class="row-label" x="${n(anchor.x)}" y="${n(anchor.y)}" font-size="${n(Math.max(10, Math.min(22, cellShort * 1.4)))}">${escape(row.label)}</text>`);
    parts.push("</g>");
  }
  const arrowSize = Math.max(10, cellShort);
  for (const point of layout.accessPoints) {
    const rotate = { north: 0, east: 90, south: 180, west: 270 }[point.direction];
    const s = arrowSize;
    parts.push(`<g class="door ${point.kind}"><path d="M ${n(point.x)} ${n(point.y - s)} L ${n(point.x + s * 0.6)} ${n(point.y)} L ${n(point.x - s * 0.6)} ${n(point.y)} Z" transform="rotate(${rotate}, ${n(point.x)}, ${n(point.y)})"/><text x="${n(point.x)}" y="${n(point.y + s * 0.9)}" font-size="${n(s * 0.8)}">${escape(point.label)}</text></g>`);
  }
  const style = `
    .floor { fill: #faf8f3; stroke: #b9b1a3; stroke-width: 1.5; }
    .landmark rect { fill: #e7e2d8; stroke: #9c9486; stroke-width: 1; }
    .landmark text, .row text, .door text { text-anchor: middle; dominant-baseline: central; font-family: system-ui, sans-serif; fill: #2b2926; }
    .pillar { fill: #3b3935; }
    .row rect { fill: #d8efdd; stroke: #3f6e4b; stroke-width: 0.8; }
    .row.check rect { fill: #fde7c7; stroke: #a0521d; stroke-dasharray: 3 2; }
    .row-label { font-weight: 700; fill: #1f1d1a; }
    .door path { fill: #b3261e; }
    .door.exit path { fill: #6d4c9f; }`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"><style>${style}</style>${parts.join("")}</svg>`;
}
