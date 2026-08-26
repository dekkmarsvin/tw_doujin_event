"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { resolveMapLandmarkKind, type EventMapLayout, type MapLandmarkKind, type MapOrientation, type MapRect } from "./event-map";
import { generateRowSlots, resizeRectFromCorner, snapRectToAdjacentRects, type ResizeCorner, type RowDefinition, type SnapGuide } from "./map-layout-editor-geometry";
import { UiIcon } from "./ui-icons";
import styles from "./map-layout-editor.module.css";

type Selection =
  | { kind: "slot"; rowIndex: number; itemIndex: number }
  | { kind: "pillar"; itemIndex: number }
  | { kind: "access"; itemIndex: number }
  | { kind: "landmark"; itemIndex: number };

type MoveDragState = {
  mode: "move";
  pointerId: number;
  selection: Selection;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ResizeDragState = {
  mode: "resize";
  pointerId: number;
  selection: Extract<Selection, { kind: "landmark" }>;
  corner: ResizeCorner;
  startX: number;
  startY: number;
  originRect: MapRect;
};

type DragState = MoveDragState | ResizeDragState;

type Props = {
  layout: EventMapLayout;
  backgroundImageUrl?: string;
  onChange: (layout: EventMapLayout) => void;
};

/** The row form keeps its numeric fields as strings so a half-typed value does
 * not snap back to a default while the maintainer is still typing. */
type RowFormState = {
  label: string;
  orientation: MapOrientation;
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
    orientation: "vertical",
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
    orientation: form.orientation,
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

function selectionKey(selection: Selection) {
  return `${selection.kind}:${selection.kind === "slot" ? `${selection.rowIndex}:` : ""}${selection.itemIndex}`;
}

function selectedPosition(layout: EventMapLayout, selection: Selection) {
  if (selection.kind === "slot") return layout.rows[selection.rowIndex]?.slots[selection.itemIndex]?.rect;
  if (selection.kind === "pillar") return layout.pillars[selection.itemIndex];
  if (selection.kind === "landmark") return layout.landmarks[selection.itemIndex]?.rect;
  return layout.accessPoints[selection.itemIndex];
}

export default function MapLayoutEditor({ layout, backgroundImageUrl, onChange }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoom, setZoom] = useState(MIN_EDITOR_ZOOM);
  const [layoutUnitsPerPixel, setLayoutUnitsPerPixel] = useState(layout.width / 800);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [rowForm, setRowForm] = useState<RowFormState | null>(null);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const drag = useRef<DragState | null>(null);
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

  const commit = (mutate: (draft: EventMapLayout) => void) => {
    const draft = cloneLayout(layout);
    mutate(draft);
    onChange(draft);
  };

  const updateRect = (next: Partial<MapRect>) => {
    if (!selection || selection.kind === "access") return;
    commit((draft) => {
      const rect = selection.kind === "slot"
        ? draft.rows[selection.rowIndex].slots[selection.itemIndex].rect
        : selection.kind === "pillar"
          ? draft.pillars[selection.itemIndex]
          : draft.landmarks[selection.itemIndex].rect;
      const width = clamp(next.width ?? rect.width, .5, draft.width - rect.x);
      const height = clamp(next.height ?? rect.height, .5, draft.height - rect.y);
      rect.x = clamp(next.x ?? rect.x, 0, draft.width - width);
      rect.y = clamp(next.y ?? rect.y, 0, draft.height - height);
      rect.width = clamp(width, .5, draft.width - rect.x);
      rect.height = clamp(height, .5, draft.height - rect.y);
    });
  };

  const updateAccess = (next: Partial<EventMapLayout["accessPoints"][number]>) => {
    if (!selection || selection.kind !== "access") return;
    commit((draft) => {
      const point = draft.accessPoints[selection.itemIndex];
      Object.assign(point, next);
      point.x = clamp(point.x, 0, draft.width);
      point.y = clamp(point.y, 0, draft.height);
    });
  };

  const pointInLayout = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * layout.width / bounds.width,
      y: (event.clientY - bounds.top) * layout.height / bounds.height,
    };
  };

  const startDrag = (event: PointerEvent<SVGElement>, nextSelection: Selection) => {
    const svg = svgRef.current;
    const position = selectedPosition(layout, nextSelection);
    if (!svg || !position) return;
    const bounds = svg.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * layout.width / bounds.width,
      y: (event.clientY - bounds.top) * layout.height / bounds.height,
    };
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSnapGuides([]);
    setSelection(nextSelection);
    drag.current = { mode: "move", pointerId: event.pointerId, selection: nextSelection, startX: point.x, startY: point.y, originX: position.x, originY: position.y };
  };

  const startResize = (event: PointerEvent<SVGElement>, svg: SVGSVGElement, itemIndex: number, corner: ResizeCorner) => {
    const landmark = layout.landmarks[itemIndex];
    if (!landmark) return;
    const bounds = svg.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * layout.width / bounds.width,
      y: (event.clientY - bounds.top) * layout.height / bounds.height,
    };
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
    setSnapGuides([]);
    const nextSelection = { kind: "landmark", itemIndex } as const;
    setSelection(nextSelection);
    drag.current = { mode: "resize", pointerId: event.pointerId, selection: nextSelection, corner, startX: point.x, startY: point.y, originRect: { ...landmark.rect } };
  };

  const handleResizePointerDown = (event: PointerEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const corner = event.currentTarget.dataset.resizeCorner as ResizeCorner | undefined;
    const itemIndex = Number(event.currentTarget.dataset.resizeIndex);
    if (svg && corner && Number.isInteger(itemIndex)) startResize(event, svg, itemIndex, corner);
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = pointInLayout(event);
    if (active.mode === "resize") {
      let nextGuides: SnapGuide[] = [];
      commit((draft) => {
        const target = draft.landmarks[active.selection.itemIndex];
        if (!target) return;
        const resized = resizeRectFromCorner(active.originRect, active.corner, point.x - active.startX, point.y - active.startY, draft);
        if (!event.altKey && resolveMapLandmarkKind(target) === "enterprise") {
          const snapped = snapRectToAdjacentRects(resized, draft.landmarks
            .filter((landmark, itemIndex) => itemIndex !== active.selection.itemIndex && resolveMapLandmarkKind(landmark) === "enterprise")
            .map((landmark) => ({ id: landmark.id, rect: landmark.rect })), { bounds: draft, mode: active.corner, threshold: SNAP_THRESHOLD_PX * layoutUnitsPerPixel });
          target.rect = snapped.rect;
          nextGuides = snapped.guides;
        } else target.rect = resized;
      });
      setSnapGuides(nextGuides);
      return;
    }
    const x = active.originX + point.x - active.startX;
    const y = active.originY + point.y - active.startY;
    if (active.selection.kind === "access") {
      commit((draft) => {
        const target = draft.accessPoints[active.selection.itemIndex];
        target.x = clamp(x, 0, draft.width);
        target.y = clamp(y, 0, draft.height);
      });
      return;
    }
    if (active.selection.kind === "landmark") {
      let nextGuides: SnapGuide[] = [];
      commit((draft) => {
        const target = draft.landmarks[active.selection.itemIndex];
        const moved = { ...target.rect, x: clamp(x, 0, draft.width - target.rect.width), y: clamp(y, 0, draft.height - target.rect.height) };
        if (!event.altKey && resolveMapLandmarkKind(target) === "enterprise") {
          const snapped = snapRectToAdjacentRects(moved, draft.landmarks
            .filter((landmark, itemIndex) => itemIndex !== active.selection.itemIndex && resolveMapLandmarkKind(landmark) === "enterprise")
            .map((landmark) => ({ id: landmark.id, rect: landmark.rect })), { bounds: draft, mode: "move", threshold: SNAP_THRESHOLD_PX * layoutUnitsPerPixel });
          target.rect = snapped.rect;
          nextGuides = snapped.guides;
        } else target.rect = moved;
      });
      setSnapGuides(nextGuides);
      return;
    }
    commit((draft) => {
      const rect = active.selection.kind === "slot"
        ? draft.rows[active.selection.rowIndex].slots[active.selection.itemIndex].rect
        : active.selection.kind === "pillar"
          ? draft.pillars[active.selection.itemIndex]
          : draft.landmarks[active.selection.itemIndex].rect;
      rect.x = clamp(x, 0, draft.width - rect.width);
      rect.y = clamp(y, 0, draft.height - rect.height);
    });
  };

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setSnapGuides([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveSelection = (dx: number, dy: number) => {
    if (!selection) return;
    const position = selectedPosition(layout, selection);
    if (!position) return;
    if (selection.kind === "access") updateAccess({ x: position.x + dx, y: position.y + dy });
    else updateRect({ x: position.x + dx, y: position.y + dy });
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!selection) return;
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    moveSelection(direction[0] * step, direction[1] * step);
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
    setSelection({ kind: "landmark", itemIndex: index });
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
    setSelection({ kind: "slot", rowIndex, itemIndex: layout.rows[rowIndex]?.slots.length ?? 0 });
  };

  const createRow = () => {
    if (!rowForm) return;
    const definition = rowDefinitionFrom(rowForm);
    const result = generateRowSlots(definition, layout);
    if (!result.ok) { setRowErrors(result.errors); return; }
    const label = result.row.label;
    if (layout.rows.some((row) => row.label === label)) { setRowErrors([`排標籤 ${label} 已經存在。`]); return; }
    const existingCodes = new Set(layout.rows.flatMap((row) => row.slots.map(({ code }) => code)));
    const collision = result.row.slots.find(({ code }) => existingCodes.has(code));
    if (collision) { setRowErrors([`攤位代碼 ${collision.code} 與其他排重複。`]); return; }
    const rowIndex = layout.rows.length;
    commit((draft) => draft.rows.push(result.row));
    setRowErrors([]);
    setRowForm(null);
    setSelection({ kind: "slot", rowIndex, itemIndex: 0 });
  };

  const removeRow = (rowIndex: number) => {
    commit((draft) => draft.rows.splice(rowIndex, 1));
    setSelection(null);
  };

  const updateRow = (rowIndex: number, next: Partial<{ label: string; orientation: MapOrientation }>) => {
    commit((draft) => Object.assign(draft.rows[rowIndex], next));
  };

  const addPillar = () => {
    const itemIndex = layout.pillars.length;
    const id = uniqueId("pillar", layout.pillars.map(({ id: value }) => value));
    commit((draft) => draft.pillars.push({
      id, x: draft.width * .48, y: draft.height * .48, width: draft.width * .03, height: draft.height * .03,
    }));
    setSelection({ kind: "pillar", itemIndex });
  };

  const addAccess = (kind: "entrance" | "exit") => {
    const itemIndex = layout.accessPoints.length;
    const id = uniqueId(kind, layout.accessPoints.map(({ id: value }) => value));
    commit((draft) => draft.accessPoints.push({
      id, kind, direction: "north", x: draft.width * .5, y: draft.height * .9,
      label: kind === "entrance" ? "入口" : "出口",
    }));
    setSelection({ kind: "access", itemIndex });
  };

  const removeSelection = () => {
    if (!selection) return;
    commit((draft) => {
      if (selection.kind === "slot") {
        draft.rows[selection.rowIndex].slots.splice(selection.itemIndex, 1);
        if (draft.rows[selection.rowIndex].slots.length === 0) draft.rows.splice(selection.rowIndex, 1);
      } else if (selection.kind === "pillar") draft.pillars.splice(selection.itemIndex, 1);
      else if (selection.kind === "access") draft.accessPoints.splice(selection.itemIndex, 1);
      else draft.landmarks.splice(selection.itemIndex, 1);
    });
    setSelection(null);
  };

  const selectedRect = selection && selection.kind !== "access" ? selectedPosition(layout, selection) as MapRect | undefined : undefined;
  const selectedAccess = selection?.kind === "access" ? layout.accessPoints[selection.itemIndex] : undefined;
  const selectedSlotSelection = selection?.kind === "slot" ? selection : undefined;
  const selectedSlot = selection?.kind === "slot" ? layout.rows[selection.rowIndex]?.slots[selection.itemIndex] : undefined;
  const selectedPillarSelection = selection?.kind === "pillar" ? selection : undefined;
  const selectedPillar = selection?.kind === "pillar" ? layout.pillars[selection.itemIndex] : undefined;
  const selectedLandmark = selection?.kind === "landmark" ? layout.landmarks[selection.itemIndex] : undefined;
  const selectedLandmarkKind = selectedLandmark ? resolveMapLandmarkKind(selectedLandmark) : undefined;
  const selectedLandmarkIndex = selection?.kind === "landmark" ? selection.itemIndex : -1;
  const resizeHitRadius = 14 * layoutUnitsPerPixel;
  const resizeKnobHalfSize = 6 * layoutUnitsPerPixel;
  const activeKey = selection ? selectionKey(selection) : "";
  const elementOptions: { key: string; label: string; selection: Selection }[] = [
    ...layout.rows.flatMap((row, rowIndex) => row.slots.map((slot, itemIndex) => ({ key: `slot:${rowIndex}:${itemIndex}`, label: `攤位 ${slot.code}`, selection: { kind: "slot", rowIndex, itemIndex } as Selection }))),
    ...layout.pillars.map((pillar, itemIndex) => ({ key: `pillar:${itemIndex}`, label: `柱子 ${pillar.id}`, selection: { kind: "pillar", itemIndex } as Selection })),
    ...layout.accessPoints.map((point, itemIndex) => ({ key: `access:${itemIndex}`, label: `出入口 ${point.label}`, selection: { kind: "access", itemIndex } as Selection })),
    ...layout.landmarks.map((landmark, itemIndex) => ({ key: `landmark:${itemIndex}`, label: `區域 ${landmark.label || landmark.id}`, selection: { kind: "landmark", itemIndex } as Selection })),
  ];

  const focusSelection = (nextSelection: Selection) => {
    const viewport = viewportRef.current;
    const position = selectedPosition(layout, nextSelection);
    if (!viewport || !position) return;
    const centerX = position.x + ("width" in position ? position.width / 2 : 0);
    const centerY = position.y + ("height" in position ? position.height / 2 : 0);
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
    setSelection(option?.selection ?? null);
    if (option) requestAnimationFrame(() => focusSelection(option.selection));
  };

  const rowField = (label: string, value: string, onValue: (value: string) => void, placeholder?: string) =>
    <label className={styles.wide}><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onValue(event.target.value)} /></label>;

  const rowCodePreview = (() => {
    if (!rowForm) return "";
    const definition = rowDefinitionFrom(rowForm);
    const result = generateRowSlots(definition, layout);
    if (!result.ok) return "尚無法預覽";
    const codes = result.row.slots.map(({ code }) => code);
    return codes.length > 3 ? `${codes.slice(0, 2).join("、")}…${codes.at(-1)}` : codes.join("、");
  })();

  const numberField = (label: string, value: number, onValue: (value: number) => void) => <label><span>{label}</span><input type="number" step="0.1" value={Number(value.toFixed(2))} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onValue(next); }} /></label>;

  return <section className={styles.editor} aria-label="活動地圖編輯器">
    <header><div><h3>細部位置編輯器</h3><p>以「新增一排」一次產生整排攤位，或逐一新增並拖曳攤位、柱子、出入口與區域；非一般攤位區可拖曳四角調整大小。方向鍵微調 1 px，Shift + 方向鍵移動 10 px。</p></div><div className={styles.addTools}><button onClick={() => { setRowErrors([]); setRowForm((current) => current ? null : blankRowForm(layout)); }} aria-expanded={!!rowForm}>新增一排</button><button onClick={addSlot}>新增攤位</button><button onClick={addPillar}>新增柱子</button><button onClick={() => addAccess("entrance")}>新增入口</button><button onClick={() => addAccess("exit")}>新增出口</button><button onClick={() => addLandmark("enterprise", "企業攤")}>新增企業攤</button><button onClick={() => addLandmark("stage", "舞台")}>新增舞台</button><button onClick={() => addLandmark("other", "其他區域")}>新增其他區域</button></div></header>
    <div className={styles.workspace}>
      <div className={styles.canvas}>
        <div className={styles.canvasToolbar} aria-label="編輯器地圖縮放控制"><span>檢視倍率</span><div><button aria-label="縮小編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom <= MIN_EDITOR_ZOOM} onClick={() => changeZoom(zoom - EDITOR_ZOOM_STEP)}><UiIcon name="minus" /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button aria-label="放大編輯地圖" aria-controls="map-layout-editor-canvas" disabled={zoom >= MAX_EDITOR_ZOOM} onClick={() => changeZoom(zoom + EDITOR_ZOOM_STEP)}><UiIcon name="plus" /></button><button aria-label="重設編輯地圖倍率" onClick={resetView}><UiIcon name="locate" /><span>重設倍率</span></button><button aria-label="聚焦選取的地圖元素" disabled={!selection} onClick={() => selection && focusSelection(selection)}><UiIcon name="map-pin" /><span>聚焦選取</span></button></div></div>
        <div ref={viewportRef} id="map-layout-editor-canvas" className={styles.canvasViewport}>
        <div className={styles.zoomSurface} style={{ width: `${zoom * 100}%`, aspectRatio: `${layout.width} / ${layout.height}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={`可編輯 ${layout.template} 向量地圖，目前 ${Math.round(zoom * 100)}%`} tabIndex={0} onKeyDown={handleKeyDown} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelection(null); }}>
          <rect className={styles.paper} width={layout.width} height={layout.height} />
          {backgroundImageUrl && <image className={styles.sourceImage} href={backgroundImageUrl} width={layout.width} height={layout.height} preserveAspectRatio="none" />}
          <rect className={styles.floor} {...layout.floor} />
          {layout.landmarks.map((landmark, itemIndex) => <g key={landmark.id} className={`${styles.editable} ${activeKey === `landmark:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "landmark", itemIndex })}><rect className={styles.landmark} {...landmark.rect} /><text x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label || "未命名區域"}</text></g>)}
          {layout.rows.map((row, rowIndex) => <g key={row.label}>{row.slots.map((slot, itemIndex) => <g key={slot.code} className={`${styles.editable} ${activeKey === `slot:${rowIndex}:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "slot", rowIndex, itemIndex })}><rect className={styles.slot} {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}</g>)}
          {layout.pillars.map((pillar, itemIndex) => <rect key={pillar.id} className={`${styles.editable} ${styles.pillar} ${activeKey === `pillar:${itemIndex}` ? styles.selected : ""}`} {...pillar} onPointerDown={(event) => startDrag(event, { kind: "pillar", itemIndex })} />)}
          {layout.accessPoints.map((point, itemIndex) => <g key={point.id} className={`${styles.editable} ${styles.access} ${point.kind === "entrance" ? styles.entrance : styles.exit} ${activeKey === `access:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "access", itemIndex })}><circle cx={point.x} cy={point.y} r={12} /><path d={`M ${point.x} ${point.y + 8} V ${point.y - 8} M ${point.x - 5} ${point.y - 3} L ${point.x} ${point.y - 9} L ${point.x + 5} ${point.y - 3}`} /><text x={point.x} y={point.y + 24}>{point.label}</text></g>)}
          {snapGuides.map((guide) => guide.axis === "x"
            ? <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.position} x2={guide.position} y1={guide.start} y2={guide.end} aria-hidden="true" />
            : <line key={`${guide.axis}:${guide.targetId}`} className={styles.snapGuide} x1={guide.start} x2={guide.end} y1={guide.position} y2={guide.position} aria-hidden="true" />)}
          {selectedLandmark && ([
            ["nw", selectedLandmark.rect.x, selectedLandmark.rect.y],
            ["ne", selectedLandmark.rect.x + selectedLandmark.rect.width, selectedLandmark.rect.y],
            ["se", selectedLandmark.rect.x + selectedLandmark.rect.width, selectedLandmark.rect.y + selectedLandmark.rect.height],
            ["sw", selectedLandmark.rect.x, selectedLandmark.rect.y + selectedLandmark.rect.height],
          ] as const).map(([corner, x, y]) => <g key={corner} data-resize-corner={corner} data-resize-index={selectedLandmarkIndex} className={`${styles.resizeHandle} ${corner === "nw" || corner === "se" ? styles.resizeNwSe : styles.resizeNeSw}`} aria-hidden="true" onPointerDown={handleResizePointerDown}><circle className={styles.resizeHitArea} cx={x} cy={y} r={resizeHitRadius} /><rect className={styles.resizeKnob} x={x - resizeKnobHalfSize} y={y - resizeKnobHalfSize} width={resizeKnobHalfSize * 2} height={resizeKnobHalfSize * 2} rx={2 * layoutUnitsPerPixel} /></g>)}
        </svg>
        </div>
        </div>
      </div>
      <aside className={styles.inspector} aria-label="選取元素屬性">
        <label className={styles.elementPicker}><span>精確選取地圖元素</span><select aria-label="選取地圖元素" value={activeKey} onChange={(event) => selectElement(event.target.value)}><option value="">請選擇攤位或設施</option>{elementOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {rowForm && <div className={styles.rowPanel}>
          <b>新增一排</b>
          <p>起點與終點是這一排第一格與最後一格的中心；格數決定中間如何等分。排標籤可以是任意文字。</p>
          {!!rowErrors.length && <div className={styles.rowErrors} role="alert">{rowErrors.map((message) => <span key={message}>{message}</span>)}</div>}
          {rowField("新排標籤", rowForm.label, (value) => setRowForm({ ...rowForm, label: value }), "例：A、子、商")}
          <label><span>方向</span><select value={rowForm.orientation} onChange={(event) => setRowForm({ ...rowForm, orientation: event.target.value as MapOrientation })}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label>
          <div className={styles.fields}>
            {rowField("起點 X", rowForm.startX, (value) => setRowForm({ ...rowForm, startX: value }))}
            {rowField("起點 Y", rowForm.startY, (value) => setRowForm({ ...rowForm, startY: value }))}
            {rowField("終點 X", rowForm.endX, (value) => setRowForm({ ...rowForm, endX: value }))}
            {rowField("終點 Y", rowForm.endY, (value) => setRowForm({ ...rowForm, endY: value }))}
            {rowField("格數", rowForm.slotCount, (value) => setRowForm({ ...rowForm, slotCount: value }))}
            {rowField("每格寬", rowForm.slotWidth, (value) => setRowForm({ ...rowForm, slotWidth: value }))}
            {rowField("每格高", rowForm.slotHeight, (value) => setRowForm({ ...rowForm, slotHeight: value }))}
            {rowField("起始編號", rowForm.startNumber, (value) => setRowForm({ ...rowForm, startNumber: value }))}
            {rowField("補零位數", rowForm.numberPadding, (value) => setRowForm({ ...rowForm, numberPadding: value }))}
          </div>
          {rowField("代碼前綴", rowForm.codePrefix, (value) => setRowForm({ ...rowForm, codePrefix: value }), "留空則沿用排標籤")}
          <p>預覽：{rowCodePreview}</p>
          <div className={styles.rowFormActions}><button type="button" onClick={() => { setRowForm(null); setRowErrors([]); }}>取消</button><button type="button" className={styles.rowConfirm} onClick={createRow}>建立這一排</button></div>
        </div>}
        {!rowForm && !!layout.rows.length && <div className={styles.rowList}>
          <b>已建立的排（{layout.rows.length}）</b>
          <ul>{layout.rows.map((row, rowIndex) => <li key={row.label}>
            <span>{row.label}<small>{row.orientation === "horizontal" ? "橫" : "直"} · {row.slots.length} 格</small></span>
            <button type="button" onClick={() => removeRow(rowIndex)} aria-label={`移除 ${row.label} 排`}>移除整排</button>
          </li>)}</ul>
        </div>}
        {!selection && <div className={styles.empty}><b>選取地圖元素</b><p>可調整一般攤位、柱子、出入口及企業攤／舞台區域的位置。</p></div>}
        {selection && <>
          <div className={styles.selectionTitle}><small>{selection.kind === "slot" ? "一般攤位" : selection.kind === "pillar" ? "柱子" : selection.kind === "access" ? "出入口" : "非一般攤位區"}</small><b>{selectedSlot?.code ?? selectedPillar?.id ?? selectedAccess?.id ?? selectedLandmark?.label ?? "未命名"}</b></div>
          {selectedSlot && selectedSlotSelection && <><label className={styles.wide}><span>攤位代碼</span><input value={selectedSlot.code} onChange={(event) => { const next = event.target.value.trim(); commit((draft) => { draft.rows[selectedSlotSelection.rowIndex].slots[selectedSlotSelection.itemIndex].code = next; }); }} /></label><label className={styles.wide}><span>所屬排標籤</span><input value={layout.rows[selectedSlotSelection.rowIndex].label} onChange={(event) => updateRow(selectedSlotSelection.rowIndex, { label: event.target.value.trim() })} /></label><label className={styles.wide}><span>所屬排方向</span><select value={layout.rows[selectedSlotSelection.rowIndex].orientation} onChange={(event) => updateRow(selectedSlotSelection.rowIndex, { orientation: event.target.value as MapOrientation })}><option value="vertical">直排</option><option value="horizontal">橫排</option></select></label></>}
          {selectedPillar && selectedPillarSelection && <label className={styles.wide}><span>柱子 ID</span><input value={selectedPillar.id} onChange={(event) => { const next = event.target.value.trim(); commit((draft) => { draft.pillars[selectedPillarSelection.itemIndex].id = next; }); }} /></label>}
          {selectedLandmark && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedLandmark.label ?? ""} onChange={(event) => { const stableKind = resolveMapLandmarkKind(selectedLandmark); commit((draft) => { draft.landmarks[selection.itemIndex].kind = stableKind; draft.landmarks[selection.itemIndex].label = event.target.value; }); }} /></label><label className={styles.wide}><span>區域類型</span><select value={selectedLandmarkKind} onChange={(event) => commit((draft) => { draft.landmarks[selection.itemIndex].kind = event.target.value as MapLandmarkKind; })}><option value="enterprise">企業攤</option><option value="stage">舞台</option><option value="other">其他區域</option></select></label></>}
          {selectedAccess && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedAccess.label} onChange={(event) => updateAccess({ label: event.target.value })} /></label><label><span>類型</span><select value={selectedAccess.kind} onChange={(event) => updateAccess({ kind: event.target.value as "entrance" | "exit" })}><option value="entrance">入口</option><option value="exit">出口</option></select></label><label><span>方向</span><select value={selectedAccess.direction} onChange={(event) => updateAccess({ direction: event.target.value as "north" | "south" })}><option value="north">向北</option><option value="south">向南</option></select></label></>}
          <div className={styles.fields}>
            {numberField("X", selectedAccess?.x ?? selectedRect?.x ?? 0, (value) => selectedAccess ? updateAccess({ x: value }) : updateRect({ x: value }))}
            {numberField("Y", selectedAccess?.y ?? selectedRect?.y ?? 0, (value) => selectedAccess ? updateAccess({ y: value }) : updateRect({ y: value }))}
            {selectedRect && numberField("寬", selectedRect.width, (value) => updateRect({ width: value }))}
            {selectedRect && numberField("高", selectedRect.height, (value) => updateRect({ height: value }))}
          </div>
          <button className={styles.remove} onClick={removeSelection}>移除此元素</button>
          <p className={styles.hint}>{selectedLandmarkKind === "enterprise" ? "拖曳移動或縮放時會貼齊相鄰企業攤；按住 Alt 可暫停吸附。" : selectedLandmark ? "拖曳物件可移動，拖曳四角可調整大小。" : "拖曳會直接更新預覽；"}提交前仍會由伺服器檢查座標、代碼與必要元素。</p>
        </>}
      </aside>
    </div>
  </section>;
}
