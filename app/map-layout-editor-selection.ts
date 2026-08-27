import { resolveMapLandmarkKind, type BoothRow, type BoothSlot, type EventMapLayout, type MapRect } from "./event-map";
import { rowOrientationFromEndpoints } from "./map-layout-editor-geometry";

export type Selection =
  | { kind: "floor" }
  | { kind: "slot"; rowIndex: number; itemIndex: number }
  | { kind: "pillar"; itemIndex: number }
  | { kind: "access"; itemIndex: number }
  | { kind: "landmark"; itemIndex: number };

/** Everything except an access point is a rectangle, so moving, corner resizing
 * and the coordinate fields all take one path. */
export type RectSelection = Exclude<Selection, { kind: "access" }>;
export type SlotSelection = Extract<Selection, { kind: "slot" }>;
export type AlignEdge = "left" | "right" | "top" | "bottom";

type Bounds = Pick<MapRect, "width" | "height">;
type RowsOnly = Pick<EventMapLayout, "rows">;

export function selectionKey(selection: Selection) {
  if (selection.kind === "floor") return "floor";
  return `${selection.kind}:${selection.kind === "slot" ? `${selection.rowIndex}:` : ""}${selection.itemIndex}`;
}

/** Coalescing key for a whole selection. Sorting makes the key independent of
 * selection order while naming every member keeps different sets from merging
 * into one undo step. Callers should compute it once when a gesture begins. */
export function selectionSetKey(selections: readonly Selection[]) {
  if (!selections.length) return "none";
  const keys = selections.map(selectionKey).sort();
  return keys.length === 1 ? keys[0] : `set:${keys.join(",")}`;
}

export function sameSelection(a: Selection, b: Selection) {
  return selectionKey(a) === selectionKey(b);
}

/** Adds `next` to `current` when it is absent and drops it when it is present,
 * which is what a Shift-click on a booth means. */
export function toggleSelection(current: readonly Selection[], next: Selection): Selection[] {
  return current.some((item) => sameSelection(item, next)) ? current.filter((item) => !sameSelection(item, next)) : [...current, next];
}

export function mergeSelections(current: readonly Selection[], added: readonly Selection[]): Selection[] {
  return [...current, ...added.filter((item) => !current.some((existing) => sameSelection(existing, item)))];
}

/** The rectangle as it lives inside `layout`, so a caller holding a draft edits
 * the element in place. */
export function rectFor(layout: EventMapLayout, selection: RectSelection): MapRect | undefined {
  if (selection.kind === "slot") return layout.rows[selection.rowIndex]?.slots[selection.itemIndex]?.rect;
  if (selection.kind === "pillar") return layout.pillars[selection.itemIndex];
  if (selection.kind === "landmark") return layout.landmarks[selection.itemIndex]?.rect;
  return layout.floor;
}

/** A detached box for any element, so batch moves, alignment and box selection
 * treat an access point as a zero-sized rectangle instead of a special case. */
export function boxFor(layout: EventMapLayout, selection: Selection): MapRect | undefined {
  if (selection.kind === "access") {
    const point = layout.accessPoints[selection.itemIndex];
    return point && { x: point.x, y: point.y, width: 0, height: 0 };
  }
  const rect = rectFor(layout, selection);
  return rect && { ...rect };
}

/** Selections and their boxes stay index-parallel: an element that is no longer
 * there drops out of both lists at once. */
export function resolveSelectionBoxes(layout: EventMapLayout, selections: readonly Selection[]) {
  const resolved = selections
    .map((selection) => ({ selection, box: boxFor(layout, selection) }))
    .filter((entry): entry is { selection: Selection; box: MapRect } => !!entry.box);
  return { selections: resolved.map(({ selection }) => selection), boxes: resolved.map(({ box }) => box) };
}

export function applySelectionBoxes(draft: EventMapLayout, selections: readonly Selection[], boxes: readonly MapRect[]) {
  selections.forEach((selection, index) => {
    const box = boxes[index];
    if (!box) return;
    if (selection.kind === "access") {
      const point = draft.accessPoints[selection.itemIndex];
      if (!point) return;
      point.x = clampValue(box.x, 0, draft.width);
      point.y = clampValue(box.y, 0, draft.height);
      return;
    }
    const rect = rectFor(draft, selection);
    if (rect) Object.assign(rect, box);
  });
}

