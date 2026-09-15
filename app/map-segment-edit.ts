import type { BoothSlot, EventMapLayout, MapOrientation, MapRect } from "./event-map";
import { clamp, defaultNumberingStart, formatSlotCode, generateRowSlotsFromRect, type RowNumberingStart } from "./map-layout-editor-geometry";

export type SegmentNaming = { codePrefix: string; startNumber: string; endNumber: string; numberPadding: string; orientation: MapOrientation; numberingStart: RowNumberingStart };

/** Items arrive in spatial order. A reversed column therefore stays reversed
 * when reopened, regardless of the logical row's other columns. */
export function segmentNaming(slots: readonly BoothSlot[], orientation: MapOrientation, label: string): SegmentNaming {
  const parsed = slots.map(slot => /^(.*?)(\d+)$/.exec(slot.code));
  const numbers = parsed.map(match => match ? Number(match[2]) : NaN);
  const reversed = numbers.length > 1 && numbers[0] > numbers.at(-1)!;
  const regular = parsed.every(match => match && match[1] === parsed[0]?.[1])
    && numbers.every((number, index) => number === numbers[0] + index * (reversed ? -1 : 1));
  const start = regular ? Math.min(...numbers) : 1;
  const padding = regular ? parsed[0]![2].length : 2;
  return { codePrefix: regular ? parsed[0]![1] : label, startNumber: String(start), endNumber: String(start + slots.length - 1), numberPadding: String(padding), orientation,
    numberingStart: reversed ? orientation === "vertical" ? "bottom" : "right" : defaultNumberingStart(orientation) };
}

/** Clamp the whole frame, keeping its size when moving it against an edge. */
export function editSegmentFrame(frame: MapRect, patch: Partial<MapRect>, bounds: Pick<MapRect, "width" | "height">): MapRect {
  const width = clamp(patch.width ?? frame.width, .5, bounds.width);
  const height = clamp(patch.height ?? frame.height, .5, bounds.height);
  const x = clamp(patch.x ?? frame.x, 0, bounds.width - width);
  const y = clamp(patch.y ?? frame.y, 0, bounds.height - height);
  return { x, y, width, height };
}

/** Replace exactly the selected run. The same generator and duplicate-code
 * boundary used for creation apply; facing columns retain their own bytes. */
export function replaceSegment(layout: EventMapLayout, rowIndex: number, items: readonly number[], frame: MapRect, naming: SegmentNaming):
  { ok: true; layout: EventMapLayout; items: number[] } | { ok: false; errors: string[] } {
  const row = layout.rows[rowIndex];
  if (!row || !items.length || items.some(index => !row.slots[index])) return { ok: false, errors: ["請重新選取排段。"] };
  const startNumber = Number(naming.startNumber), endNumber = Number(naming.endNumber);
  if (!naming.startNumber.trim() || !naming.endNumber.trim() || !Number.isInteger(endNumber)) return { ok: false, errors: ["請輸入有效的起始與結束編號。"] };
  const result = generateRowSlotsFromRect({ ...naming, label: row.label, frame, codePrefix: naming.codePrefix.trim(), startNumber, numberPadding: Number(naming.numberPadding), slotCount: endNumber - startNumber + 1 }, layout);
  if (!result.ok) return { ok: false, errors: result.errors };
  const selected = new Set(items);
  const outsideCodes = new Set(layout.rows.flatMap((item, index) => item.slots.filter((_, position) => index !== rowIndex || !selected.has(position)).map(slot => slot.code)));
  const duplicate = result.row.slots.find(slot => outsideCodes.has(slot.code));
  if (duplicate) return { ok: false, errors: [`攤位代碼 ${duplicate.code} 已被其他排段使用。`] };
  const first = Math.min(...items);
  const next = structuredClone(layout);
  const keptBefore = row.slots.slice(0, first).filter((_, index) => !selected.has(index));
  next.rows[rowIndex].slots = [...keptBefore, ...result.row.slots, ...row.slots.slice(first).filter((_, offset) => !selected.has(first + offset))];
  if (items.length === row.slots.length) next.rows[rowIndex].orientation = naming.orientation;
  return { ok: true, layout: next, items: result.row.slots.map((_, index) => keptBefore.length + index) };
}

export function segmentCodeRange(naming: SegmentNaming) {
  return `${formatSlotCode(naming.codePrefix, Number(naming.startNumber), Number(naming.numberPadding))}–${formatSlotCode(naming.codePrefix, Number(naming.endNumber), Number(naming.numberPadding))}`;
}
