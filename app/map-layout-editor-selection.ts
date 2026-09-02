import { resolveMapLandmarkKind, type BoothRow, type BoothSlot, type EventMapLayout, type MapRect } from "./event-map";
import { clamp, rowOrientationFromEndpoints } from "./map-layout-editor-geometry";

export type Selection =
  | { kind: "floor" }
  | { kind: "slot"; rowIndex: number; itemIndex: number }
  | { kind: "pillar"; itemIndex: number }
  | { kind: "access"; itemIndex: number }
  | { kind: "landmark"; itemIndex: number };

/** Everything except an access point is a rectangle, so moving, corner resizing
 * and the coordinate fields all take one path. */
type RectSelection = Exclude<Selection, { kind: "access" }>;
type SlotSelection = Extract<Selection, { kind: "slot" }>;
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

function sameSelection(a: Selection, b: Selection) {
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
      point.x = clamp(box.x, 0, draft.width);
      point.y = clamp(box.y, 0, draft.height);
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

function clampBoxWithin(box: MapRect, bounds: Bounds): MapRect {
  const width = Math.min(box.width, bounds.width);
  const height = Math.min(box.height, bounds.height);
  return { x: clamp(box.x, 0, Math.max(0, bounds.width - width)), y: clamp(box.y, 0, Math.max(0, bounds.height - height)), width, height };
}

/** Moves the whole group by one shared delta, shortened so the group's outer
 * edges stop at the canvas. Clamping each box on its own would squash the
 * relative spacing that makes a row a row. */
export function translateBoxesWithin(boxes: readonly MapRect[], dx: number, dy: number, bounds: Bounds): MapRect[] {
  if (!boxes.length) return [];
  const box = boundingBox(boxes);
  const shiftX = clamp(dx, -box.x, Math.max(0, bounds.width - (box.x + box.width)));
  const shiftY = clamp(dy, -box.y, Math.max(0, bounds.height - (box.y + box.height)));
  return boxes.map((item) => ({ ...item, x: item.x + shiftX, y: item.y + shiftY }));
}

/** Straightens a group in one move: every box is pushed onto the named edge of
 * the group's own bounding box, and the boxes are then spread out along the
 * other axis so the space between them is the same everywhere. The area they
 * are spread across is the one they already occupy — its top-left and
 * bottom-right corners — so the outermost boxes stay exactly where they are and
 * the group can never grow past a canvas edge it was already inside. The clamp
 * covers the boxes that arrived out of bounds.
 *
 * A row traced by hand off a plan comes out with uneven gaps; this is what
 * turns it into the evenly pitched row the plan actually describes. Left and
 * right spread the group downwards, top and bottom spread it across, which is
 * the axis a row runs along once its booths share an edge.
 *
 * The spread order follows where the boxes already sit along that axis, not the
 * order they were selected in, so booths keep their sequence and their codes
 * keep matching the plan. Boxes that together are wider than the area they
 * occupy end up overlapping by an equal amount rather than spilling out. */
export function alignBoxesToEdge(boxes: readonly MapRect[], edge: AlignEdge, bounds: Bounds): MapRect[] {
  if (!boxes.length) return [];
  const area = boundingBox(boxes);
  // Left and right pin the horizontal edge, which leaves the vertical axis free
  // to spread along; top and bottom are the same the other way round.
  const spreadDown = edge === "left" || edge === "right";
  const sizeAlongSpread = (box: MapRect) => spreadDown ? box.height : box.width;
  const startOf = (box: MapRect) => spreadDown ? box.y : box.x;
  const order = boxes.map((box, index) => index)
    .sort((a, b) => startOf(boxes[a]) - startOf(boxes[b]) || a - b);
  const span = spreadDown ? area.height : area.width;
  const filled = boxes.reduce((total, box) => total + sizeAlongSpread(box), 0);
  const gap = order.length > 1 ? (span - filled) / (order.length - 1) : 0;

  const placed: MapRect[] = [];
  let cursor = spreadDown ? area.y : area.x;
  order.forEach((index) => {
    const item = boxes[index];
    placed[index] = clampBoxWithin({
      ...item,
      x: spreadDown ? (edge === "left" ? area.x : area.x + area.width - item.width) : cursor,
      y: spreadDown ? cursor : (edge === "top" ? area.y : area.y + area.height - item.height),
    }, bounds);
    cursor += sizeAlongSpread(item) + gap;
  });
  return placed;
}

/** The size the most boxes in the group already have. A group traced off a plan
 * is nearly all one booth size with a handful of strays, so the majority size is
 * the one worth keeping; where two sizes are equally common the larger wins,
 * because a booth that is too big is visible on the map while one that is too
 * small hides under its neighbour. Access points carry no size and are left out
 * of the count. Returns nothing when the group holds no sized box at all. */
export function commonBoxSize(boxes: readonly MapRect[]): Bounds | undefined {
  const tally = new Map<string, { size: Bounds; count: number }>();
  boxes.forEach((box) => {
    if (box.width <= 0 || box.height <= 0) return;
    const key = `${box.width}x${box.height}`;
    const entry = tally.get(key) ?? { size: { width: box.width, height: box.height }, count: 0 };
    entry.count += 1;
    tally.set(key, entry);
  });
  const ranked = [...tally.values()].sort((a, b) => b.count - a.count
    || b.size.width * b.size.height - a.size.width * a.size.height);
  return ranked[0]?.size;
}

/** Gives every box in the group the group's most common size. Each box keeps
 * its centre, so a booth grows or shrinks in place instead of sliding off the
 * line its row runs along. Access points have no size to match and stay put. */
export function resizeBoxesToCommonSize(boxes: readonly MapRect[], bounds: Bounds): MapRect[] {
  const size = commonBoxSize(boxes);
  if (!size) return boxes.map((box) => ({ ...box }));
  return boxes.map((box) => box.width > 0 && box.height > 0
    ? clampBoxWithin({ x: box.x + (box.width - size.width) / 2, y: box.y + (box.height - size.height) / 2, ...size }, bounds)
    : { ...box });
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

function itemIndicesOf(selections: readonly Selection[], kind: "pillar" | "access" | "landmark"): number[] {
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

/** The two uniqueness rules a separately created row has to satisfy before it
 * can join a layout: one label per row, one code per booth across the whole
 * map. Offset paste still creates a new logical row and goes through here;
 * intentional segments of an existing row use `appendRowSegment` below. */
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

type RowSegmentPlacement =
  | { ok: true; rowIndex: number; itemStart: number; errors: [] }
  | { ok: false; rowIndex: -1; itemStart: -1; errors: string[] };

/** Adds another straight or hand-drawn segment to a logical row. A row such as
 * K51 B can occupy two columns, and A can stop at a gangway and continue below
 * it, while the published layout still carries one unique B or A row label. */
export function appendRowSegment(layout: EventMapLayout, segment: BoothRow): RowSegmentPlacement {
  const seenCodes = new Set(layout.rows.flatMap((row) => row.slots.map(({ code }) => code)));
  const collision = segment.slots.find(({ code }) => {
    if (seenCodes.has(code)) return true;
    seenCodes.add(code);
    return false;
  });
  if (collision) return { ok: false, rowIndex: -1, itemStart: -1, errors: [`攤位代碼 ${collision.code} 重複。`] };

  const rowIndex = layout.rows.findIndex(({ label }) => label === segment.label);
  if (rowIndex >= 0) {
    const itemStart = layout.rows[rowIndex].slots.length;
    layout.rows[rowIndex].slots.push(...segment.slots);
    return { ok: true, rowIndex, itemStart, errors: [] };
  }
  layout.rows.push(segment);
  return { ok: true, rowIndex: layout.rows.length - 1, itemStart: 0, errors: [] };
}

function uniqueValue(candidate: string, taken: ReadonlySet<string>) {
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

/** Where a copy of a group of booths lands when nobody says: flush alongside
 * the group, across the direction the group runs. A column is copied sideways
 * and a row downwards, which is the facing row a plan asks for; landing flush
 * rather than on top means the copy is visible and separately clickable the
 * moment it appears, and it is selected, so nudging it into its real place is a
 * drag rather than a pair of numbers to work out. Copying towards the far side
 * of the canvas instead when there is no room ahead keeps the copy off the
 * original even at the last row on the sheet. */
export function facingRowOffset(boxes: readonly MapRect[], bounds: Bounds): { offsetX: number; offsetY: number } {
  if (!boxes.length) return { offsetX: 0, offsetY: 0 };
  const area = boundingBox(boxes);
  const sideways = area.height >= area.width;
  const step = sideways ? area.width : area.height;
  const ahead = sideways ? bounds.width - (area.x + area.width) : bounds.height - (area.y + area.height);
  const shift = ahead >= step ? step : -step;
  return sideways ? { offsetX: shift, offsetY: 0 } : { offsetX: 0, offsetY: shift };
}

export type SlotClipboard = { label: string; slots: readonly BoothSlot[] };
type RowPasteResult = { ok: true; row: BoothRow; errors: [] } | { ok: false; row: null; errors: string[] };

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