export function boundingBox(boxes: readonly MapRect[]): MapRect {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x, y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampBoxWithin(box: MapRect, bounds: Bounds): MapRect {
  const width = Math.min(box.width, bounds.width);
  const height = Math.min(box.height, bounds.height);
  return { x: clampValue(box.x, 0, Math.max(0, bounds.width - width)), y: clampValue(box.y, 0, Math.max(0, bounds.height - height)), width, height };
}

/** Moves the whole group by one shared delta, shortened so the group's outer
 * edges stop at the canvas. Clamping each box on its own would squash the
 * relative spacing that makes a row a row. */
export function translateBoxesWithin(boxes: readonly MapRect[], dx: number, dy: number, bounds: Bounds): MapRect[] {
  if (!boxes.length) return [];
  const box = boundingBox(boxes);
  const shiftX = clampValue(dx, -box.x, Math.max(0, bounds.width - (box.x + box.width)));
  const shiftY = clampValue(dy, -box.y, Math.max(0, bounds.height - (box.y + box.height)));
  return boxes.map((item) => ({ ...item, x: item.x + shiftX, y: item.y + shiftY }));
}

/** Aligns every box to the named edge of the group's own bounding box, so an
 * alignment can never push an element past a canvas edge the group was already
 * inside. The clamp covers the boxes that arrived out of bounds. */
export function alignBoxesToEdge(boxes: readonly MapRect[], edge: AlignEdge, bounds: Bounds): MapRect[] {
  if (!boxes.length) return [];
  const box = boundingBox(boxes);
  return boxes.map((item) => clampBoxWithin({
    ...item,
    x: edge === "left" ? box.x : edge === "right" ? box.x + box.width - item.width : item.x,
    y: edge === "top" ? box.y : edge === "bottom" ? box.y + box.height - item.height : item.y,
  }, bounds));
}

/** Maps every box from one bounding box into another, which is how a corner
 * handle resizes a whole multi-selection at once. */
export function scaleBoxesIntoBox(boxes: readonly MapRect[], from: MapRect, to: MapRect, bounds: Bounds): MapRect[] {
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  return boxes.map((box) => clampBoxWithin({
    x: to.x + (box.x - from.x) * scaleX,
    y: to.y + (box.y - from.y) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  }, bounds));
}

function overlaps(box: MapRect, area: MapRect) {
  return box.x <= area.x + area.width && area.x <= box.x + box.width && box.y <= area.y + area.height && area.y <= box.y + box.height;
}

/** Every element the rubber band touches, in the order the inspector lists
 * them. The hall outline is left out: it spans the sheet, so a band that
 * included it would pick it up every single time. */
export function selectionsWithinBox(layout: EventMapLayout, area: MapRect): Selection[] {
  const selections: Selection[] = [];
  layout.rows.forEach((row, rowIndex) => row.slots.forEach((slot, itemIndex) => {
    if (overlaps(slot.rect, area)) selections.push({ kind: "slot", rowIndex, itemIndex });
  }));
  layout.pillars.forEach((pillar, itemIndex) => { if (overlaps(pillar, area)) selections.push({ kind: "pillar", itemIndex }); });
  layout.accessPoints.forEach((point, itemIndex) => { if (overlaps({ x: point.x, y: point.y, width: 0, height: 0 }, area)) selections.push({ kind: "access", itemIndex }); });
  layout.landmarks.forEach((landmark, itemIndex) => { if (overlaps(landmark.rect, area)) selections.push({ kind: "landmark", itemIndex }); });
  return selections;
}

/** Snap partners are the other rectangles of the same kind: booths align with
 * booths, pillars with pillars, enterprise landmarks with enterprise landmarks.
 * The hall outline has nothing of its kind to align to. */
export function snapTargetsFor(layout: EventMapLayout, selection: RectSelection) {
  if (selection.kind === "slot") return layout.rows.flatMap((row, rowIndex) => row.slots
    .filter((slot, itemIndex) => rowIndex !== selection.rowIndex || itemIndex !== selection.itemIndex)
    .map((slot) => ({ id: slot.code, rect: slot.rect })));
  if (selection.kind === "pillar") return layout.pillars
    .filter((pillar, itemIndex) => itemIndex !== selection.itemIndex)
    .map((pillar) => ({ id: pillar.id, rect: pillar as MapRect }));
  if (selection.kind === "landmark" && resolveMapLandmarkKind(layout.landmarks[selection.itemIndex] ?? { label: "" }) === "enterprise") return layout.landmarks
    .filter((landmark, itemIndex) => itemIndex !== selection.itemIndex && resolveMapLandmarkKind(landmark) === "enterprise")
    .map((landmark) => ({ id: landmark.id, rect: landmark.rect }));
  return [];
}

export function slotSelections(selections: readonly Selection[]): SlotSelection[] {
  return selections.filter((item): item is SlotSelection => item.kind === "slot");
}

export function itemIndicesOf(selections: readonly Selection[], kind: "pillar" | "access" | "landmark"): number[] {
  return selections.filter((item): item is Extract<Selection, { itemIndex: number }> => item.kind === kind).map(({ itemIndex }) => itemIndex);
}

function descending(indices: readonly number[]) {
  return [...new Set(indices)].sort((a, b) => b - a);
}

/** Removes every selected element in one pass. A `Selection` addresses its
 * element by array index, so each list is spliced from its highest index down:
 * removing a low one first would shift every index still waiting its turn onto
 * the wrong element. Rows emptied by the removal go too, matching what deleting
 * a row's last booth has always done. The hall outline is not removable and is
 * ignored here rather than refused, so a mixed selection still deletes. */
export function removeSelectionsFrom(draft: EventMapLayout, selections: readonly Selection[]) {
  const byRow = new Map<number, number[]>();
  slotSelections(selections).forEach(({ rowIndex, itemIndex }) => byRow.set(rowIndex, [...(byRow.get(rowIndex) ?? []), itemIndex]));
  descending([...byRow.keys()]).forEach((rowIndex) => {
    const row = draft.rows[rowIndex];
    if (!row) return;
    descending(byRow.get(rowIndex) ?? []).forEach((itemIndex) => row.slots.splice(itemIndex, 1));
    if (!row.slots.length) draft.rows.splice(rowIndex, 1);
  });
  descending(itemIndicesOf(selections, "pillar")).forEach((itemIndex) => draft.pillars.splice(itemIndex, 1));
  descending(itemIndicesOf(selections, "access")).forEach((itemIndex) => draft.accessPoints.splice(itemIndex, 1));
  descending(itemIndicesOf(selections, "landmark")).forEach((itemIndex) => draft.landmarks.splice(itemIndex, 1));
}

/** The two uniqueness rules a row has to satisfy before it can join a layout:
 * one label per row, one code per booth across the whole map. Row creation and
 * offset paste both go through here so neither can drift from the other. */
export function findRowConflicts(row: BoothRow, layout: RowsOnly): string[] {
  const errors: string[] = [];
  if (layout.rows.some((existing) => existing.label === row.label)) errors.push(`排標籤 ${row.label} 已經存在。`);
  const seenCodes = new Set(layout.rows.flatMap((existing) => existing.slots.map(({ code }) => code)));
  const collision = row.slots.find(({ code }) => {
    if (seenCodes.has(code)) return true;
    seenCodes.add(code);
    return false;
  });
  if (collision) errors.push(`攤位代碼 ${collision.code} 重複。`);
  return errors;
}

function uniqueValue(candidate: string, taken: ReadonlySet<string>) {
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

export type SlotClipboard = { label: string; slots: readonly BoothSlot[] };
export type RowPasteResult = { ok: true; row: BoothRow; errors: [] } | { ok: false; row: null; errors: string[] };

/** Copies a row — or any group of booths — to a new row shifted by an offset,
 * which is how a facing row is laid out. Codes carry the pasted row's label
 * where they carried the copied one's, and anything that would still collide
 * gets a numeric suffix, so the result never duplicates an existing code. */
export function pasteRowAtOffset(
  clipboard: SlotClipboard,
  layout: Pick<EventMapLayout, "width" | "height" | "rows">,
  options: { offsetX: number; offsetY: number; label: string },
): RowPasteResult {
  if (!clipboard.slots.length) return { ok: false, row: null, errors: ["沒有可貼上的攤位。"] };
  if (!Number.isFinite(options.offsetX) || !Number.isFinite(options.offsetY)) return { ok: false, row: null, errors: ["位移必須是有效數字。"] };
  const requested = (options.label.trim() || clipboard.label).trim();
  if (!requested) return { ok: false, row: null, errors: ["排標籤不可留空。"] };
  const label = uniqueValue(requested, new Set(layout.rows.map((row) => row.label)));
  const taken = new Set(layout.rows.flatMap((row) => row.slots.map(({ code }) => code)));
  const translated = translateBoxesWithin(clipboard.slots.map(({ rect }) => rect), options.offsetX, options.offsetY, layout);
  const slots = clipboard.slots.map((slot, index) => {
    const renamed = clipboard.label && label !== clipboard.label && slot.code.startsWith(clipboard.label)
      ? `${label}${slot.code.slice(clipboard.label.length)}`
      : slot.code;
    const code = uniqueValue(renamed, taken);
    taken.add(code);
    return { code, rect: translated[index] };
  });
  const first = slots[0].rect;
  const last = slots[slots.length - 1].rect;
  const row: BoothRow = { label, orientation: rowOrientationFromEndpoints(first, last), confidence: 1, slots };
  const errors = findRowConflicts(row, layout);
  return errors.length ? { ok: false, row: null, errors } : { ok: true, row, errors: [] };
}
