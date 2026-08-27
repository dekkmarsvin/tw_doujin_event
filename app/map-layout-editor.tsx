"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { mapAccessArrowTransform, resolveMapLandmarkKind, scaleEventMapLayout, MAP_ACCESS_DIRECTIONS, type BoothRow, type BoothSlot, type EventMapLayout, type MapAccessDirection, type MapLandmarkKind, type MapOrientation, type MapRect } from "./event-map";
import { confirmedDraftSlots, generateRowSlots, inferRowFromAnchors, resizeRectFromCorner, rowOrientationFromEndpoints, snapRectToAdjacentRects, type ResizeCorner, type RowAnchor, type RowDefinition, type RowDraft, type SnapGuide } from "./map-layout-editor-geometry";
import { alignBoxesToEdge, applySelectionBoxes, boundingBox, boxFor, findRowConflicts, mergeSelections, pasteRowAtOffset, rectFor, removeSelectionsFrom, resolveSelectionBoxes, scaleBoxesIntoBox, selectionKey, selectionSetKey, selectionsWithinBox, slotSelections, snapTargetsFor, toggleSelection, translateBoxesWithin, type AlignEdge, type Selection, type SlotClipboard } from "./map-layout-editor-selection";
import { canRedoLayoutHistory, canUndoLayoutHistory, createLayoutHistory, pushLayoutHistory, redoLayoutHistory, sealLayoutHistory, undoLayoutHistory, type LayoutHistory } from "./map-editor-history";
import { UiIcon } from "./ui-icons";
import styles from "./map-layout-editor.module.css";

/** A gesture holds the box every selected element had when it started, so each
 * pointer move is applied to that starting state instead of compounding onto
 * the previous frame. Both gestures carry the whole selection: a batch of one
 * takes the same path as a batch of thirty. */
type GestureState = {
  pointerId: number;
  historyKey: string;
  selections: Selection[];
  boxes: MapRect[];
  startX: number;
  startY: number;
};

type MoveDragState = GestureState & { mode: "move" };
type ResizeDragState = GestureState & { mode: "resize"; corner: ResizeCorner; originBounds: MapRect };
/** A rubber band selects rather than edits, so it carries no boxes and never
 * reaches `commit`. `base` is the selection to merge into when Shift is held. */
type BandDragState = { mode: "band"; pointerId: number; startX: number; startY: number; additive: boolean; base: Selection[] };

type DragState = MoveDragState | ResizeDragState | BandDragState;

type Props = {
  layout: EventMapLayout;
  backgroundImageUrl?: string;
  onChange: (layout: EventMapLayout) => void;
};

/** The row form keeps its numeric fields as strings so a half-typed value does
 * not snap back to a default while the maintainer is still typing. */
type RowFormState = {
  label: string;
  startX: string;
  startY: string;
  endX: string;
  endY: string;
  slotCount: string;
  slotWidth: string;
  slotHeight: string;
  codePrefix: string;
  startNumber: string;
  numberPadding: string;
};

function blankRowForm(layout: EventMapLayout): RowFormState {
  return {
    label: "",
    startX: String(Math.round(layout.width * .2)),
    startY: String(Math.round(layout.height * .5)),
    endX: String(Math.round(layout.width * .8)),
    endY: String(Math.round(layout.height * .5)),
    slotCount: "10",
    slotWidth: String(Math.max(1, Math.round(layout.width * .04))),
    slotHeight: String(Math.max(1, Math.round(layout.height * .03))),
    codePrefix: "",
    startNumber: "1",
    numberPadding: "2",
  };
}

function rowDefinitionFrom(form: RowFormState): RowDefinition {
  return {
    label: form.label,
    start: { x: Number(form.startX), y: Number(form.startY) },
    end: { x: Number(form.endX), y: Number(form.endY) },
    slotCount: Number(form.slotCount),
    slotWidth: Number(form.slotWidth),
    slotHeight: Number(form.slotHeight),
    // An empty prefix means the row label doubles as the code prefix, which is
    // how every organizer surveyed so far numbers its booths.
    codePrefix: form.codePrefix.trim() || form.label.trim(),
    startNumber: Number(form.startNumber),
    numberPadding: Number(form.numberPadding),
  };
}

const MIN_EDITOR_ZOOM = 1;
const MAX_EDITOR_ZOOM = 4;
const EDITOR_ZOOM_STEP = .5;
const SNAP_THRESHOLD_PX = 8;
const ACCESS_DIRECTION_LABELS: Record<MapAccessDirection, string> = { north: "向北", south: "向南", east: "向東", west: "向西" };

