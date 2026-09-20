"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { mapAccessArrowTransform, resolveMapLandmarkKind, rowLabelAnchor, scaleEventMapLayout, MAP_ACCESS_DIRECTIONS, type BoothRow, type BoothSlot, type EventMapLayout, type MapAccessDirection, type MapLandmarkKind, type MapOrientation, type MapRect } from "./event-map";
import { clamp, confirmedDraftSlots, contiguousSegment, defaultNumberingStart, formatSlotCode, frameNumbering, generateRowSlots, generateRowSlotsFromRect, inferRowFromAnchors, rectFromDrag, resizeRectFromCorner, resizeRectUniformly, rowOrientationFromEndpoints, segmentSlotRects, snapRectToAdjacentRects, type ResizeCorner, type RowAnchor, type RowDefinition, type RowDraft, type RowFrameDefinition, type RowNumberingStart, type SnapGuide } from "./map-layout-editor-geometry";
import { alignBoxesToEdge, appendRowSegment, applySelectionBoxes, applySlotMerge, autoArrangeBoxes, boundingBox, boxFor, facingRowOffset, mergeSelections, pasteRowAtOffset, planSlotMerge, rectFor, removeSelectionsFrom, resolveSelectionBoxes, scaleBoxesIntoBox, selectionKey, selectionSetKey, selectionsWithinBox, slotSelections, snapTargetsOutsideSelection, toggleSelection, translateBoxesWithin, type AlignEdge, type Selection } from "./map-layout-editor-selection";
import { overlappingSlotCodes } from "./map-contribution-draft";
import { canRedoLayoutHistory, canUndoLayoutHistory, createLayoutHistory, pushLayoutHistory, redoLayoutHistory, sealLayoutHistory, undoLayoutHistory, type LayoutHistory } from "./map-editor-history";
import { EMPTY_MAP_AUTHORING, MAX_MAP_GUIDES, scaleMapAuthoringState, type MapAuthoringState, type MapGuide } from "./map-authoring-state";
import { DEFAULT_BACKGROUND_OPACITY, NUDGE_STEPS, mapEditorPreferenceStorage, readMapEditorPreferences, saveMapEditorPreferences, type MapEditorPreferences } from "./map-editor-preferences";
import { editSegmentFrame, replaceSegment, segmentCodeRange, segmentNaming, type SegmentNaming } from "./map-segment-edit";
import { UiIcon } from "./ui-icons";
import { FACILITY_TOOLS, PLACEMENT_LABELS, resolveFacilityPlacement, type FacilityTool, type PlacementTool } from "./map-placement-tool";
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
type SlotDrawDragState = { mode: "draw-slot"; pointerId: number; startX: number; startY: number };
type FacilityDrawState = { mode: "place-facility"; tool: FacilityTool; pointerId: number; startX: number; startY: number; clientX: number; clientY: number };
type GuideDrawState = { mode: "place-guide"; axis: MapGuide["axis"]; pointerId: number; startX: number; startY: number; clientX: number; clientY: number };
type GuideDragState = { mode: "move-guide"; pointerId: number; guide: MapGuide; startX: number; startY: number };
type PanDragState = { mode: "pan"; pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number };
/** Drawing and adjusting the rectangle a row segment is about to be cut from.
 * Neither touches the layout, so neither records a history step: only pressing
 * the confirm button places booths, and that is the one step undo goes back to. */
type RowFrameDrawState = { mode: "draw-row"; pointerId: number; startX: number; startY: number };
type RowFrameResizeState = { mode: "resize-row-frame"; pointerId: number; corner: ResizeCorner; origin: MapRect; startX: number; startY: number };

/** The segment the row panel is currently working on: which booths it holds, in
 * the order they run along the row, and the rectangle they were cut from. A row
 * stores one flat list of booths and no segments, so this only lives as long as
 * the panel does — it is what the corner handles reshape. */
type ActiveSegment = { rowIndex: number; items: number[]; orientation: MapOrientation };

type DragState = MoveDragState | ResizeDragState | BandDragState | SlotDrawDragState | RowFrameDrawState | RowFrameResizeState | FacilityDrawState | GuideDrawState | GuideDragState | PanDragState;

/** A review comment can point at one booth or landmark. `nonce` is what makes
 * the same target requestable twice: after the contributor clicks elsewhere,
 * pressing the same comment again has to bring the selection back. */
export type MapEditorFocusTarget = { kind: "slot" | "landmark"; ref: string; nonce: number };

type Props = {
  layout: EventMapLayout;
  backgroundImageUrl?: string;
  authoring?: MapAuthoringState;
  focusTarget?: MapEditorFocusTarget | null;
  onChange: (layout: EventMapLayout, authoring: MapAuthoringState) => void;
};

/** The row form keeps its numeric fields as strings so a half-typed value does
 * not snap back to a default while the maintainer is still typing.
 *
 * The coordinate and booth-size fields describe a row by two centres, which is
 * what the advanced section still offers. The ordinary flow draws the segment
 * instead and uses only the naming, count, orientation and direction fields. */
type RowFormState = {
  label: string;
  startX: string;
  startY: string;
  endX: string;
  endY: string;
  endNumber: string;
  slotWidth: string;
  slotHeight: string;
  codePrefix: string;
  startNumber: string;
  numberPadding: string;
  orientation: MapOrientation;
  numberingStart: RowNumberingStart;
};

const NUMBERING_STARTS: Record<MapOrientation, { value: RowNumberingStart; label: string }[]> = {
  vertical: [{ value: "top", label: "上 → 下" }, { value: "bottom", label: "下 → 上" }],
  horizontal: [{ value: "left", label: "左 → 右" }, { value: "right", label: "右 → 左" }],
};

/** How many booths the segment holds, read off the two numbers the plan itself
 * prints. A plan says a column runs 01–26; asking for 26 booths starting at 1
 * makes the contributor do that subtraction, and a segment continuing at 27 is
 * where it goes wrong most often. */
function rowSlotCount(form: Pick<RowFormState, "startNumber" | "endNumber">) {
  return Number(form.endNumber) - Number(form.startNumber) + 1;
}

type SlotDrawFormState = { rowLabel: string; code: string; orientation: MapOrientation };

function blankRowForm(layout: EventMapLayout): RowFormState {
  return {
    label: "",
    startX: String(Math.round(layout.width * .2)),
    startY: String(Math.round(layout.height * .5)),
    endX: String(Math.round(layout.width * .8)),
    endY: String(Math.round(layout.height * .5)),
    endNumber: "10",
    slotWidth: String(Math.max(1, Math.round(layout.width * .04))),
    slotHeight: String(Math.max(1, Math.round(layout.height * .03))),
    codePrefix: "",
    startNumber: "1",
    numberPadding: "2",
    orientation: "vertical",
    numberingStart: "top",
  };
}

function rowDefinitionFrom(form: RowFormState): RowDefinition {
  return {
    label: form.label,
    start: { x: Number(form.startX), y: Number(form.startY) },
    end: { x: Number(form.endX), y: Number(form.endY) },
    slotCount: rowSlotCount(form),
    slotWidth: Number(form.slotWidth),
    slotHeight: Number(form.slotHeight),
    // An empty prefix means the row label doubles as the code prefix, which is
    // how every organizer surveyed so far numbers its booths.
    codePrefix: form.codePrefix.trim() || form.label.trim(),
    startNumber: Number(form.startNumber),
    numberPadding: Number(form.numberPadding),
  };
}

function rowFrameDefinitionFrom(form: RowFormState, frame: MapRect): RowFrameDefinition {
  return {
    label: form.label,
    frame,
    orientation: form.orientation,
    slotCount: rowSlotCount(form),
    numberingStart: form.numberingStart,
    codePrefix: form.codePrefix.trim() || form.label.trim(),
    startNumber: Number(form.startNumber),
    numberPadding: Number(form.numberPadding),
  };
}

function nextSlotCode(code: string, taken: ReadonlySet<string>) {
  const match = /^(.*?)(\d+)$/.exec(code.trim());
  const prefix = match?.[1] || `${code.trim() || "NEW"}-`;
  const width = match?.[2].length ?? 1;
  let number = match ? Number(match[2]) + 1 : 1;
  let candidate = `${prefix}${String(number).padStart(width, "0")}`;
  while (taken.has(candidate)) {
    number += 1;
    candidate = `${prefix}${String(number).padStart(width, "0")}`;
  }
  return candidate;
}

function initialSlotCode(layout: EventMapLayout, rowLabel: string) {
  const row = layout.rows.find(({ label }) => label === rowLabel);
  const taken = new Set(layout.rows.flatMap(({ slots }) => slots.map(({ code }) => code)));
  if (row?.slots.length) return nextSlotCode(row.slots.at(-1)!.code, taken);
  return nextSlotCode(`${rowLabel || "NEW"}00`, taken);
}

/* 100% is the whole map inside the viewport, not the map stretched to the
 * viewport's width. Reading it as a width made the height fall out of the
 * layout's proportions, so a map that was not as wide as the viewport is
 * always overflowed downwards and the smallest possible view still scrolled. */
const MIN_EDITOR_ZOOM = 1;
const MAX_EDITOR_ZOOM = 8;
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

/** The element a review comment names, addressed the way the draft spells it:
 * a booth by its code, a landmark by its id. Absent when the draft no longer
 * carries it, which is what happens once the contributor has removed it. */
function findFocusSelection(layout: EventMapLayout, target: MapEditorFocusTarget): Selection | null {
  if (target.kind === "slot") {
    for (const [rowIndex, row] of layout.rows.entries()) {
      const itemIndex = row.slots.findIndex((slot) => slot.code === target.ref);
      if (itemIndex >= 0) return { kind: "slot", rowIndex, itemIndex };
    }
    return null;
  }
  const itemIndex = layout.landmarks.findIndex((landmark) => landmark.id === target.ref);
  return itemIndex >= 0 ? { kind: "landmark", itemIndex } : null;
}

type EditorSnapshot = { layout: EventMapLayout; authoring: MapAuthoringState };