function cloneLayout(layout: EventMapLayout): EventMapLayout {
  return {
    ...layout,
    floor: { ...layout.floor },
    rows: layout.rows.map((row) => ({ ...row, slots: row.slots.map((slot) => ({ ...slot, rect: { ...slot.rect } })) })),
    pillars: layout.pillars.map((pillar) => ({ ...pillar })),
    accessPoints: layout.accessPoints.map((point) => ({ ...point })),
    landmarks: layout.landmarks.map((landmark) => ({ ...landmark, rect: { ...landmark.rect } })),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export default function MapLayoutEditor({ layout, backgroundImageUrl, onChange }: Props) {
  const [selections, setSelections] = useState<Selection[]>([]);
  // The inspector's per-element fields only mean anything for exactly one
  // element, so a larger set falls through to the batch panel instead.
  const selection = selections.length === 1 ? selections[0] : null;
  const [history, setHistory] = useState<LayoutHistory>(() => createLayoutHistory(layout));
  // The parent owns the layout: recognizing a new image, starting a blank map
  // or restoring the baseline replaces it wholesale. None of those are editor
  // steps, so the stack restarts from whatever arrived rather than offering an
  // undo back into a layout that no longer matches the canvas.
  if (history.present !== layout) setHistory(createLayoutHistory(layout));
  const [zoom, setZoom] = useState(MIN_EDITOR_ZOOM);
  const [layoutUnitsPerPixel, setLayoutUnitsPerPixel] = useState(layout.width / 800);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [rowForm, setRowForm] = useState<RowFormState | null>(null);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [band, setBand] = useState<MapRect | null>(null);
  // A non-null list turns canvas clicks into anchor marks. The inferred booths
  // live here rather than in `layout`, which is what keeps a booth nobody
  // confirmed out of anything that can be submitted.
  const [anchors, setAnchors] = useState<RowAnchor[] | null>(null);
  const [draftRow, setDraftRow] = useState<RowDraft | null>(null);
  const [clipboard, setClipboard] = useState<SlotClipboard | null>(null);
  const [pasteForm, setPasteForm] = useState({ offsetX: "0", offsetY: "0", label: "" });
  const drag = useRef<DragState | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateScale = () => {
      const renderedWidth = svg.getBoundingClientRect().width;
      if (renderedWidth > 0) setLayoutUnitsPerPixel(layout.width / renderedWidth);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [layout.width]);

  /** Every layout mutation goes through here, which is therefore also where a
   * history step is recorded. `coalesceKey` marks pushes that belong to one
   * gesture — the pointer moves of a single drag, the keystrokes of a single
   * field — so they collapse into one undo step instead of hundreds. */
  const commit = (mutate: (draft: EventMapLayout) => void, coalesceKey: string | null = null) => {
    const draft = cloneLayout(layout);
    mutate(draft);
    setHistory((current) => pushLayoutHistory(current, draft, coalesceKey));
    onChange(draft);
  };

  // Indices in a selection do not survive a step that added or removed
  // elements, so undo and redo drop the selection rather than risk pointing the
  // inspector at a different booth than the one that is highlighted.
  const undo = () => {
    const next = undoLayoutHistory(history);
    if (next === history) return;
    setHistory(next);
    setSelections([]);
    onChange(next.present);
  };

  const redo = () => {
    const next = redoLayoutHistory(history);
    if (next === history) return;
    setHistory(next);
    setSelections([]);
    onChange(next.present);
  };

  /** Scoped to the editor subtree rather than the canvas, so undo also works
   * while the inspector has focus. Text fields keep their own native undo.
   * Registered every render so the handler closes over the current history. */
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as Element | null;
      if (!target || !editorRef.current?.contains(target)) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  });

  const updateRect = (next: Partial<MapRect>, coalesceKey: string | null = null) => {
    if (!selection || selection.kind === "access") return;
    const target = selection;
    commit((draft) => {
      const rect = rectFor(draft, target);
      if (!rect) return;
      const width = clamp(next.width ?? rect.width, .5, draft.width - rect.x);
      const height = clamp(next.height ?? rect.height, .5, draft.height - rect.y);
      rect.x = clamp(next.x ?? rect.x, 0, draft.width - width);
      rect.y = clamp(next.y ?? rect.y, 0, draft.height - height);
      rect.width = clamp(width, .5, draft.width - rect.x);
      rect.height = clamp(height, .5, draft.height - rect.y);
    }, coalesceKey);
  };

  const updateAccess = (next: Partial<EventMapLayout["accessPoints"][number]>, coalesceKey: string | null = null) => {
    if (!selection || selection.kind !== "access") return;
    commit((draft) => {
      const point = draft.accessPoints[selection.itemIndex];
      Object.assign(point, next);
      point.x = clamp(point.x, 0, draft.width);
      point.y = clamp(point.y, 0, draft.height);
    }, coalesceKey);
  };

  /** The canvas is the coordinate space every element lives in, so changing it
   * rescales the whole layout rather than only the viewBox. */
  const resizeCanvas = (next: Partial<Pick<EventMapLayout, "width" | "height">>, coalesceKey: string) => {
    const width = Math.max(1, next.width ?? layout.width);
    const height = Math.max(1, next.height ?? layout.height);
    commit((draft) => Object.assign(draft, scaleEventMapLayout(draft, { width, height })), coalesceKey);
  };

  const pointIn = (element: SVGSVGElement, event: { clientX: number; clientY: number }) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * layout.width / bounds.width,
      y: (event.clientY - bounds.top) * layout.height / bounds.height,
    };
  };

  /** Shift adds to or removes from the set; pressing a member of an existing
   * multi-selection drags the whole group, which is what makes a batch move
   * possible at all; anything else selects only what was pressed. A Shift-click
   * ends there rather than starting a drag, so building a set cannot nudge it. */
  const startDrag = (event: PointerEvent<SVGElement>, target: Selection) => {
    const svg = svgRef.current;
    if (!svg) return;
    const next = event.shiftKey ? toggleSelection(selections, target)
      : selections.some((item) => selectionKey(item) === selectionKey(target)) ? selections
        : [target];
    event.preventDefault();
    event.stopPropagation();
    setSelections(next);
    if (event.shiftKey) return;
    const resolved = resolveSelectionBoxes(layout, next);
    if (!resolved.boxes.length) return;
    const point = pointIn(svg, event);
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSnapGuides([]);
    drag.current = { mode: "move", pointerId: event.pointerId, historyKey: `drag:${event.pointerId}:move:${selectionSetKey(next)}`, selections: resolved.selections, boxes: resolved.boxes, startX: point.x, startY: point.y };
  };

  const startResize = (event: PointerEvent<SVGElement>, svg: SVGSVGElement, corner: ResizeCorner) => {
    const resolved = resolveSelectionBoxes(layout, selections);
    if (!resolved.boxes.length) return;
    const point = pointIn(svg, event);
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSnapGuides([]);
    drag.current = { mode: "resize", pointerId: event.pointerId, historyKey: `drag:${event.pointerId}:resize:${selectionSetKey(selections)}`, selections: resolved.selections, boxes: resolved.boxes, originBounds: boundingBox(resolved.boxes), corner, startX: point.x, startY: point.y };
  };

  /** Handles are drawn only around whatever is selected, so the corner in the
   * dataset is all the handler needs to know. */
  const handleResizePointerDown = (event: PointerEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const corner = event.currentTarget.dataset.resizeCorner as ResizeCorner | undefined;
    if (svg && corner) startResize(event, svg, corner);
  };

  /** Pressing blank paper starts a rubber band. Shift keeps what is already
   * selected, so a band can extend a set built by clicking. */
  const startBand = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const point = pointIn(event.currentTarget, event);
    if (rowForm && anchors) {
      changeAnchors([...anchors, { index: (anchors.at(-1)?.index ?? 0) + 1, x: Math.round(point.x), y: Math.round(point.y) }]);
      setRowErrors([]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setBand(null);
    drag.current = { mode: "band", pointerId: event.pointerId, startX: point.x, startY: point.y, additive: event.shiftKey, base: selections };
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = pointIn(event.currentTarget, event);
    if (active.mode === "band") {
      setBand({ x: Math.min(active.startX, point.x), y: Math.min(active.startY, point.y), width: Math.abs(point.x - active.startX), height: Math.abs(point.y - active.startY) });
      return;
    }
    const dx = point.x - active.startX;
    const dy = point.y - active.startY;
    // One rectangle keeps its snapping; a group is mapped from the bounding box
    // it started with into the resized one, so the spacing inside it survives.
    const lone = active.selections.length === 1 ? active.selections[0] : null;
    let nextGuides: SnapGuide[] = [];
    if (active.mode === "resize") {
      const resized = resizeRectFromCorner(active.originBounds, active.corner, dx, dy, layout);
      commit((draft) => {
        const snapped = lone && lone.kind !== "access" && !event.altKey
          ? snapRectToAdjacentRects(resized, snapTargetsFor(draft, lone), { bounds: draft, mode: active.corner, threshold: SNAP_THRESHOLD_PX * layoutUnitsPerPixel })
          : null;
        applySelectionBoxes(draft, active.selections, scaleBoxesIntoBox(active.boxes, active.originBounds, snapped?.rect ?? resized, draft));
        nextGuides = snapped?.guides ?? [];
      }, active.historyKey);
      setSnapGuides(nextGuides);
      return;
    }
    const moved = translateBoxesWithin(active.boxes, dx, dy, layout);
    commit((draft) => {
      // Moving snaps for landmarks only: a booth is placed by its row, and a
      // row that has already been laid out should not drift onto its neighbour.
      const snapped = lone?.kind === "landmark" && !event.altKey
        ? snapRectToAdjacentRects(moved[0], snapTargetsFor(draft, lone), { bounds: draft, mode: "move", threshold: SNAP_THRESHOLD_PX * layoutUnitsPerPixel })
        : null;
      applySelectionBoxes(draft, active.selections, snapped ? [snapped.rect] : moved);
      nextGuides = snapped?.guides ?? [];
    }, active.historyKey);
    setSnapGuides(nextGuides);
  };

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (active.mode === "band") {
      // A band nobody dragged is a click on blank paper, which clears instead.
      const kept = active.additive ? active.base : [];
      setSelections(band && (band.width >= 1 || band.height >= 1) ? mergeSelections(kept, selectionsWithinBox(layout, band)) : kept);
      setBand(null);
    }
    // Without sealing, dragging the same element twice with one pointer would
    // reuse the key and collapse both gestures into a single undo step.
    setHistory(sealLayoutHistory);
    setSnapGuides([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** Arrow keys nudge the whole selection through the same shared-delta path a
   * drag uses, so a group keeps its internal spacing at the canvas edge. */
  const moveSelection = (dx: number, dy: number) => {
    const resolved = resolveSelectionBoxes(layout, selections);
    if (!resolved.boxes.length) return;
    const boxes = translateBoxesWithin(resolved.boxes, dx, dy, layout);
    commit((draft) => applySelectionBoxes(draft, resolved.selections, boxes), `nudge:${selectionSetKey(selections)}:${dx},${dy}`);
  };

  const alignSelection = (edge: AlignEdge) => {
    const resolved = resolveSelectionBoxes(layout, selections);
    if (resolved.boxes.length < 2) return;
    const boxes = alignBoxesToEdge(resolved.boxes, edge, layout);
    commit((draft) => applySelectionBoxes(draft, resolved.selections, boxes), `align:${selectionSetKey(selections)}:${edge}`);
  };

  const copySelectedSlots = () => {
    const picked = slotSelections(selections);
    const slots = picked.map(({ rowIndex, itemIndex }) => layout.rows[rowIndex]?.slots[itemIndex]).filter((slot): slot is BoothSlot => !!slot);
    if (!slots.length) return;
    setClipboard({ label: layout.rows[picked[0].rowIndex]?.label ?? "", slots: slots.map((slot) => ({ code: slot.code, rect: { ...slot.rect } })) });
    setPasteForm({ offsetX: "0", offsetY: String(Math.round(layout.height * .06)), label: "" });
    setRowErrors([]);
  };

  /** The pasted row lands selected, so the offset can be corrected by dragging
   * the result rather than by undoing and retyping the numbers. */
  const pasteClipboard = () => {
    if (!clipboard) return;
    const result = pasteRowAtOffset(clipboard, layout, { offsetX: Number(pasteForm.offsetX), offsetY: Number(pasteForm.offsetY), label: pasteForm.label });
    if (!result.ok) { setRowErrors(result.errors); return; }
    const rowIndex = layout.rows.length;
    commit((draft) => draft.rows.push(result.row));
    setRowErrors([]);
    setSelections(result.row.slots.map((slot, itemIndex) => ({ kind: "slot", rowIndex, itemIndex })));
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!selections.length) return;
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    moveSelection(direction[0] * step, direction[1] * step);
  };

  /** The counterpart of the seal in `endDrag`. Auto-repeat fires keydown
   * without keyup, so a held arrow stays one step; releasing the key ends the
   * run, without which a later nudge in the same direction would reuse the key
   * and replace the earlier run's step instead of adding its own. */
  const handleKeyUp = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    setHistory(sealLayoutHistory);
  };

  const addLandmark = (kind: MapLandmarkKind, label: string) => {
    const index = layout.landmarks.length;
    let suffix = index + 1;
    while (layout.landmarks.some((item) => item.id === `landmark-${suffix}`)) suffix += 1;
    commit((draft) => draft.landmarks.push({
      id: `landmark-${suffix}`,
      kind,
      label,
      rect: { x: draft.width * .42, y: draft.height * .42, width: draft.width * .16, height: draft.height * .1 },
    }));
    setSelections([{ kind: "landmark", itemIndex: index }]);
  };

  const uniqueId = (prefix: string, values: readonly string[]) => {
    let suffix = values.length + 1;
    while (values.includes(`${prefix}-${suffix}`)) suffix += 1;
    return `${prefix}-${suffix}`;
  };

  /** Adds a single booth to the row that is currently selected, falling back to
   * the last row. Rows themselves are created by `createRow`; without that, a
   * layout could never grow past one row because row labels must be unique. */
  const addSlot = () => {
    const rowIndex = selection?.kind === "slot" ? selection.rowIndex : Math.max(0, layout.rows.length - 1);
    const existingCodes = layout.rows.flatMap((row) => row.slots.map(({ code }) => code));
    const code = uniqueId("NEW", existingCodes);
    commit((draft) => {
      if (draft.rows.length === 0) draft.rows.push({ label: "NEW", orientation: "horizontal", confidence: 1, slots: [] });
      draft.rows[rowIndex].slots.push({
        code,
        rect: { x: draft.width * .45, y: draft.height * .45, width: draft.width * .06, height: draft.height * .04 },
      });
    });
    setSelections([{ kind: "slot", rowIndex, itemIndex: layout.rows[rowIndex]?.slots.length ?? 0 }]);
  };

  /** Places a finished row and selects it, whether it was described by hand or
   * inferred from anchors and then confirmed booth by booth. Both paths meet
   * the same uniqueness rules before anything is written. */
  const placeRow = (row: BoothRow) => {
    const conflicts = findRowConflicts(row, layout);
    if (conflicts.length) { setRowErrors(conflicts); return; }
    const rowIndex = layout.rows.length;
    commit((draft) => draft.rows.push(row));
    setRowErrors([]);
    setRowForm(null);
    setAnchors(null);
    setDraftRow(null);
    setSelections(row.slots.map((slot, itemIndex) => ({ kind: "slot", rowIndex, itemIndex })));
  };

  const createRow = () => {
    if (!rowForm) return;
    const result = generateRowSlots(rowDefinitionFrom(rowForm), layout);
    if (!result.ok) { setRowErrors(result.errors); return; }
    placeRow(result.row);
  };

  /** Turns the marked anchors into a draft row. The draft is held outside the
   * layout so every booth has to be looked at before any of them is placed. */
  const inferDraftRow = () => {
    if (!rowForm || !anchors) return;
    const inferred = inferRowFromAnchors(anchors);
    if (!inferred.ok) { setRowErrors(inferred.errors); return; }
    const { start, end, slotCount, startNumber } = inferred.inference;
    const result = generateRowSlots({ ...rowDefinitionFrom(rowForm), start, end, slotCount, startNumber }, layout);
    if (!result.ok) { setRowErrors(result.errors); return; }
    setRowErrors([]);
    // Every inferred booth starts unconfirmed. Interpolation invents the
    // booths between the anchors, so some of them may not exist on the plan at
    // all; defaulting them to kept would make the confirmation step a no-op and
    // let a booth nobody looked at reach a submission after one press.
    setDraftRow({ slots: result.row.slots, keep: result.row.slots.map(() => false) });
  };

  const placeDraftRow = () => {
    if (!rowForm || !draftRow) return;
    const slots = confirmedDraftSlots(draftRow);
    if (!slots.length) { setRowErrors(["至少要保留一格。"]); return; }
    const label = rowForm.label.trim();
    if (!label) { setRowErrors(["排標籤不可留空。"]); return; }
    placeRow({ label, orientation: rowOrientationFromEndpoints(slots[0].rect, slots[slots.length - 1].rect), confidence: 1, slots });
  };

  const removeRow = (rowIndex: number) => {
    commit((draft) => draft.rows.splice(rowIndex, 1));
    setSelections([]);
  };

  const updateRow = (rowIndex: number, next: Partial<{ label: string; orientation: MapOrientation }>, coalesceKey: string | null = null) => {
    commit((draft) => Object.assign(draft.rows[rowIndex], next), coalesceKey);
  };

  const addPillar = () => {
    const itemIndex = layout.pillars.length;
    const id = uniqueId("pillar", layout.pillars.map(({ id: value }) => value));
    commit((draft) => draft.pillars.push({
      id, x: draft.width * .48, y: draft.height * .48, width: draft.width * .03, height: draft.height * .03,
    }));
    setSelections([{ kind: "pillar", itemIndex }]);
  };

  const addAccess = (kind: "entrance" | "exit") => {
    const itemIndex = layout.accessPoints.length;
    const id = uniqueId(kind, layout.accessPoints.map(({ id: value }) => value));
    commit((draft) => draft.accessPoints.push({
      id, kind, direction: "north", x: draft.width * .5, y: draft.height * .9,
      label: kind === "entrance" ? "入口" : "出口",
    }));
    setSelections([{ kind: "access", itemIndex }]);
  };

  const removeSelection = () => {
    const removable = selections.filter((item) => item.kind !== "floor");
    if (!removable.length) return;
    commit((draft) => removeSelectionsFrom(draft, removable));
    setSelections([]);
  };

  const selectedKeys = new Set(selections.map(selectionKey));
  const selectionBoxes = resolveSelectionBoxes(layout, selections).boxes;
  const copyableSlots = slotSelections(selections).length;
  const rectSelection = selection && selection.kind !== "access" ? selection : undefined;
  const selectedRect = rectSelection ? rectFor(layout, rectSelection) : undefined;
  const selectedAccess = selection?.kind === "access" ? layout.accessPoints[selection.itemIndex] : undefined;
  const selectedSlotSelection = selection?.kind === "slot" ? selection : undefined;
  const selectedSlot = selection?.kind === "slot" ? layout.rows[selection.rowIndex]?.slots[selection.itemIndex] : undefined;
  const selectedPillarSelection = selection?.kind === "pillar" ? selection : undefined;
  const selectedPillar = selection?.kind === "pillar" ? layout.pillars[selection.itemIndex] : undefined;
  const selectedLandmarkSelection = selection?.kind === "landmark" ? selection : undefined;
  const selectedLandmark = selection?.kind === "landmark" ? layout.landmarks[selection.itemIndex] : undefined;
  const selectedLandmarkKind = selectedLandmark ? resolveMapLandmarkKind(selectedLandmark) : undefined;
  const resizeHitRadius = 14 * layoutUnitsPerPixel;
  const resizeKnobHalfSize = 6 * layoutUnitsPerPixel;
  const activeKey = selection ? selectionKey(selection) : "";
  // Handles frame the whole selection, so one corner resizes the group.
  const handleBounds = selections.length > 1 ? boundingBox(selectionBoxes) : selectedRect;
  const canUndo = canUndoLayoutHistory(history);
  const canRedo = canRedoLayoutHistory(history);
  const elementOptions: { key: string; label: string; selection: Selection }[] = [
    { key: "floor", label: "場館外框", selection: { kind: "floor" } },
    ...layout.rows.flatMap((row, rowIndex) => row.slots.map((slot, itemIndex) => ({ key: `slot:${rowIndex}:${itemIndex}`, label: `攤位 ${slot.code}`, selection: { kind: "slot", rowIndex, itemIndex } as Selection }))),
    ...layout.pillars.map((pillar, itemIndex) => ({ key: `pillar:${itemIndex}`, label: `柱子 ${pillar.id}`, selection: { kind: "pillar", itemIndex } as Selection })),
    ...layout.accessPoints.map((point, itemIndex) => ({ key: `access:${itemIndex}`, label: `出入口 ${point.label}`, selection: { kind: "access", itemIndex } as Selection })),
    ...layout.landmarks.map((landmark, itemIndex) => ({ key: `landmark:${itemIndex}`, label: `區域 ${landmark.label || landmark.id}`, selection: { kind: "landmark", itemIndex } as Selection })),
  ];

  const focusSelection = (nextSelection: Selection) => {
    const viewport = viewportRef.current;
    const position = boxFor(layout, nextSelection);
    if (!viewport || !position) return;
    const centerX = position.x + position.width / 2;
    const centerY = position.y + position.height / 2;
    viewport.scrollTo({
      left: centerX / layout.width * viewport.scrollWidth - viewport.clientWidth / 2,
      top: centerY / layout.height * viewport.scrollHeight - viewport.clientHeight / 2,
    });
  };

  const changeZoom = (nextZoom: number) => {
    const viewport = viewportRef.current;
    const centerX = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(viewport.scrollWidth, 1) : .5;
    const centerY = viewport ? (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(viewport.scrollHeight, 1) : .5;
    setZoom(clamp(nextZoom, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM));
    requestAnimationFrame(() => {
      const updated = viewportRef.current;
      if (!updated) return;
      updated.scrollTo({
        left: centerX * updated.scrollWidth - updated.clientWidth / 2,
        top: centerY * updated.scrollHeight - updated.clientHeight / 2,
      });
    });
  };

  const resetView = () => {
    setZoom(MIN_EDITOR_ZOOM);
    requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0 }));
  };

  const selectElement = (key: string) => {
    const option = elementOptions.find((item) => item.key === key);
    setSelections(option ? [option.selection] : []);
    if (option) requestAnimationFrame(() => focusSelection(option.selection));
  };

  /** Any change to a generation field discards the draft it produced. Keeping
   * it would let the contributor correct the prefix or the booth size, see the
   * form say one thing, and place the codes and rectangles of the other. */
  const changeRowForm = (next: RowFormState) => {
    setRowForm(next);
    setDraftRow(null);
  };

  /** Moving, adding or removing an anchor moves the fitted line, so the draft
   * it produced no longer describes what the panel is showing. */
  const changeAnchors = (next: RowAnchor[]) => {
    setAnchors(next);
    setDraftRow(null);
  };

  /** Leaving the row panel ends anchor marking with it. Otherwise the canvas
   * would keep turning blank-paper presses into anchors with no visible
   * controls, and rubber-band selection would stay unavailable. */
  const toggleRowForm = () => {
    setRowErrors([]);
    setAnchors(null);
    setDraftRow(null);
    setRowForm((current) => current ? null : blankRowForm(layout));
  };

  const rowField = (label: string, value: string, onValue: (value: string) => void, placeholder?: string) =>
    <label className={styles.wide}><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onValue(event.target.value)} /></label>;

  const rowFormOrientation = rowForm
    ? rowOrientationFromEndpoints({ x: Number(rowForm.startX), y: Number(rowForm.startY) }, { x: Number(rowForm.endX), y: Number(rowForm.endY) })
    : "vertical";

  const anchorInference = anchors ? inferRowFromAnchors(anchors) : null;

  const rowCodePreview = (() => {
    if (!rowForm) return "";
    const definition = rowDefinitionFrom(rowForm);
    const result = generateRowSlots(definition, layout);
    if (!result.ok) return "尚無法預覽";
    const codes = result.row.slots.map(({ code }) => code);
    return codes.length > 3 ? `${codes.slice(0, 2).join("、")}…${codes.at(-1)}` : codes.join("、");
  })();

  const numberField = (label: string, value: number, onValue: (value: number) => void) => <label><span>{label}</span><input type="number" step="0.1" value={Number(value.toFixed(2))} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onValue(next); }} /></label>;

  return <section ref={editorRef} className={styles.editor} aria-label="活動地圖編輯器">
    <header><div><h3>細部位置編輯器</h3><p>拖曳元素調整位置；Shift 點選加選，空白處拖曳框選。方向鍵移動 1 px，Shift + 方向鍵移動 10 px。</p></div><div className={styles.addTools}><button onClick={toggleRowForm} aria-expanded={!!rowForm}>新增一排</button><button onClick={addSlot}>新增攤位</button><button onClick={addPillar}>新增柱子</button><button onClick={() => addAccess("entrance")}>新增入口</button><button onClick={() => addAccess("exit")}>新增出口</button><button onClick={() => addLandmark("enterprise", "企業攤")}>新增企業攤</button><button onClick={() => addLandmark("stage", "舞台")}>新增舞台</button><button onClick={() => addLandmark("other", "其他區域")}>新增其他區域</button></div></header>
    <div className={styles.workspace}>
      <div className={styles.canvas}>
        <div className={styles.canvasToolbar} aria-label="編輯器畫布工具列"><div><button aria-label="復原上一步編輯" disabled={!canUndo} onClick={undo}>復原</button><button aria-label="重做已復原的編輯" disabled={!canRedo} onClick={redo}>重做</button></div><div><span>檢視倍率</span><button aria-label="縮小編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom <= MIN_EDITOR_ZOOM} onClick={() => changeZoom(zoom - EDITOR_ZOOM_STEP)}><UiIcon name="minus" /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button aria-label="放大編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom >= MAX_EDITOR_ZOOM} onClick={() => changeZoom(zoom + EDITOR_ZOOM_STEP)}><UiIcon name="plus" /></button><button aria-label="重設編輯地圖倍率" onClick={resetView}><UiIcon name="locate" /><span>重設倍率</span></button><button aria-label="聚焦選取的地圖元素" disabled={!selections.length} onClick={() => selections[0] && focusSelection(selections[0])}><UiIcon name="map-pin" /><span>聚焦選取</span></button></div></div>
        <div ref={viewportRef} id="map-layout-editor-canvas" className={styles.canvasViewport}>
        <div className={styles.zoomSurface} style={{ width: `${zoom * 100}%`, aspectRatio: `${layout.width} / ${layout.height}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={`可編輯 ${layout.template} 向量地圖，目前 ${Math.round(zoom * 100)}%`} tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={startBand}>
          <rect className={styles.paper} width={layout.width} height={layout.height} />
          {backgroundImageUrl && <image className={styles.sourceImage} href={backgroundImageUrl} width={layout.width} height={layout.height} preserveAspectRatio="none" />}
          <rect className={`${styles.floor} ${selectedKeys.has("floor") ? styles.selected : ""}`} {...layout.floor} />
          {/* The outline, not the hall's whole area, is what drags: a floor that
              fills the sheet would otherwise swallow every click on blank paper. */}
          <rect className={`${styles.editable} ${styles.floorHandle}`} {...layout.floor} onPointerDown={(event) => startDrag(event, { kind: "floor" })} />
          {layout.landmarks.map((landmark, itemIndex) => <g key={landmark.id} className={`${styles.editable} ${selectedKeys.has(`landmark:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "landmark", itemIndex })}><rect className={styles.landmark} {...landmark.rect} /><text x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label || "未命名區域"}</text></g>)}
          {layout.rows.map((row, rowIndex) => <g key={row.label}>{row.slots.map((slot, itemIndex) => <g key={slot.code} className={`${styles.editable} ${selectedKeys.has(`slot:${rowIndex}:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "slot", rowIndex, itemIndex })}><rect className={styles.slot} {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}</g>)}
          {layout.pillars.map((pillar, itemIndex) => <rect key={pillar.id} className={`${styles.editable} ${styles.pillar} ${selectedKeys.has(`pillar:${itemIndex}`) ? styles.selected : ""}`} {...pillar} onPointerDown={(event) => startDrag(event, { kind: "pillar", itemIndex })} />)}
          {layout.accessPoints.map((point, itemIndex) => <g key={point.id} className={`${styles.editable} ${styles.access} ${point.kind === "entrance" ? styles.entrance : styles.exit} ${selectedKeys.has(`access:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "access", itemIndex })}><circle cx={point.x} cy={point.y} r={12} /><path transform={mapAccessArrowTransform(point)} d={`M ${point.x} ${point.y + 8} V ${point.y - 8} M ${point.x - 5} ${point.y - 3} L ${point.x} ${point.y - 9} L ${point.x + 5} ${point.y - 3}`} /><text x={point.x} y={point.y + 24}>{point.label}</text></g>)}
          {snapGuides.map((guide) => guide.axis === "x"
            ? <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.position} x2={guide.position} y1={guide.start} y2={guide.end} aria-hidden="true" />
            : <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.start} x2={guide.end} y1={guide.position} y2={guide.position} aria-hidden="true" />)}
          {/* Every candidate is drawn, confirmed or not: hiding the ones still
              awaiting a decision would hide exactly what the decision is about. */}
          {draftRow?.slots.map((slot, index) => <g key={slot.code} className={draftRow.keep[index] ? styles.draftSlotKept : styles.draftSlot} aria-hidden="true"><rect {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}
          {anchors?.map((anchor) => <g key={`${anchor.index}:${anchor.x}:${anchor.y}`} className={styles.anchor} aria-hidden="true"><circle cx={anchor.x} cy={anchor.y} r={7 * layoutUnitsPerPixel} /><text x={anchor.x} y={anchor.y - 12 * layoutUnitsPerPixel}>{anchor.index}</text></g>)}
          {band && <rect className={styles.band} {...band} aria-hidden="true" />}
          {handleBounds && ([
            ["nw", handleBounds.x, handleBounds.y],
            ["ne", handleBounds.x + handleBounds.width, handleBounds.y],
            ["se", handleBounds.x + handleBounds.width, handleBounds.y + handleBounds.height],
            ["sw", handleBounds.x, handleBounds.y + handleBounds.height],
          ] as const).map(([corner, x, y]) => <g key={corner} data-resize-corner={corner} className={`${styles.resizeHandle} ${corner === "nw" || corner === "se" ? styles.resizeNwSe : styles.resizeNeSw}`} aria-hidden="true" onPointerDown={handleResizePointerDown}><circle className={styles.resizeHitArea} cx={x} cy={y} r={resizeHitRadius} /><rect className={styles.resizeKnob} x={x - resizeKnobHalfSize} y={y - resizeKnobHalfSize} width={resizeKnobHalfSize * 2} height={resizeKnobHalfSize * 2} rx={2 * layoutUnitsPerPixel} /></g>)}
        </svg>
        </div>
        </div>
      </div>
      <aside className={styles.inspector} aria-label="選取元素屬性">
        <div className={`${styles.fields} ${styles.canvasSize}`}>
          {numberField("畫布寬", layout.width, (value) => resizeCanvas({ width: value }, "field:canvas:width"))}
          {numberField("畫布高", layout.height, (value) => resizeCanvas({ height: value }, "field:canvas:height"))}
        </div>
        <label className={styles.elementPicker}><span>精確選取地圖元素</span><select aria-label="選取地圖元素" value={activeKey} onChange={(event) => selectElement(event.target.value)}><option value="">請選擇攤位或設施</option>{elementOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {rowForm && <div className={styles.rowPanel}>
          <b>新增一排</b>
          <p>起點與終點是這一排第一格與最後一格的中心；格數決定中間如何等分。排標籤可以是任意文字。方向由端點自動判定，建立後仍可在排清單更改。</p>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          {rowField("新排標籤", rowForm.label, (value) => changeRowForm({ ...rowForm, label: value }), "例：A、子、商")}
          <div className={styles.fields}>
            {rowField("起點 X", rowForm.startX, (value) => changeRowForm({ ...rowForm, startX: value }))}
            {rowField("起點 Y", rowForm.startY, (value) => changeRowForm({ ...rowForm, startY: value }))}
            {rowField("終點 X", rowForm.endX, (value) => changeRowForm({ ...rowForm, endX: value }))}
            {rowField("終點 Y", rowForm.endY, (value) => changeRowForm({ ...rowForm, endY: value }))}
            {rowField("格數", rowForm.slotCount, (value) => changeRowForm({ ...rowForm, slotCount: value }))}
            {rowField("每格寬", rowForm.slotWidth, (value) => changeRowForm({ ...rowForm, slotWidth: value }))}
            {rowField("每格高", rowForm.slotHeight, (value) => changeRowForm({ ...rowForm, slotHeight: value }))}
            {rowField("起始編號", rowForm.startNumber, (value) => changeRowForm({ ...rowForm, startNumber: value }))}
            {rowField("補零位數", rowForm.numberPadding, (value) => changeRowForm({ ...rowForm, numberPadding: value }))}
          </div>
          {rowField("代碼前綴", rowForm.codePrefix, (value) => changeRowForm({ ...rowForm, codePrefix: value }), "留空則沿用排標籤")}
          <p>方向：{rowFormOrientation === "horizontal" ? "橫排" : "直排"}（依端點判定）<br />預覽：{rowCodePreview}</p>
          <div className={styles.rowFormActions}><button type="button" onClick={() => { setRowForm(null); setRowErrors([]); setAnchors(null); setDraftRow(null); }}>取消</button><button type="button" className={styles.rowConfirm} onClick={createRow}>建立這一排</button></div>
          <div className={styles.anchorPanel}>
            <b>錨點推算</b>
            <p>在原圖上點選三格以上的中心並填入該格在這一排的編號，工具會推算整排；每一格都要逐格確認後才會加入地圖。</p>
            {!anchors && <div className={styles.rowFormActions}><button type="button" onClick={() => { setAnchors([]); setDraftRow(null); setRowErrors([]); }}>開始標記錨點</button></div>}
            {anchors && <>
              {!anchors.length && <p>在畫布空白處點選即可標記。</p>}
              {!!anchors.length && <ul className={styles.anchorList}>{anchors.map((anchor, index) => <li key={`${index}:${anchor.x}:${anchor.y}`}>
                <span>{Math.round(anchor.x)}, {Math.round(anchor.y)}</span>
                <input type="number" aria-label={`第 ${index + 1} 個錨點的格號`} value={anchor.index} onChange={(event) => { const next = Number(event.target.value); changeAnchors(anchors.map((item, position) => position === index ? { ...item, index: Number.isFinite(next) ? next : item.index } : item)); }} />
                <button type="button" aria-label={`移除第 ${index + 1} 個錨點`} onClick={() => changeAnchors(anchors.filter((item, position) => position !== index))}>移除</button>
              </li>)}</ul>}
              {anchorInference?.ok && <p>格數 {anchorInference.inference.slotCount}・起始編號 {anchorInference.inference.startNumber}・最大偏差 {anchorInference.inference.residual.toFixed(1)}</p>}
              <div className={styles.rowFormActions}><button type="button" onClick={() => { setAnchors(null); setDraftRow(null); setRowErrors([]); }}>取消標記</button><button type="button" className={styles.rowConfirm} disabled={!anchorInference?.ok} onClick={inferDraftRow}>推算草稿</button></div>
            </>}
            {draftRow && <>
              <ul className={styles.draftList}>{draftRow.slots.map((slot, index) => <li key={slot.code}>
                <label><input type="checkbox" checked={draftRow.keep[index]} onChange={(event) => setDraftRow({ ...draftRow, keep: draftRow.keep.map((kept, position) => position === index ? event.target.checked : kept) })} />{slot.code}</label>
              </li>)}</ul>
              <div className={styles.rowFormActions}><button type="button" onClick={() => { setDraftRow(null); setRowErrors([]); }}>捨棄草稿</button><button type="button" className={styles.rowConfirm} disabled={!confirmedDraftSlots(draftRow).length} onClick={placeDraftRow}>加入確認的 {confirmedDraftSlots(draftRow).length} / {draftRow.slots.length} 格</button></div>
            </>}
          </div>
        </div>}
        {!rowForm && !!layout.rows.length && <div className={styles.rowList}>
          <b>已建立的排（{layout.rows.length}）</b>
          <ul>{layout.rows.map((row, rowIndex) => <li key={row.label}>
            <span>{row.label}<small>{row.orientation === "horizontal" ? "橫" : "直"} · {row.slots.length} 格</small></span>
            <button type="button" onClick={() => removeRow(rowIndex)} aria-label={`移除 ${row.label} 排`}>移除整排</button>
          </li>)}</ul>
        </div>}
        {!rowForm && (!!copyableSlots || clipboard) && <div className={styles.rowPanel}>
          <b>複製整排</b>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          <div className={styles.rowFormActions}><button type="button" disabled={!copyableSlots} onClick={copySelectedSlots}>複製選取的 {copyableSlots} 格</button></div>
          {clipboard && <>
            <div className={styles.fields}>
              {rowField("位移 X", pasteForm.offsetX, (value) => setPasteForm({ ...pasteForm, offsetX: value }))}
              {rowField("位移 Y", pasteForm.offsetY, (value) => setPasteForm({ ...pasteForm, offsetY: value }))}
            </div>
            {rowField("新排標籤", pasteForm.label, (value) => setPasteForm({ ...pasteForm, label: value }), "留空則沿用原標籤")}
            <div className={styles.rowFormActions}><button type="button" onClick={() => { setClipboard(null); setRowErrors([]); }}>清除</button><button type="button" className={styles.rowConfirm} onClick={pasteClipboard}>貼上 {clipboard.slots.length} 格</button></div>
          </>}
        </div>}
        {!selections.length && <div className={styles.empty}><b>選取地圖元素</b></div>}
        {selections.length > 1 && <>
          <div className={styles.selectionTitle}><small>已選取</small><b>{selections.length} 個元素</b></div>
          <div className={styles.batchTools}>
            <button type="button" onClick={() => alignSelection("left")}>靠左對齊</button>
            <button type="button" onClick={() => alignSelection("right")}>靠右對齊</button>
            <button type="button" onClick={() => alignSelection("top")}>靠上對齊</button>
            <button type="button" onClick={() => alignSelection("bottom")}>靠下對齊</button>
          </div>
          <button className={styles.remove} onClick={removeSelection}>移除選取的元素</button>
        </>}
        {selection && <>
          <div className={styles.selectionTitle}><small>{selection.kind === "slot" ? "一般攤位" : selection.kind === "pillar" ? "柱子" : selection.kind === "access" ? "出入口" : selection.kind === "floor" ? "場館外框" : "非一般攤位區"}</small><b>{selection.kind === "floor" ? layout.template : selectedSlot?.code ?? selectedPillar?.id ?? selectedAccess?.id ?? selectedLandmark?.label ?? "未命名"}</b></div>
          {selectedSlot && selectedSlotSelection && <><label className={styles.wide}><span>攤位代碼</span><input value={selectedSlot.code} onChange={(event) => { const next = event.target.value.trim(); commit((draft) => { draft.rows[selectedSlotSelection.rowIndex].slots[selectedSlotSelection.itemIndex].code = next; }, `field:${activeKey}:code`); }} /></label><label className={styles.wide}><span>所屬排標籤</span><input value={layout.rows[selectedSlotSelection.rowIndex].label} onChange={(event) => updateRow(selectedSlotSelection.rowIndex, { label: event.target.value.trim() }, `row:${selectedSlotSelection.rowIndex}:label`)} /></label><label className={styles.wide}><span>所屬排方向</span><select value={layout.rows[selectedSlotSelection.rowIndex].orientation} onChange={(event) => updateRow(selectedSlotSelection.rowIndex, { orientation: event.target.value as MapOrientation })}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label></>}
          {selectedPillar && selectedPillarSelection && <label className={styles.wide}><span>柱子 ID</span><input value={selectedPillar.id} onChange={(event) => { const next = event.target.value.trim(); commit((draft) => { draft.pillars[selectedPillarSelection.itemIndex].id = next; }, `field:${activeKey}:id`); }} /></label>}
          {selectedLandmark && selectedLandmarkSelection && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedLandmark.label ?? ""} onChange={(event) => { const stableKind = resolveMapLandmarkKind(selectedLandmark); commit((draft) => { draft.landmarks[selectedLandmarkSelection.itemIndex].kind = stableKind; draft.landmarks[selectedLandmarkSelection.itemIndex].label = event.target.value; }, `field:${activeKey}:label`); }} /></label><label className={styles.wide}><span>區域類型</span><select value={selectedLandmarkKind} onChange={(event) => commit((draft) => { draft.landmarks[selectedLandmarkSelection.itemIndex].kind = event.target.value as MapLandmarkKind; })}><option value="enterprise">企業攤</option><option value="stage">舞台</option><option value="other">其他區域</option></select></label></>}
          {selectedAccess && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedAccess.label} onChange={(event) => updateAccess({ label: event.target.value }, `field:${activeKey}:label`)} /></label><label><span>類型</span><select value={selectedAccess.kind} onChange={(event) => updateAccess({ kind: event.target.value as "entrance" | "exit" })}><option value="entrance">入口</option><option value="exit">出口</option></select></label><label><span>方向</span><select value={selectedAccess.direction} onChange={(event) => updateAccess({ direction: event.target.value as MapAccessDirection })}>{MAP_ACCESS_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{ACCESS_DIRECTION_LABELS[direction]}</option>)}</select></label></>}
          <div className={styles.fields}>
            {numberField("X", selectedAccess?.x ?? selectedRect?.x ?? 0, (value) => selectedAccess ? updateAccess({ x: value }, `field:${activeKey}:x`) : updateRect({ x: value }, `field:${activeKey}:x`))}
            {numberField("Y", selectedAccess?.y ?? selectedRect?.y ?? 0, (value) => selectedAccess ? updateAccess({ y: value }, `field:${activeKey}:y`) : updateRect({ y: value }, `field:${activeKey}:y`))}
            {selectedRect && numberField("寬", selectedRect.width, (value) => updateRect({ width: value }, `field:${activeKey}:width`))}
            {selectedRect && numberField("高", selectedRect.height, (value) => updateRect({ height: value }, `field:${activeKey}:height`))}
          </div>
          {selection.kind !== "floor" && <button className={styles.remove} onClick={removeSelection}>移除此元素</button>}
          <p className={styles.hint}>{selectedLandmarkKind === "enterprise" ? "拖曳移動或縮放時會貼齊相鄰企業攤；按住 Alt 可暫停吸附。" : selection.kind === "access" ? "拖曳會直接更新預覽。" : "拖曳物件可移動，拖曳四角可調整大小。"}</p>
        </>}
      </aside>
    </div>
  </section>;
}