export default function MapLayoutEditor({ layout, authoring = EMPTY_MAP_AUTHORING, backgroundImageUrl, focusTarget, onChange }: Props) {
  const [preferences, setPreferences] = useState(() => readMapEditorPreferences(mapEditorPreferenceStorage()));
  // Held in a ref as well as in state: the pointer handler below runs on the
  // capture phase of the same gesture the key started, and React has not
  // necessarily committed the re-render by then. Reading the state there let a
  // quick Space-then-press fall through to a marquee or a move instead of a
  // pan. The state is what paints the cursor; the ref is what decides.
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const holdSpace = (held: boolean) => { spaceHeldRef.current = held; setSpaceHeld(held); };
  const [panning, setPanning] = useState(false);
  const [segmentForm, setSegmentForm] = useState<SegmentNaming | null>(null);
  const changePreferences = (patch: Partial<MapEditorPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveMapEditorPreferences(mapEditorPreferenceStorage(), next);
  };
  const [selections, setSelections] = useState<Selection[]>([]);
  // The inspector's per-element fields only mean anything for exactly one
  // element, so a larger set falls through to the batch panel instead.
  const selection = selections.length === 1 ? selections[0] : null;
  // A non-null list turns canvas clicks into anchor marks. The inferred booths
  // live here rather than in `layout`, which is what keeps a booth nobody
  // confirmed out of anything that can be submitted.
  const [anchors, setAnchors] = useState<RowAnchor[] | null>(null);
  const [draftRow, setDraftRow] = useState<RowDraft | null>(null);
  const [history, setHistory] = useState<LayoutHistory<EditorSnapshot>>(() => createLayoutHistory({ layout, authoring }));
  // The parent owns the layout: recognizing a new image, starting a blank map
  // or restoring the baseline replaces it wholesale. None of those are editor
  // steps, so the stack restarts from whatever arrived rather than offering an
  // undo back into a layout that no longer matches the canvas.
  if (history.present.layout !== layout || history.present.authoring !== authoring) {
    setHistory(createLayoutHistory({ layout, authoring }));
    // Anchors and the draft they produced belong to the layout that was on
    // screen when they were marked. A wholesale replacement - another draft,
    // a new recognition run, a restored baseline - leaves them describing a
    // plan that is no longer there.
    setAnchors(null);
    setDraftRow(null);
  }
  // A review comment pointing at one element selects it. The nonce is compared
  // rather than the target, so pressing the same comment twice works and an
  // unrelated re-render does not pull the selection back. Adjusting state
  // during render is the same pattern the history reset above uses.
  const focusNonce = focusTarget?.nonce;
  const focusMatch = focusTarget ? findFocusSelection(layout, focusTarget) : null;
  const [focusedNonce, setFocusedNonce] = useState(focusNonce);
  if (focusNonce !== focusedNonce) {
    setFocusedNonce(focusNonce);
    if (focusMatch) setSelections([focusMatch]);
  }
  const [zoom, setZoom] = useState(MIN_EDITOR_ZOOM);
  const [layoutUnitsPerPixel, setLayoutUnitsPerPixel] = useState(layout.width / 800);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [rowForm, setRowForm] = useState<RowFormState | null>(null);
  const [slotDrawForm, setSlotDrawForm] = useState<SlotDrawFormState | null>(null);
  const [slotDraftRect, setSlotDraftRect] = useState<MapRect | null>(null);
  const [facilityTool, setFacilityTool] = useState<FacilityTool | null>(null);
  const [facilityDraft, setFacilityDraft] = useState<MapRect | null>(null);
  const [guideTool, setGuideTool] = useState<MapGuide["axis"] | null>(null);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [guidePreview, setGuidePreview] = useState<MapGuide | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const placementTool: PlacementTool | null = guideTool ? `guide-${guideTool}` : facilityTool ?? (slotDrawForm ? "slot" : rowForm && !anchors ? "row" : null);
  const selectedGuide = authoring.guides.find(guide => guide.id === selectedGuideId);
  // The rectangle drawn around a segment, held outside the layout until it is
  // confirmed, so drawing and redrawing costs nothing and undoes nothing.
  const [rowFrame, setRowFrame] = useState<MapRect | null>(null);
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  /** The frame is derived, never stored. A stored copy is what went stale when
   * the booths moved through a path that did not know about the segment -- a
   * plain drag updates the rects, so the handles and the number fields kept
   * operating on where the segment used to be. Deriving it also ends the
   * segment the moment the selection stops being exactly its members, so
   * clicking elsewhere cannot leave a panel pointing at another row. */
  const activeSegmentFrame = useMemo(() => {
    if (!activeSegment) return undefined;
    const row = layout.rows[activeSegment.rowIndex];
    if (!row) return undefined;
    const rects = activeSegment.items.map((item) => row.slots[item]?.rect);
    if (rects.some((rect) => !rect)) return undefined;
    const members = new Set(activeSegment.items.map((itemIndex) => selectionKey({ kind: "slot", rowIndex: activeSegment.rowIndex, itemIndex })));
    if (selections.length !== members.size || !selections.every((item) => members.has(selectionKey(item)))) return undefined;
    return boundingBox(rects as MapRect[]);
  }, [activeSegment, layout, selections]);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [band, setBand] = useState<MapRect | null>(null);
  const [copyLabel, setCopyLabel] = useState("");
  const drag = useRef<DragState | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  /* The space a map has to fit into. Measured rather than assumed because the
   * fitted scale below is what "100%" means, and a layout effect so the first
   * paint already has it. */
  const [viewportBox, setViewportBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const style = getComputedStyle(viewport);
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = Math.max(0, viewport.clientWidth - horizontal);
      const height = Math.max(0, viewport.clientHeight - vertical);
      // Same numbers, same object: a scrollbar appearing resizes this box, and
      // rescaling the map is what makes it appear or go away.
      setViewportBox((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  /** Screen pixels per layout unit: the scale that puts the whole map inside
   * the viewport, times the chosen zoom. Zero until the viewport is measured. */
  const fitScale = viewportBox.width > 0 && viewportBox.height > 0
    ? Math.min(viewportBox.width / layout.width, viewportBox.height / layout.height)
    : 0;
  const renderScale = fitScale * zoom;

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
    setHistory((current) => pushLayoutHistory(current, { layout: draft, authoring }, coalesceKey));
    onChange(draft, authoring);
  };

  const commitAuthoring = (next: MapAuthoringState, coalesceKey: string | null = null) => {
    setHistory(current => pushLayoutHistory(current, { layout, authoring: next }, coalesceKey));
    onChange(layout, next);
  };

  const updateGuide = (guide: MapGuide, patch: Partial<MapGuide>, coalesceKey: string | null = null) => {
    commitAuthoring({ guides: authoring.guides.map(item => item.id === guide.id ? { ...item, ...patch } : item) }, coalesceKey);
  };

  const deleteGuide = () => {
    if (!selectedGuide) return;
    commitAuthoring({ guides: authoring.guides.filter(guide => guide.id !== selectedGuide.id) });
    setSelectedGuideId(null);
  };

  // Indices in a selection do not survive a step that added or removed
  // elements, so undo and redo drop the selection rather than risk pointing the
  // inspector at a different booth than the one that is highlighted. Anchors go
  // with it: a step that resized the canvas moved them, and undoing restores
  // the layout snapshot without restoring where they were marked.
  const endAnchorRun = () => {
    setSelectedGuideId(null);
    setGuidePreview(null);
    setSelections([]);
    setAnchors((current) => current && []);
    setDraftRow(null);
    setSlotDraftRect(null);
    setRowFrame(null);
    setActiveSegment(null);
    setSegmentForm(null);
  };

  const undo = () => {
    const next = undoLayoutHistory(history);
    if (next === history) return;
    setHistory(next);
    endAnchorRun();
    onChange(next.present.layout, next.present.authoring);
  };

  const redo = () => {
    const next = redoLayoutHistory(history);
    if (next === history) return;
    setHistory(next);
    endAnchorRun();
    onChange(next.present.layout, next.present.authoring);
  };

  const cancelPlacement = () => {
    const active = drag.current;
    drag.current = null;
    if (active && svgRef.current?.hasPointerCapture(active.pointerId)) svgRef.current.releasePointerCapture(active.pointerId);
    setFacilityTool(null);
    setGuideTool(null);
    setGuidePreview(null);
    setFacilityDraft(null);
    setRowForm(null);
    setSlotDrawForm(null);
    setSlotDraftRect(null);
    setRowFrame(null);
    setActiveSegment(null);
    setSegmentForm(null);
    setPanning(false);
    setAnchors(null);
    setDraftRow(null);
    setSnapGuides([]);
    setRowErrors([]);
  };

  /** Scoped to the editor subtree rather than the canvas, so undo also works
   * while the inspector has focus. Text fields keep their own native undo.
   * Registered every render so the handler closes over the current history. */
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target as Element | null;
      if (!target || !editorRef.current?.contains(target)) return;
      if (event.code === "Space" && target === svgRef.current) {
        event.preventDefault();
        holdSpace(true);
        return;
      }
      if (event.key === "Escape" && (placementTool || anchors)) {
        event.preventDefault();
        event.stopPropagation();
        cancelPlacement();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", handleShortcut);
    const releaseSpace = (event: globalThis.KeyboardEvent) => { if (event.code === "Space") holdSpace(false); };
    const resetSpace = () => holdSpace(false);
    document.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", resetSpace);
    return () => { document.removeEventListener("keydown", handleShortcut); document.removeEventListener("keyup", releaseSpace); window.removeEventListener("blur", resetSpace); };
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
    // Anchors are plan coordinates like everything else, so they ride the same
    // rescale the layout does. The draft they produced is discarded rather than
    // rescaled: it has to be inferred again from the moved anchors, and keeping
    // rectangles in the old space would put booths outside a shrunken canvas
    // and leave the preview off the source plan.
    const scaleX = width / layout.width;
    const scaleY = height / layout.height;
    if (anchors) setAnchors(anchors.map((anchor) => ({ ...anchor, x: anchor.x * scaleX, y: anchor.y * scaleY })));
    setDraftRow(null);
    const scaled = { layout: scaleEventMapLayout(layout, { width, height }), authoring: scaleMapAuthoringState(authoring, layout, { width, height }) };
    setHistory(current => pushLayoutHistory(current, scaled, coalesceKey));
    onChange(scaled.layout, scaled.authoring);
  };

  const pointIn = (element: SVGSVGElement, event: { clientX: number; clientY: number }) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * layout.width / bounds.width,
      y: (event.clientY - bounds.top) * layout.height / bounds.height,
    };
  };

  const activateFacility = (tool: FacilityTool) => {
    cancelPlacement();
    setSelections([]);
    setSelectedGuideId(null);
    setFacilityTool(facilityTool === tool ? null : tool);
  };

  const activateGuide = (axis: MapGuide["axis"]) => {
    cancelPlacement();
    setSelections([]);
    setSelectedGuideId(null);
    setShowGuides(true);
    setGuideTool(guideTool === axis ? null : axis);
  };

  const startGuidePlacement = (event: PointerEvent<SVGElement>, svg: SVGSVGElement) => {
    if (!guideTool || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = pointIn(svg, event);
    svg.setPointerCapture(event.pointerId); svg.focus({ preventScroll: true });
    drag.current = { mode: "place-guide", axis: guideTool, pointerId: event.pointerId, startX: point.x, startY: point.y, clientX: event.clientX, clientY: event.clientY };
  };

  const startGuideDrag = (event: PointerEvent<SVGElement>, guide: MapGuide) => {
    const svg = svgRef.current;
    if (!svg || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    setSelections([]); setSelectedGuideId(guide.id); setActiveSegment(null);
    svg.focus({ preventScroll: true });
    if (guide.locked) return;
    const point = pointIn(svg, event);
    svg.setPointerCapture(event.pointerId);
    drag.current = { mode: "move-guide", pointerId: event.pointerId, guide, startX: point.x, startY: point.y };
  };

  const startFacilityPlacement = (event: PointerEvent<SVGElement>, svg: SVGSVGElement) => {
    if (!facilityTool || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointIn(svg, event);
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    drag.current = { mode: "place-facility", tool: facilityTool, pointerId: event.pointerId, startX: point.x, startY: point.y, clientX: event.clientX, clientY: event.clientY };
    setFacilityDraft(resolveFacilityPlacement(facilityTool, point, point, { x: 0, y: 0 }, layout));
  };

  const snap = (rect: MapRect, mode: "move" | ResizeCorner, altKey: boolean, excluded: readonly Selection[] = []) => {
    const result = snappingEnabled && !altKey ? snapRectToAdjacentRects(rect, snapTargetsOutsideSelection(layout, excluded), {
      bounds: layout, mode, threshold: SNAP_THRESHOLD_PX * layoutUnitsPerPixel,
      minimumSize: Math.min(.5, rect.width, rect.height), manualGuides: authoring.guides,
    }) : { rect, guides: [] };
    setSnapGuides(result.guides);
    return result.rect;
  };

  const drawRect = (active: { startX: number; startY: number }, point: { x: number; y: number }, altKey: boolean) => {
    const start = snap({ x: active.startX, y: active.startY, width: 0, height: 0 }, "move", altKey);
    const corner: ResizeCorner = point.x >= start.x ? point.y >= start.y ? "se" : "ne" : point.y >= start.y ? "sw" : "nw";
    return snap(rectFromDrag(start, point, layout), corner, altKey);
  };

  const facilityRect = (active: FacilityDrawState, event: PointerEvent<SVGSVGElement>, point: { x: number; y: number }) => {
    const delta = { x: event.clientX - active.clientX, y: event.clientY - active.clientY };
    const rect = resolveFacilityPlacement(active.tool, { x: active.startX, y: active.startY }, point, delta, layout);
    if (!rect) { setSnapGuides([]); return null; }
    return Math.hypot(delta.x, delta.y) < 3 ? snap(rect, "move", event.altKey) : drawRect(active, point, event.altKey);
  };

  const placeManualSlot = (rect: MapRect) => {
    const form = slotDrawForm;
    if (!form) return;
    const minimum = 3 * layoutUnitsPerPixel;
    if (rect.width < minimum || rect.height < minimum) {
      setRowErrors(["請拖曳出攤位外框；寬與高都必須大於 3 px。"]);
      return;
    }
    const label = form.rowLabel.trim();
    const code = form.code.trim();
    const existing = layout.rows.find(({ label: rowLabel }) => rowLabel === label);
    const segment: BoothRow = {
      label,
      orientation: existing?.orientation ?? form.orientation,
      confidence: 1,
      slots: [{ code, rect }],
    };
    const draft = cloneLayout(layout);
    const placement = appendRowSegment(draft, segment);
    if (!placement.ok) {
      setRowErrors(placement.errors);
      return;
    }
    setHistory((current) => pushLayoutHistory(current, { layout: draft, authoring }, null));
    onChange(draft, authoring);
    setRowErrors([]);
    setSelections([{ kind: "slot", rowIndex: placement.rowIndex, itemIndex: placement.itemStart }]);
    const taken = new Set(draft.rows.flatMap((row) => row.slots.map((slot) => slot.code)));
    setSlotDrawForm({ ...form, rowLabel: label, code: nextSlotCode(code, taken), orientation: segment.orientation });
  };

  const startSlotDraw = (event: PointerEvent<SVGElement>, svg: SVGSVGElement) => {
    const form = slotDrawForm;
    if (!form) return;
    if (!form.rowLabel.trim() || !form.code.trim()) {
      setRowErrors([!form.rowLabel.trim() ? "請先填寫所屬排標籤。" : "請先填寫攤位代碼。"]);
      return;
    }
    const point = pointIn(svg, event);
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSelections([]);
    setRowErrors([]);
    setSlotDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
    drag.current = { mode: "draw-slot", pointerId: event.pointerId, startX: point.x, startY: point.y };
  };

  /** A press on blank paper while the row panel is open draws the next segment.
   * The label is asked for first because releasing the pointer places booths:
   * there is no second press to catch a missing one. */
  const startRowFrameDraw = (event: PointerEvent<SVGElement>, svg: SVGSVGElement) => {
    if (!rowForm?.label.trim()) {
      setRowErrors(["請先填寫排標籤。"]);
      return;
    }
    const point = pointIn(svg, event);
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSelections([]);
    setActiveSegment(null);
    setSegmentForm(null);
    setRowErrors([]);
    setSnapGuides([]);
    setRowFrame({ x: point.x, y: point.y, width: 0, height: 0 });
    drag.current = { mode: "draw-row", pointerId: event.pointerId, startX: point.x, startY: point.y };
  };

  const startRowFrameResize = (event: PointerEvent<SVGElement>, svg: SVGSVGElement, corner: ResizeCorner, frame: MapRect) => {
    const point = pointIn(svg, event);
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setRowErrors([]);
    setSnapGuides([]);
    drag.current = { mode: "resize-row-frame", pointerId: event.pointerId, corner, origin: frame, startX: point.x, startY: point.y };
  };

  /** Takes the run of booths around one booth as the segment to reshape, so a
   * row placed earlier can be re-framed as a whole instead of booth by booth.
   * The booths are selected too: the frame is what the handles grab, and the
   * highlight is what says which booths it will re-cut. */
  const activateSegment = (rowIndex: number, itemIndex: number) => {
    const row = layout.rows[rowIndex];
    if (!row) return;
    const { items, orientation } = contiguousSegment(row.slots.map(({ rect }) => rect), itemIndex);
    if (!items.length) return;
    setActiveSegment({ rowIndex, items, orientation });
    setSegmentForm(null);
    setSelections(items.map((item) => ({ kind: "slot", rowIndex, itemIndex: item })));
    setRowErrors([]);
  };

  /** Renumbering is a second, explicit step. Grabbing a segment is how its
   * frame is corrected, which leaves every code alone; reading the codes into
   * a form that can rewrite them is asked for, not offered on every click. */
  const openSegmentForm = (segment: ActiveSegment) => {
    const row = layout.rows[segment.rowIndex];
    if (!row) return;
    setSegmentForm(segmentNaming(segment.items.map(item => row.slots[item]), segment.orientation, row.label));
    setRowErrors([]);
  };

  /** Divides the frame again and moves the segment's booths onto the new
   * pieces. Codes stay where they are: reshaping a segment says where its booths
   * sit, never what they are called. */
  const recutSegment = (segment: ActiveSegment, frame: MapRect, orientation: MapOrientation, coalesceKey: string | null) => {
    const rects = segmentSlotRects(frame, orientation, segment.items.length, layout);
    if (!rects.length) return;
    commit((draft) => segment.items.forEach((item, position) => {
      const slot = draft.rows[segment.rowIndex]?.slots[item];
      if (slot) slot.rect = rects[position];
    }), coalesceKey);
    setActiveSegment({ ...segment, orientation });
  };

  const updateSegmentFrame = (patch: Partial<MapRect>, key: string) => {
    if (!activeSegment || !activeSegmentFrame) return;
    recutSegment(activeSegment, editSegmentFrame(activeSegmentFrame, patch, layout), activeSegment.orientation, `field:segment:${key}`);
  };

  const applySegmentForm = () => {
    if (!activeSegment || !segmentForm || !activeSegmentFrame) return;
    const result = replaceSegment(layout, activeSegment.rowIndex, activeSegment.items, activeSegmentFrame, segmentForm);
    if (!result.ok) { setRowErrors(result.errors); return; }
    setHistory(current => pushLayoutHistory(current, { layout: result.layout, authoring }));
    onChange(result.layout, authoring);
    setActiveSegment({ rowIndex: activeSegment.rowIndex, items: result.items, orientation: segmentForm.orientation });
    setSelections(result.items.map(itemIndex => ({ kind: "slot", rowIndex: activeSegment.rowIndex, itemIndex })));
    setRowErrors([]);
  };

  /** Capture before an element sees the press, so panning cannot start a move,
   * resize or placement even when the pointer starts on a booth or handle. */
  const startPan = (event: PointerEvent<SVGSVGElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || (event.button !== 1 && !(event.button === 0 && spaceHeldRef.current))) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { mode: "pan", pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    setPanning(true);
    setFacilityDraft(null); setGuidePreview(null); setSnapGuides([]);
  };

  /** Shift adds to or removes from the set; pressing a member of an existing
   * multi-selection drags the whole group, which is what makes a batch move
   * possible at all; anything else selects only what was pressed. A Shift-click
   * ends there rather than starting a drag, so building a set cannot nudge it. */
  const startDrag = (event: PointerEvent<SVGElement>, target: Selection) => {
    const svg = svgRef.current;
    if (!svg || event.button !== 0) return;
    if (guideTool) { startGuidePlacement(event, svg); return; }
    if (facilityTool) { startFacilityPlacement(event, svg); return; }
    if (slotDrawForm) {
      startSlotDraw(event, svg);
      return;
    }
    // Pressing a booth while the row panel is open picks up the segment it
    // belongs to; blank paper is where a new one is drawn.
    if (rowForm && !anchors) {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "slot") activateSegment(target.rowIndex, target.itemIndex);
      else startRowFrameDraw(event, svg);
      return;
    }
    const next = event.shiftKey ? toggleSelection(selections, target)
      : selections.some((item) => selectionKey(item) === selectionKey(target)) ? selections
        : [target];
    event.preventDefault();
    event.stopPropagation();
    setSelections(next);
    setSelectedGuideId(null);
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
    if (!svg) return;
    if (guideTool) { startGuidePlacement(event, svg); return; }
    if (facilityTool) { startFacilityPlacement(event, svg); return; }
    // With the row panel open the handles frame the segment being worked on
    // rather than a selection, so a corner re-cuts it instead of stretching
    // each booth on its own.
    if (activeSegment && activeSegmentFrame && corner) startRowFrameResize(event, svg, corner, activeSegmentFrame);
    else if (slotDrawForm) startSlotDraw(event, svg);
    else if (rowForm && !anchors) startRowFrameDraw(event, svg);
    else if (corner) startResize(event, svg, corner);
  };

  /** Pressing blank paper starts a rubber band. Shift keeps what is already
   * selected, so a band can extend a set built by clicking. */
  const startBand = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (guideTool) { startGuidePlacement(event, event.currentTarget); return; }
    if (facilityTool) { startFacilityPlacement(event, event.currentTarget); return; }
    if (slotDrawForm) {
      startSlotDraw(event, event.currentTarget);
      return;
    }
    if (event.target !== event.currentTarget) return;
    const point = pointIn(event.currentTarget, event);
    if (rowForm && anchors) {
      changeAnchors([...anchors, { index: (anchors.at(-1)?.index ?? 0) + 1, x: Math.round(point.x), y: Math.round(point.y) }]);
      setRowErrors([]);
      return;
    }
    if (rowForm) {
      startRowFrameDraw(event, event.currentTarget);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setBand(null);
    drag.current = { mode: "band", pointerId: event.pointerId, startX: point.x, startY: point.y, additive: event.shiftKey, base: selections };
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (active?.mode === "pan") {
      if (active.pointerId === event.pointerId) viewportRef.current?.scrollTo({ left: active.scrollLeft + active.clientX - event.clientX, top: active.scrollTop + active.clientY - event.clientY });
      return;
    }
    const point = pointIn(event.currentTarget, event);
    if (!active) {
      if (guideTool) setGuidePreview({ id: "preview", axis: guideTool, position: clamp(guideTool === "x" ? point.x : point.y, 0, guideTool === "x" ? layout.width : layout.height), locked: false });
      if (facilityTool) setFacilityDraft(resolveFacilityPlacement(facilityTool, point, point, { x: 0, y: 0 }, layout));
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    if (active.mode === "place-guide") return;
    if (active.mode === "move-guide") {
      const delta = active.guide.axis === "x" ? point.x - active.startX : point.y - active.startY;
      setGuidePreview({ ...active.guide, position: clamp(active.guide.position + delta, 0, active.guide.axis === "x" ? layout.width : layout.height) });
      return;
    }
    if (active.mode === "place-facility") {
      setFacilityDraft(facilityRect(active, event, point));
      return;
    }
    if (active.mode === "band") {
      setBand({ x: Math.min(active.startX, point.x), y: Math.min(active.startY, point.y), width: Math.abs(point.x - active.startX), height: Math.abs(point.y - active.startY) });
      return;
    }
    if (active.mode === "draw-slot") {
      setSlotDraftRect(drawRect(active, point, event.altKey));
      return;
    }
    if (active.mode === "draw-row") {
      setRowFrame(drawRect(active, point, event.altKey));
      return;
    }
    if (active.mode === "resize-row-frame") {
      if (!activeSegment) return;
      const resized = resizeRectFromCorner(active.origin, active.corner, point.x - active.startX, point.y - active.startY, layout);
      const frame = snap(resized, active.corner, event.altKey, activeSegment.items.map(itemIndex => ({ kind: "slot", rowIndex: activeSegment.rowIndex, itemIndex })));
      recutSegment(activeSegment, frame, activeSegment.orientation, `drag:${event.pointerId}:segment:${activeSegment.rowIndex}:${activeSegment.items[0]}`);
      return;
    }
    const dx = point.x - active.startX;
    const dy = point.y - active.startY;
    // One rectangle keeps its snapping; a group is mapped from the bounding box
    // it started with into the resized one, so the spacing inside it survives.
    const lone = active.selections.length === 1 ? active.selections[0] : null;
    if (active.mode === "resize") {
      const resized = lone ? resizeRectFromCorner(active.originBounds, active.corner, dx, dy, layout)
        : resizeRectUniformly(active.originBounds, active.corner, dx, dy, layout);
      const snapped = lone ? snap(resized, active.corner, event.altKey, active.selections) : resized;
      commit(draft => applySelectionBoxes(draft, active.selections, scaleBoxesIntoBox(active.boxes, active.originBounds, snapped, draft)), active.historyKey);
      return;
    }
    const moved = translateBoxesWithin(active.boxes, dx, dy, layout);
    const bounds = boundingBox(moved);
    const snapped = snap(bounds, "move", event.altKey, active.selections);
    const boxes = translateBoxesWithin(moved, snapped.x - bounds.x, snapped.y - bounds.y, layout);
    commit(draft => applySelectionBoxes(draft, active.selections, boxes), active.historyKey);
  };

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (active.mode === "pan") {
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (active.mode === "place-guide") {
      setGuidePreview(null);
      if (event.type !== "pointercancel" && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) < 3 && authoring.guides.length < MAX_MAP_GUIDES) {
        const id = uniqueId("guide", authoring.guides.map(guide => guide.id));
        const guide: MapGuide = { id, axis: active.axis, position: clamp(active.axis === "x" ? active.startX : active.startY, 0, active.axis === "x" ? layout.width : layout.height), locked: false };
        commitAuthoring({ guides: [...authoring.guides, guide] });
        setSelectedGuideId(id); setGuideTool(null);
      }
    }
    if (active.mode === "move-guide") {
      setGuidePreview(null);
      if (event.type !== "pointercancel") {
        const point = pointIn(event.currentTarget, event);
        const delta = active.guide.axis === "x" ? point.x - active.startX : point.y - active.startY;
        const position = clamp(active.guide.position + delta, 0, active.guide.axis === "x" ? layout.width : layout.height);
        if (position !== active.guide.position) updateGuide(active.guide, { position });
      }
    }
    if (active.mode === "place-facility") {
      setFacilityDraft(null);
      const rect = event.type === "pointercancel" ? null : facilityRect(active, event, pointIn(event.currentTarget, event));
      if (rect) placeFacility(active.tool, rect);
    }
    if (active.mode === "band") {
      // A band nobody dragged is a click on blank paper, which clears instead.
      const kept = active.additive ? active.base : [];
      setSelections(band && (band.width >= 1 || band.height >= 1) ? mergeSelections(kept, selectionsWithinBox(layout, band)) : kept);
      setBand(null);
    }
    if (active.mode === "draw-slot") {
      setSlotDraftRect(null);
      if (event.type !== "pointercancel") {
        const point = pointIn(event.currentTarget, event);
        const rect = drawRect(active, point, event.altKey);
        placeManualSlot(rect);
      }
    }
    if (active.mode === "draw-row") {
      const rect = event.type === "pointercancel" ? null : drawRect(active, pointIn(event.currentTarget, event), event.altKey);
      const minimum = 3 * layoutUnitsPerPixel;
      setRowFrame(null);
      if (rect && (rect.width < minimum || rect.height < minimum)) setRowErrors(["請拖曳出排段外框；寬與高都必須大於 3 px。"]);
      else if (rect) placeDrawnSegment(rect);
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

  /** Turns a run of booths into the one booth a double stand actually is. The
   * merged booth is left selected, because its code is the thing most likely to
   * need a look — and the inspector's code field is right there. */
  const mergeSelectedSlots = () => {
    if (!slotMerge.ok) { setRowErrors(slotMerge.errors); return; }
    const { plan } = slotMerge;
    commit((draft) => applySlotMerge(draft, plan));
    setRowErrors([]);
    setActiveSegment(null);
    setSelections([{ kind: "slot", rowIndex: plan.rowIndex, itemIndex: plan.itemIndex }]);
  };

  const autoArrangeSelection = () => {
    const resolved = resolveSelectionBoxes(layout, selections);
    if (resolved.boxes.length < 2) return;
    const boxes = autoArrangeBoxes(resolved.boxes, layout);
    commit((draft) => applySelectionBoxes(draft, resolved.selections, boxes), `arrange:${selectionSetKey(selections)}`);
  };

  /** One press copies: the selected booths become another row flush alongside
   * the ones they were copied from, and the copy lands selected, so it is put
   * in its real place by dragging it there. Holding the booths in a clipboard
   * first, then asking for a position as two numbers, made the contributor work
   * out coordinates for something they were about to drag anyway. */
  const copySelectedSlots = () => {
    const picked = slotSelections(selections);
    const slots = picked.map(({ rowIndex, itemIndex }) => layout.rows[rowIndex]?.slots[itemIndex]).filter((slot): slot is BoothSlot => !!slot);
    if (!slots.length) return;
    const copied = { label: layout.rows[picked[0].rowIndex]?.label ?? "", slots: slots.map((slot) => ({ code: slot.code, rect: { ...slot.rect } })) };
    const offset = facingRowOffset(copied.slots.map(({ rect }) => rect), layout);
    const result = pasteRowAtOffset(copied, layout, { ...offset, label: copyLabel });
    if (!result.ok) { setRowErrors(result.errors); return; }
    const rowIndex = layout.rows.length;
    commit((draft) => draft.rows.push(result.row));
    setRowErrors([]);
    setCopyLabel("");
    setSelections(result.row.slots.map((slot, itemIndex) => ({ kind: "slot", rowIndex, itemIndex })));
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (selectedGuide && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault(); deleteGuide(); return;
    }
    if (!selections.length) return;
    // Delete belongs on the canvas, where the selection already is: the panel's
    // remove button is a whole pointer trip away from the booth just drawn.
    // Backspace does the same, and is stopped from walking the browser back.
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelection();
      return;
    }
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = preferences.nudge * (event.shiftKey ? 10 : 1);
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

  const uniqueId = (prefix: string, values: readonly string[]) => {
    let suffix = values.length + 1;
    while (values.includes(`${prefix}-${suffix}`)) suffix += 1;
    return `${prefix}-${suffix}`;
  };

  /** Places a finished row and selects it, whether it was drawn, described by
   * hand or inferred from anchors. Reusing a label appends another segment to
   * that logical row, which is how a gangway or facing column stays one A/B row.
   * One placement is one history step, so undo takes back a whole segment. */
  const commitRow = (row: BoothRow) => {
    const draft = cloneLayout(layout);
    const placement = appendRowSegment(draft, row);
    if (!placement.ok) { setRowErrors(placement.errors); return null; }
    setHistory((current) => pushLayoutHistory(current, { layout: draft, authoring }, null));
    onChange(draft, authoring);
    setRowErrors([]);
    setSelections(row.slots.map((slot, offset) => ({ kind: "slot", rowIndex: placement.rowIndex, itemIndex: placement.itemStart + offset })));
    return { rowIndex: placement.rowIndex, itemStart: placement.itemStart };
  };

  /** The advanced paths finish with the panel: describing a row by coordinates
   * or marking anchors is a one-off, unlike drawing segment after segment. */
  const placeRow = (row: BoothRow) => {
    if (!commitRow(row)) return;
    setRowForm(null);
    setAnchors(null);
    setDraftRow(null);
    setRowFrame(null);
    setActiveSegment(null);
  };

  /** Releasing the pointer places the segment. There is no confirm step: the
   * drawing already said everything the booths need, and what would be reviewed
   * is on the canvas either way. Anything wrong about it is one undo, or a
   * corner handle, away.
   *
   * The panel then carries on: label, prefix, padding and direction stay, and
   * both numbers move on by the count just placed, because the next segment of a
   * row normally continues its numbering where this one stopped. */
  const placeDrawnSegment = (frame: MapRect) => {
    if (!rowForm) return;
    const { orientation, numberingStart } = frameNumbering(rowForm, frame);
    const count = rowSlotCount(rowForm);
    if (!Number.isInteger(count) || count < 1) { setRowErrors(["結束編號必須大於或等於起始編號。"]); return; }
    const result = generateRowSlotsFromRect({ ...rowFrameDefinitionFrom(rowForm, frame), orientation, numberingStart }, layout);
    if (!result.ok) { setRowErrors(result.errors); return; }
    const placement = commitRow(result.row);
    if (!placement) return;
    setRowForm({
      ...rowForm,
      orientation,
      numberingStart,
      startNumber: String(Number(rowForm.startNumber) + count),
      endNumber: String(Number(rowForm.endNumber) + count),
    });
    setActiveSegment({
      rowIndex: placement.rowIndex,
      // Codes run backwards along the frame when the row is numbered from the
      // far end, so the positions are taken from the geometry, not the codes.
      items: result.row.slots
        .map((slot, offset) => ({ item: placement.itemStart + offset, along: orientation === "vertical" ? slot.rect.y : slot.rect.x }))
        .sort((a, b) => a.along - b.along)
        .map(({ item }) => item),
      orientation,
    });
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

  const placeFacility = (tool: FacilityTool, rect: MapRect) => {
    if (tool === "pillar") {
      const itemIndex = layout.pillars.length;
      const id = uniqueId("pillar", layout.pillars.map(({ id }) => id));
      commit((draft) => draft.pillars.push({ id, ...rect }));
      setSelections([{ kind: "pillar", itemIndex }]);
    } else if (tool === "entrance" || tool === "exit") {
      const itemIndex = layout.accessPoints.length;
      const id = uniqueId(tool, layout.accessPoints.map(({ id }) => id));
      commit((draft) => draft.accessPoints.push({ id, kind: tool, direction: "north", x: rect.x, y: rect.y, label: PLACEMENT_LABELS[tool] }));
      setSelections([{ kind: "access", itemIndex }]);
    } else {
      const itemIndex = layout.landmarks.length;
      const id = uniqueId("landmark", layout.landmarks.map(({ id }) => id));
      commit((draft) => draft.landmarks.push({ id, kind: tool, label: PLACEMENT_LABELS[tool], rect }));
      setSelections([{ kind: "landmark", itemIndex }]);
    }
    setFacilityTool(null);
  };

  const removeSelection = () => {
    const removable = selections.filter((item) => item.kind !== "floor");
    if (!removable.length) return;
    commit((draft) => removeSelectionsFrom(draft, removable));
    setSelections([]);
  };

  const selectedKeys = new Set(selections.map(selectionKey));
  // Submission refuses overlapping booths by count alone, which leaves the
  // maintainer hunting for them. Same check, drawn where they are moved.
  const overlaps = useMemo(() => overlappingSlotCodes(layout), [layout]);
  const overlapping = useMemo(() => new Set(overlaps), [overlaps]);
  const selectionBoxes = resolveSelectionBoxes(layout, selections).boxes;
  const copyableSlots = slotSelections(selections).length;
  // Asked on every render rather than on the press, because the answer is what
  // the merge button's own state and the line under it are.
  const slotMerge = planSlotMerge(layout, selections);
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
  const resizeKnobHalfSize = 3 * layoutUnitsPerPixel;
  const activeKey = selection ? selectionKey(selection) : "";
  // Handles frame the whole selection, so one corner resizes the group.
  // While the row panel is open the handles belong to the frame being drawn, so
  // there is only ever one set of corners on the canvas.
  const handleBounds = activeSegmentFrame ?? (rowForm ? undefined : selections.length > 1 ? boundingBox(selectionBoxes) : selectedRect);
  const canUndo = canUndoLayoutHistory(history);
  const canRedo = canRedoLayoutHistory(history);
  const elementOptions: { key: string; label: string; selection: Selection }[] = [
    { key: "floor", label: "場館外框", selection: { kind: "floor" } },
    ...layout.rows.flatMap((row, rowIndex) => row.slots.map((slot, itemIndex) => ({ key: `slot:${rowIndex}:${itemIndex}`, label: `攤位 ${slot.code}`, selection: { kind: "slot", rowIndex, itemIndex } as Selection }))),
    ...layout.pillars.map((pillar, itemIndex) => ({ key: `pillar:${itemIndex}`, label: `柱子 ${pillar.id}`, selection: { kind: "pillar", itemIndex } as Selection })),
    ...layout.accessPoints.map((point, itemIndex) => ({ key: `access:${itemIndex}`, label: `出入口 ${point.label}`, selection: { kind: "access", itemIndex } as Selection })),
    ...layout.landmarks.map((landmark, itemIndex) => ({ key: `landmark:${itemIndex}`, label: `區域 ${landmark.label || landmark.id}`, selection: { kind: "landmark", itemIndex } as Selection })),
  ];

  /* The map is padded, and centred while it still fits, so its top-left corner
   * is not the scroll origin: half of whatever the scroll area has over the map
   * is that offset. Both directions of the conversion need it. */
  const mapOriginIn = (viewport: HTMLDivElement, scale: number) => ({
    x: (viewport.scrollWidth - layout.width * scale) / 2,
    y: (viewport.scrollHeight - layout.height * scale) / 2,
  });

  /** Scrolls so that a point of the map sits in the middle of the viewport. */
  const centerMapPoint = (viewport: HTMLDivElement, point: { x: number; y: number }, scale: number) => {
    const origin = mapOriginIn(viewport, scale);
    viewport.scrollTo({
      left: origin.x + point.x * scale - viewport.clientWidth / 2,
      top: origin.y + point.y * scale - viewport.clientHeight / 2,
    });
  };

  const focusSelection = (nextSelection: Selection) => {
    const viewport = viewportRef.current;
    const position = boxFor(layout, nextSelection);
    if (!viewport || !position || renderScale <= 0) return;
    centerMapPoint(viewport, { x: position.x + position.width / 2, y: position.y + position.height / 2 }, renderScale);
  };

  const focusSlotCode = (code: string) => {
    const match = findFocusSelection(layout, { kind: "slot", ref: code, nonce: 0 });
    if (!match) return;
    setSelections([match]);
    focusSelection(match);
  };

  // Scrolls to what the request named. Keyed on the nonce alone: re-running on
  // every layout change would drag the viewport back while the contributor is
  // still editing. Nothing here sets state, so the selection is not fought over.
  useEffect(() => {
    if (focusMatch) focusSelection(focusMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const changeZoom = (nextZoom: number) => {
    const viewport = viewportRef.current;
    const zoomed = clamp(nextZoom, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM);
    // What the middle of the view is looking at, in map units, so the same
    // place is still in the middle at the new scale.
    const origin = viewport && renderScale > 0 ? mapOriginIn(viewport, renderScale) : null;
    const anchor = viewport && origin ? {
      x: (viewport.scrollLeft + viewport.clientWidth / 2 - origin.x) / renderScale,
      y: (viewport.scrollTop + viewport.clientHeight / 2 - origin.y) / renderScale,
    } : null;
    setZoom(zoomed);
    requestAnimationFrame(() => {
      const updated = viewportRef.current;
      if (updated && anchor) centerMapPoint(updated, anchor, fitScale * zoomed);
    });
  };

  const resetView = () => {
    setZoom(MIN_EDITOR_ZOOM);
    requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0 }));
  };

  const selectElement = (key: string) => {
    const option = elementOptions.find((item) => item.key === key);
    setSelections(option ? [option.selection] : []);
    setSelectedGuideId(null);
    setActiveSegment(null); setSegmentForm(null);
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
    const next = rowForm ? null : blankRowForm(layout);
    cancelPlacement();
    setSelections([]);
    setSelectedGuideId(null);
    setRowForm(next);
  };

  /** These fields describe the next placement. Existing segments have their
   * own explicitly applied numbering fields, so columns remain independent. */
  const changeRowOrientation = (form: RowFormState, orientation: MapOrientation) => {
    changeRowForm({ ...form, orientation, numberingStart: defaultNumberingStart(orientation) });
  };

  const changeRowNumbering = (form: RowFormState, numberingStart: RowNumberingStart) => {
    changeRowForm({ ...form, numberingStart });
  };

  const toggleSlotDrawForm = () => {
    const rowLabel = selection?.kind === "slot" ? layout.rows[selection.rowIndex]?.label ?? "" : layout.rows.at(-1)?.label ?? "";
    const next: SlotDrawFormState | null = slotDrawForm ? null : { rowLabel, code: initialSlotCode(layout, rowLabel), orientation: "vertical" };
    cancelPlacement();
    setSelections([]);
    setSelectedGuideId(null);
    setSlotDrawForm(next);
  };

  // 打字途中改寫輸入框的值會吃掉空白，也會打斷輸入法的組字；離開欄位時才去頭尾空白。
  const trimmedField = (value: string, onValue: (next: string) => void) => ({
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onValue(event.target.value),
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      const trimmed = event.target.value.trim();
      if (trimmed !== event.target.value) onValue(trimmed);
    },
  });

  const rowField = (label: string, value: string, onValue: (value: string) => void, placeholder?: string) =>
    <label className={styles.wide}><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onValue(event.target.value)} /></label>;

  const rowFormOrientation = rowForm
    ? rowOrientationFromEndpoints({ x: Number(rowForm.startX), y: Number(rowForm.startY) }, { x: Number(rowForm.endX), y: Number(rowForm.endY) })
    : "vertical";

  const anchorInference = anchors ? inferRowFromAnchors(anchors) : null;
  const rowFormExisting = rowForm ? layout.rows.find(({ label }) => label === rowForm.label.trim()) : undefined;
  const slotDrawExisting = slotDrawForm ? layout.rows.find(({ label }) => label === slotDrawForm.rowLabel.trim()) : undefined;

  const summariseCodes = (slots: readonly BoothSlot[]) => {
    const codes = slots.map(({ code }) => code);
    return codes.length > 3 ? `${codes.slice(0, 2).join("、")}…${codes.at(-1)}` : codes.join("、");
  };

  const rowCodePreview = (() => {
    if (!rowForm) return "";
    const definition = rowDefinitionFrom(rowForm);
    const result = generateRowSlots(definition, layout);
    return result.ok ? summariseCodes(result.row.slots) : "尚無法預覽";
  })();

  // Recomputed on every render from the frame and the form, so changing the
  // count or the direction redraws the division without a step of its own.
  const framePreview = rowForm && rowFrame ? generateRowSlotsFromRect({ ...rowFrameDefinitionFrom(rowForm, rowFrame), ...frameNumbering(rowForm, rowFrame) }, layout) : null;
  const rowCodeRange = rowForm && rowSlotCount(rowForm) >= 1
    ? `${formatSlotCode(rowForm.codePrefix.trim() || rowForm.label.trim(), Number(rowForm.startNumber), Number(rowForm.numberPadding))}–${formatSlotCode(rowForm.codePrefix.trim() || rowForm.label.trim(), Number(rowForm.endNumber), Number(rowForm.numberPadding))}`
    : "";

  const numberField = (label: string, value: number, onValue: (value: number) => void, disabled = false) => <label><span>{label}</span><input type="number" step="0.1" disabled={disabled} value={Number(value.toFixed(2))} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onValue(next); }} /></label>;

  return <section ref={editorRef} className={styles.editor} aria-label="活動地圖編輯器">
    <header><div><h3>細部位置編輯器</h3><p>拖曳元素調整位置；Shift 點選加選，空白處拖曳框選。方向鍵依步進微移，Shift 加速 10 倍；Space 拖曳或中鍵平移畫布。</p>
      {overlaps.length > 0 && <p className={styles.overlapNotice}>攤位重疊{overlaps.map((code) => <button type="button" key={code} onClick={() => focusSlotCode(code)}>{code}</button>)}</p>}</div><div className={styles.addTools}><button className={placementTool === "row" ? styles.drawActive : ""} aria-pressed={placementTool === "row"} onClick={toggleRowForm} aria-expanded={!!rowForm}>新增排／排段</button><button className={slotDrawForm ? styles.drawActive : ""} aria-pressed={!!slotDrawForm} onClick={toggleSlotDrawForm}>手動畫攤位</button>{FACILITY_TOOLS.map((tool) => <button key={tool} aria-pressed={placementTool === tool} className={placementTool === tool ? styles.drawActive : ""} onClick={() => activateFacility(tool)}>新增{PLACEMENT_LABELS[tool]}</button>)}{(["y", "x"] as const).map(axis => <button key={axis} disabled={authoring.guides.length >= MAX_MAP_GUIDES} aria-pressed={guideTool === axis} className={guideTool === axis ? styles.drawActive : ""} onClick={() => activateGuide(axis)}>新增{axis === "x" ? "垂直" : "水平"}輔助線</button>)}</div></header>
    {placementTool && <p className={styles.placementStatus} role="status">目前工具：{PLACEMENT_LABELS[placementTool]}。{guideTool || facilityTool === "entrance" || facilityTool === "exit" ? "在畫布點一下放置。" : facilityTool ? "拖曳外框，或點一下以預設大小置中放置。" : "拖曳外框後放開建立。"} Escape 取消。<button type="button" onClick={cancelPlacement}>取消放置</button></p>}
    <div className={styles.workspace}>
      <div className={styles.canvas}>
        <div className={styles.guideToolbar}><label><input type="checkbox" checked={showGuides} onChange={event => setShowGuides(event.target.checked)} />顯示輔助線</label><label><input type="checkbox" checked={snappingEnabled} onChange={event => setSnappingEnabled(event.target.checked)} />啟用吸附</label><span>Alt 暫停本次吸附</span></div>
        <div className={styles.displayToolbar} aria-label="描摹與微移設定">
          <label><input type="checkbox" checked={preferences.showBackground} disabled={!backgroundImageUrl} onChange={event => changePreferences({ showBackground: event.target.checked })} />顯示配置圖</label>
          <label>透明度<input type="range" min="0" max="100" step="1" aria-label="配置圖透明度" disabled={!backgroundImageUrl} value={preferences.backgroundOpacity} onChange={event => changePreferences({ backgroundOpacity: Number(event.target.value) })} /><output>{preferences.backgroundOpacity}%</output></label>
          <button type="button" disabled={!backgroundImageUrl} onClick={() => changePreferences({ backgroundOpacity: DEFAULT_BACKGROUND_OPACITY })}>重設透明度</button>
          <label><input type="checkbox" checked={preferences.tracing} onChange={event => changePreferences({ tracing: event.target.checked })} />描摹模式</label>
          <label>微移步進<select aria-label="微移步進" value={preferences.nudge} onChange={event => changePreferences({ nudge: Number(event.target.value) })}>{NUDGE_STEPS.map(step => <option key={step} value={step}>{step}</option>)}</select></label><span>Shift × 10</span>
        </div>
        <div className={styles.canvasToolbar} aria-label="編輯器畫布工具列"><div><button aria-label="復原上一步編輯" disabled={!canUndo} onClick={undo}>復原</button><button aria-label="重做已復原的編輯" disabled={!canRedo} onClick={redo}>重做</button></div><div><span>檢視倍率</span><button aria-label="縮小編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom <= MIN_EDITOR_ZOOM} onClick={() => changeZoom(zoom - EDITOR_ZOOM_STEP)}><UiIcon name="minus" /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button aria-label="放大編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom >= MAX_EDITOR_ZOOM} onClick={() => changeZoom(zoom + EDITOR_ZOOM_STEP)}><UiIcon name="plus" /></button><button aria-label="重設編輯地圖倍率" onClick={resetView}><UiIcon name="locate" /><span>重設倍率</span></button><button aria-label="聚焦選取的地圖元素" disabled={!selections.length} onClick={() => selections[0] && focusSelection(selections[0])}><UiIcon name="map-pin" /><span>聚焦選取</span></button></div></div>
        <div ref={viewportRef} id="map-layout-editor-canvas" className={styles.canvasViewport}>
        <div className={styles.zoomSurface} style={{ width: `${layout.width * renderScale}px`, height: `${layout.height * renderScale}px` }}>
        <svg ref={svgRef} className={`${placementTool ? styles.drawing : ""} ${preferences.tracing ? styles.tracing : ""} ${spaceHeld || panning ? styles.panReady : ""} ${panning ? styles.panning : ""}`} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={`可編輯 ${layout.template} 向量地圖，目前 ${Math.round(zoom * 100)}%`} tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onBlur={() => holdSpace(false)} onPointerDownCapture={startPan} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }} onPointerLeave={() => { if (!drag.current) { setFacilityDraft(null); setGuidePreview(null); } }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={startBand}>
          <rect className={styles.paper} width={layout.width} height={layout.height} />
          {backgroundImageUrl && <image className={styles.sourceImage} href={backgroundImageUrl} style={{ opacity: preferences.backgroundOpacity / 100, visibility: preferences.showBackground ? "visible" : "hidden" }} width={layout.width} height={layout.height} preserveAspectRatio="none" />}
          <rect className={`${styles.floor} ${selectedKeys.has("floor") ? styles.selected : ""}`} {...layout.floor} />
          {/* The outline, not the hall's whole area, is what drags: a floor that
              fills the sheet would otherwise swallow every click on blank paper. */}
          <rect className={`${styles.editable} ${styles.floorHandle}`} {...layout.floor} onPointerDown={(event) => startDrag(event, { kind: "floor" })} />
          {layout.landmarks.map((landmark, itemIndex) => <g key={landmark.id} className={`${styles.editable} ${selectedKeys.has(`landmark:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "landmark", itemIndex })}><rect className={styles.landmark} {...landmark.rect} /><text x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label || "未命名區域"}</text></g>)}
          {layout.rows.map((row) => {
            const anchor = rowLabelAnchor(row);
            return anchor && <text key={`label:${row.label}`} className={styles.rowLabel} {...anchor} aria-hidden="true">{row.label}</text>;
          })}
          {layout.rows.map((row, rowIndex) => <g key={row.label}>{row.slots.map((slot, itemIndex) => <g key={slot.code} data-slot-code={slot.code} className={`${styles.editable} ${overlapping.has(slot.code) ? styles.overlapping : ""} ${selectedKeys.has(`slot:${rowIndex}:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "slot", rowIndex, itemIndex })}><rect className={styles.slot} {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}</g>)}
          {layout.pillars.map((pillar, itemIndex) => <rect key={pillar.id} className={`${styles.editable} ${styles.pillar} ${selectedKeys.has(`pillar:${itemIndex}`) ? styles.selected : ""}`} {...pillar} onPointerDown={(event) => startDrag(event, { kind: "pillar", itemIndex })} />)}
          {layout.accessPoints.map((point, itemIndex) => <g key={point.id} className={`${styles.editable} ${styles.access} ${point.kind === "entrance" ? styles.entrance : styles.exit} ${selectedKeys.has(`access:${itemIndex}`) ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "access", itemIndex })}><circle cx={point.x} cy={point.y} r={12} /><path transform={mapAccessArrowTransform(point)} d={`M ${point.x} ${point.y + 8} V ${point.y - 8} M ${point.x - 5} ${point.y - 3} L ${point.x} ${point.y - 9} L ${point.x + 5} ${point.y - 3}`} /><text x={point.x} y={point.y + 24}>{point.label}</text></g>)}
          {facilityTool && facilityDraft && <g className={styles.facilityPreview} aria-hidden="true">{facilityTool === "entrance" || facilityTool === "exit" ? <><circle cx={facilityDraft.x} cy={facilityDraft.y} r={12} /><path transform={mapAccessArrowTransform({ x: facilityDraft.x, y: facilityDraft.y, direction: "north" })} d={`M ${facilityDraft.x} ${facilityDraft.y + 8} V ${facilityDraft.y - 8} M ${facilityDraft.x - 5} ${facilityDraft.y - 3} L ${facilityDraft.x} ${facilityDraft.y - 9} L ${facilityDraft.x + 5} ${facilityDraft.y - 3}`} /></> : <rect {...facilityDraft} />}</g>}
          {showGuides && authoring.guides.map(guide => {
            const visible = guidePreview?.id === guide.id ? guidePreview : guide;
            const line = visible.axis === "x" ? { x1: visible.position, x2: visible.position, y1: 0, y2: layout.height } : { x1: 0, x2: layout.width, y1: visible.position, y2: visible.position };
            return <g key={guide.id} data-guide-id={guide.id} className={selectedGuideId === guide.id ? styles.guideSelected : undefined} style={{ pointerEvents: placementTool ? "none" : undefined }} onPointerDown={event => startGuideDrag(event, guide)}><line {...line} className={styles.manualGuide} /><line {...line} className={styles.guideHitArea} style={{ pointerEvents: placementTool ? "none" : undefined, cursor: guide.locked ? "default" : guide.axis === "x" ? "ew-resize" : "ns-resize" }} /></g>;
          })}
          {guideTool && guidePreview && <line className={styles.manualGuide} {...(guideTool === "x" ? { x1: guidePreview.position, x2: guidePreview.position, y1: 0, y2: layout.height } : { x1: 0, x2: layout.width, y1: guidePreview.position, y2: guidePreview.position })} />}
          {snapGuides.map((guide) => guide.axis === "x"
            ? <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.position} x2={guide.position} y1={guide.start} y2={guide.end} aria-hidden="true" />
            : <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.start} x2={guide.end} y1={guide.position} y2={guide.position} aria-hidden="true" />)}
          {/* Every candidate is drawn, confirmed or not: hiding the ones still
              awaiting a decision would hide exactly what the decision is about. */}
          {draftRow?.slots.map((slot, index) => <g key={slot.code} className={draftRow.keep[index] ? styles.draftSlotKept : styles.draftSlot} aria-hidden="true"><rect {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}
          {anchors?.map((anchor) => <g key={`${anchor.index}:${anchor.x}:${anchor.y}`} className={styles.anchor} aria-hidden="true"><circle cx={anchor.x} cy={anchor.y} r={7 * layoutUnitsPerPixel} /><text x={anchor.x} y={anchor.y - 12 * layoutUnitsPerPixel}>{anchor.index}</text></g>)}
          {slotDraftRect && <rect className={styles.manualDraft} {...slotDraftRect} aria-hidden="true" />}
          {rowFrame && <rect className={styles.manualDraft} {...rowFrame} aria-hidden="true" />}
          {framePreview?.ok && framePreview.row.slots.map((slot) => <g key={slot.code} className={styles.framePreview} aria-hidden="true"><rect {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}
          {band && <rect className={styles.band} {...band} aria-hidden="true" />}
          <g className={styles.selectionOverlay} aria-hidden="true" data-selection-overlay="true">
            {selectionBoxes.map((box, index) => <rect key={index} {...(box.width || box.height ? box : { x: box.x - 13, y: box.y - 13, width: 26, height: 26 })} />)}
            {handleBounds && selections.length > 1 && <rect {...handleBounds} />}
          </g>
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
        {!!snapGuides.length && <output className={styles.snapReadout} aria-live="polite">吸附：{snapGuides.map(guide => `${guide.axis.toUpperCase()} ${Number(guide.position.toFixed(2))}`).join("、")}</output>}
        {!!authoring.guides.length && <div className={styles.guidePanel}><label>選取輔助線<select aria-label="選取輔助線" value={selectedGuideId ?? ""} onChange={event => { cancelPlacement(); setSelectedGuideId(event.target.value || null); setSelections([]); setActiveSegment(null); }}><option value="">請選擇</option>{authoring.guides.map(guide => <option key={guide.id} value={guide.id}>{guide.axis === "x" ? "垂直 X" : "水平 Y"} {Number(guide.position.toFixed(2))}{guide.locked ? "（已鎖定）" : ""}</option>)}</select></label>
          {selectedGuide && <><div className={styles.fields}>{numberField(`輔助線 ${selectedGuide.axis.toUpperCase()}`, selectedGuide.position, value => { if (!selectedGuide.locked) updateGuide(selectedGuide, { position: clamp(value, 0, selectedGuide.axis === "x" ? layout.width : layout.height) }, `guide-field:${selectedGuide.id}`); }, selectedGuide.locked)}</div><label><input type="checkbox" checked={selectedGuide.locked} onChange={event => updateGuide(selectedGuide, { locked: event.target.checked })} />鎖定輔助線位置</label><button type="button" className={styles.remove} onClick={deleteGuide}>刪除輔助線</button></>}
        </div>}
        <div className={`${styles.fields} ${styles.canvasSize}`}>
          {numberField("畫布寬", layout.width, (value) => resizeCanvas({ width: value }, "field:canvas:width"))}
          {numberField("畫布高", layout.height, (value) => resizeCanvas({ height: value }, "field:canvas:height"))}
        </div>
        <label className={styles.elementPicker}><span>精確選取地圖元素</span><select aria-label="選取地圖元素" value={activeKey} onChange={(event) => selectElement(event.target.value)}><option value="">請選擇攤位或設施</option>{elementOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {selection?.kind === "slot" && !activeSegment && <div className={styles.rowFormActions}><button type="button" onClick={() => activateSegment(selection.rowIndex, selection.itemIndex)}>編輯整個排段</button></div>}
        {activeSegment && activeSegmentFrame && <div className={styles.rowPanel} aria-label="排段整體調整">
          <b>{layout.rows[activeSegment.rowIndex]?.label} 排段 · {activeSegment.items.length} 格</b>
          <div className={styles.fields}>
            {numberField("排段 X", activeSegmentFrame.x, value => updateSegmentFrame({ x: value }, "x"))}
            {numberField("排段 Y", activeSegmentFrame.y, value => updateSegmentFrame({ y: value }, "y"))}
            {numberField("排段寬", activeSegmentFrame.width, value => updateSegmentFrame({ width: value }, "width"))}
            {numberField("排段高", activeSegmentFrame.height, value => updateSegmentFrame({ height: value }, "height"))}
          </div>
          {!segmentForm && <div className={styles.rowFormActions}><button type="button" onClick={() => openSegmentForm(activeSegment)}>調整排段編號與方向</button><button type="button" onClick={() => { setActiveSegment(null); setSelections([]); setRowErrors([]); }}>結束排段調整</button></div>}
          {segmentForm && <>
            {rowField("排段代碼前綴", segmentForm.codePrefix, codePrefix => setSegmentForm({ ...segmentForm, codePrefix }))}
            <div className={styles.fields}>
              {rowField("排段起始編號", segmentForm.startNumber, startNumber => setSegmentForm({ ...segmentForm, startNumber }))}
              {rowField("排段結束編號", segmentForm.endNumber, endNumber => setSegmentForm({ ...segmentForm, endNumber }))}
              {rowField("排段補零位數", segmentForm.numberPadding, numberPadding => setSegmentForm({ ...segmentForm, numberPadding }))}
            </div>
            <label>排段方向<select value={segmentForm.orientation} onChange={event => { const orientation = event.target.value as MapOrientation; setSegmentForm({ ...segmentForm, orientation, numberingStart: defaultNumberingStart(orientation) }); }}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label>
            <label>排段編號起點<select value={segmentForm.numberingStart} onChange={event => setSegmentForm({ ...segmentForm, numberingStart: event.target.value as RowNumberingStart })}>{NUMBERING_STARTS[segmentForm.orientation].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <p>套用範圍：{segmentCodeRange(segmentForm)}（{Number(segmentForm.endNumber) - Number(segmentForm.startNumber) + 1} 格）</p>
            {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map(error => <span key={error}>{error}</span>)}</div>}
            <div className={styles.rowFormActions}><button type="button" onClick={applySegmentForm}>套用排段編號與方向</button><button type="button" onClick={() => { setSegmentForm(null); setActiveSegment(null); setSelections([]); setRowErrors([]); }}>結束排段調整</button></div>
          </>}
        </div>}
        {slotDrawForm && <div className={styles.rowPanel}>
          <b>手動畫攤位</b>
          <p>在原圖上按住並拖曳攤位外框。建立後會留在描摹模式並自動遞增代碼；使用既有排標籤會直接加入該排。</p>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          <label className={styles.wide}><span>所屬排標籤</span><input list="map-layout-row-labels" value={slotDrawForm.rowLabel} placeholder="例：A、B、商" onChange={(event) => { const rowLabel = event.target.value; setSlotDrawForm({ ...slotDrawForm, rowLabel, code: initialSlotCode(layout, rowLabel) }); setRowErrors([]); }} /><datalist id="map-layout-row-labels">{layout.rows.map((row) => <option key={row.label} value={row.label} />)}</datalist></label>
          {rowField("攤位代碼", slotDrawForm.code, (code) => { setSlotDrawForm({ ...slotDrawForm, code }); setRowErrors([]); }, "例：A01")}
          {!slotDrawExisting && <label className={styles.wide}><span>新排方向</span><select value={slotDrawForm.orientation} onChange={(event) => setSlotDrawForm({ ...slotDrawForm, orientation: event.target.value as MapOrientation })}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label>}
          <p>{slotDrawExisting ? `會加入既有 ${slotDrawExisting.label} 排（目前 ${slotDrawExisting.slots.length} 格）` : "第一次拖曳會同時建立這一排。"}</p>
          <div className={styles.rowFormActions}><button type="button" onClick={toggleSlotDrawForm}>結束描摹</button></div>
        </div>}
        {rowForm && !segmentForm && <div className={styles.rowPanel}>
          <b>新增排／排段</b>
          <p>在原圖上按住並拖曳，框住一個排段，放開就建立。點一格攤位可改抓它整段，拖四角重新分割。</p>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          {rowField("排標籤", rowForm.label, (value) => changeRowForm({ ...rowForm, label: value }), "例：A、子、商")}
          {rowField("代碼前綴", rowForm.codePrefix, (value) => changeRowForm({ ...rowForm, codePrefix: value }), "留空則沿用排標籤")}
          <div className={styles.fields}>
            {rowField("起始編號", rowForm.startNumber, (value) => changeRowForm({ ...rowForm, startNumber: value }))}
            {rowField("結束編號", rowForm.endNumber, (value) => changeRowForm({ ...rowForm, endNumber: value }))}
            {rowField("補零位數", rowForm.numberPadding, (value) => changeRowForm({ ...rowForm, numberPadding: value }))}
          </div>
          <label className={styles.wide}><span>方向</span><select value={rowForm.orientation} onChange={(event) => changeRowOrientation(rowForm, event.target.value as MapOrientation)}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label>
          <label className={styles.wide}><span>編號起點</span><select value={rowForm.numberingStart} onChange={(event) => changeRowNumbering(rowForm, event.target.value as RowNumberingStart)}>{NUMBERING_STARTS[rowForm.orientation].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <p>{rowSlotCount(rowForm) >= 1 ? `下一段：${rowCodeRange}（${rowSlotCount(rowForm)} 格）` : "結束編號必須大於或等於起始編號。"}<br />{rowFormExisting ? `將加入既有 ${rowFormExisting.label} 排（目前 ${rowFormExisting.slots.length} 格）` : "將建立新排"}</p>
          <div className={styles.rowFormActions}><button type="button" onClick={toggleRowForm}>結束新增</button></div>
          <details className={styles.advanced}>
          <summary>進階設定</summary>
          <p>用第一格與最後一格的中心座標建立，適合斜排或刻意留間距的排段。</p>
          <div className={styles.fields}>
            {rowField("起點 X", rowForm.startX, (value) => changeRowForm({ ...rowForm, startX: value }))}
            {rowField("起點 Y", rowForm.startY, (value) => changeRowForm({ ...rowForm, startY: value }))}
            {rowField("終點 X", rowForm.endX, (value) => changeRowForm({ ...rowForm, endX: value }))}
            {rowField("終點 Y", rowForm.endY, (value) => changeRowForm({ ...rowForm, endY: value }))}
            {rowField("每格寬", rowForm.slotWidth, (value) => changeRowForm({ ...rowForm, slotWidth: value }))}
            {rowField("每格高", rowForm.slotHeight, (value) => changeRowForm({ ...rowForm, slotHeight: value }))}
          </div>
          <p>方向：{rowFormOrientation === "horizontal" ? "橫排" : "直排"}（依端點判定）<br />預覽：{rowCodePreview}</p>
          <div className={styles.rowFormActions}><button type="button" className={styles.rowConfirm} onClick={createRow}>用座標建立</button></div>
          <div className={styles.anchorPanel}>
            <b>錨點推算</b>
            <p>只適用同一條等距直線排段；跨走道或另一欄請分開框選。在排段上點選三格以上的中心並填入編號，外框用上方的每格寬高。</p>
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
          </details>
        </div>}
        {!rowForm && !!layout.rows.length && <div className={styles.rowList}>
          <b>已建立的排（{layout.rows.length}）</b>
          <ul>{layout.rows.map((row, rowIndex) => <li key={row.label}>
            <span>{row.label}<small>{row.orientation === "horizontal" ? "橫" : "直"} · {row.slots.length} 格</small></span>
            <button type="button" onClick={() => removeRow(rowIndex)} aria-label={`移除 ${row.label} 排`}>移除整排</button>
          </li>)}</ul>
        </div>}
        {!rowForm && !!copyableSlots && <div className={styles.rowPanel}>
          <b>複製整排</b>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          {rowField("新排標籤", copyLabel, setCopyLabel, "留空則沿用原標籤")}
          <div className={styles.rowFormActions}><button type="button" className={styles.rowConfirm} onClick={copySelectedSlots}>複製選取的 {copyableSlots} 格</button></div>
        </div>}
        {!selections.length && <div className={styles.empty}><b>選取地圖元素</b></div>}
        {selections.length > 1 && !activeSegment && <>
          <div className={styles.selectionTitle}><small>已選取</small><b>{selections.length} 個元素</b></div>
          <div className={styles.batchTools}>
            <button type="button" className={styles.batchWide} onClick={mergeSelectedSlots} disabled={!slotMerge.ok}>合併為一格{slotMerge.ok ? ` ${slotMerge.plan.slot.code}` : ""}</button>
            <button type="button" className={styles.batchWide} onClick={autoArrangeSelection}>自動對齊</button>
            <button type="button" onClick={() => alignSelection("left")}>靠左對齊</button>
            <button type="button" onClick={() => alignSelection("right")}>靠右對齊</button>
            <button type="button" onClick={() => alignSelection("top")}>靠上對齊</button>
            <button type="button" onClick={() => alignSelection("bottom")}>靠下對齊</button>
          </div>
          {/* The reason sits with the button it turns off, and only while every
            * selected element is a booth: a set that mixes in a pillar is a set
            * nobody meant to merge, and saying so would be noise. */}
          {!slotMerge.ok && copyableSlots === selections.length && <p className={styles.hint}>{slotMerge.errors[0]}</p>}
          <button className={styles.remove} onClick={removeSelection}>移除選取的元素</button>
        </>}
        {selection && !activeSegment && <>
          <div className={styles.selectionTitle}><small>{selection.kind === "slot" ? "一般攤位" : selection.kind === "pillar" ? "柱子" : selection.kind === "access" ? "出入口" : selection.kind === "floor" ? "場館外框" : "非一般攤位區"}</small><b>{selection.kind === "floor" ? layout.template : selectedSlot?.code ?? selectedPillar?.id ?? selectedAccess?.id ?? selectedLandmark?.label ?? "未命名"}</b></div>
          {selectedSlot && selectedSlotSelection && <><label className={styles.wide}><span>攤位代碼</span><input {...trimmedField(selectedSlot.code, (next) => commit((draft) => { draft.rows[selectedSlotSelection.rowIndex].slots[selectedSlotSelection.itemIndex].code = next; }, `field:${activeKey}:code`))} /></label><label className={styles.wide}><span>所屬排標籤</span><input {...trimmedField(layout.rows[selectedSlotSelection.rowIndex].label, (next) => updateRow(selectedSlotSelection.rowIndex, { label: next }, `row:${selectedSlotSelection.rowIndex}:label`))} /></label><label className={styles.wide}><span>所屬排方向</span><select value={layout.rows[selectedSlotSelection.rowIndex].orientation} onChange={(event) => updateRow(selectedSlotSelection.rowIndex, { orientation: event.target.value as MapOrientation })}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label></>}
          {selectedPillar && selectedPillarSelection && <label className={styles.wide}><span>柱子 ID</span><input {...trimmedField(selectedPillar.id, (next) => commit((draft) => { draft.pillars[selectedPillarSelection.itemIndex].id = next; }, `field:${activeKey}:id`))} /></label>}
          {selectedLandmark && selectedLandmarkSelection && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedLandmark.label ?? ""} onChange={(event) => { const stableKind = resolveMapLandmarkKind(selectedLandmark); commit((draft) => { draft.landmarks[selectedLandmarkSelection.itemIndex].kind = stableKind; draft.landmarks[selectedLandmarkSelection.itemIndex].label = event.target.value; }, `field:${activeKey}:label`); }} /></label><label className={styles.wide}><span>區域類型</span><select value={selectedLandmarkKind} onChange={(event) => commit((draft) => { draft.landmarks[selectedLandmarkSelection.itemIndex].kind = event.target.value as MapLandmarkKind; })}><option value="enterprise">企業攤</option><option value="stage">舞台</option><option value="other">其他區域</option></select></label></>}
          {selectedAccess && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedAccess.label} onChange={(event) => updateAccess({ label: event.target.value }, `field:${activeKey}:label`)} /></label><label><span>類型</span><select value={selectedAccess.kind} onChange={(event) => updateAccess({ kind: event.target.value as "entrance" | "exit" })}><option value="entrance">入口</option><option value="exit">出口</option></select></label><label><span>方向</span><select value={selectedAccess.direction} onChange={(event) => updateAccess({ direction: event.target.value as MapAccessDirection })}>{MAP_ACCESS_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{ACCESS_DIRECTION_LABELS[direction]}</option>)}</select></label></>}
          <div className={styles.fields}>
            {numberField("X", selectedAccess?.x ?? selectedRect?.x ?? 0, (value) => selectedAccess ? updateAccess({ x: value }, `field:${activeKey}:x`) : updateRect({ x: value }, `field:${activeKey}:x`))}
            {numberField("Y", selectedAccess?.y ?? selectedRect?.y ?? 0, (value) => selectedAccess ? updateAccess({ y: value }, `field:${activeKey}:y`) : updateRect({ y: value }, `field:${activeKey}:y`))}
            {selectedRect && numberField("寬", selectedRect.width, (value) => updateRect({ width: value }, `field:${activeKey}:width`))}
            {selectedRect && numberField("高", selectedRect.height, (value) => updateRect({ height: value }, `field:${activeKey}:height`))}
          </div>
          {selection.kind !== "floor" && <button className={styles.remove} onClick={removeSelection}>移除此元素</button>}
          <p className={styles.hint}>{selectedLandmarkKind === "enterprise" ? "拖曳移動或縮放時會貼齊相鄰企業攤；按住 Alt 可暫停吸附。" : selection.kind === "access" ? "拖曳會直接更新預覽。" : "拖曳物件可移動，拖曳四角可調整大小。"}{selection.kind !== "floor" && " 按 Delete 可移除選取的元素。"}</p>
        </>}
      </aside>
    </div>
  </section>;
}
