"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { EventMapLayout, MapRect } from "./event-map";
import styles from "./map-layout-editor.module.css";

type Selection =
  | { kind: "slot"; rowIndex: number; itemIndex: number }
  | { kind: "pillar"; itemIndex: number }
  | { kind: "access"; itemIndex: number }
  | { kind: "landmark"; itemIndex: number };

type DragState = {
  pointerId: number;
  selection: Selection;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type Props = {
  layout: EventMapLayout;
  backgroundImageUrl?: string;
  onChange: (layout: EventMapLayout) => void;
};

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
  const drag = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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
    setSelection(nextSelection);
    drag.current = { pointerId: event.pointerId, selection: nextSelection, startX: point.x, startY: point.y, originX: position.x, originY: position.y };
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = pointInLayout(event);
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

  const addLandmark = (label: string) => {
    const index = layout.landmarks.length;
    let suffix = index + 1;
    while (layout.landmarks.some((item) => item.id === `landmark-${suffix}`)) suffix += 1;
    commit((draft) => draft.landmarks.push({
      id: `landmark-${suffix}`,
      label,
      rect: { x: draft.width * .42, y: draft.height * .42, width: draft.width * .16, height: draft.height * .1 },
    }));
    setSelection({ kind: "landmark", itemIndex: index });
  };

  const removeLandmark = () => {
    if (!selection || selection.kind !== "landmark") return;
    commit((draft) => draft.landmarks.splice(selection.itemIndex, 1));
    setSelection(null);
  };

  const selectedRect = selection && selection.kind !== "access" ? selectedPosition(layout, selection) as MapRect | undefined : undefined;
  const selectedAccess = selection?.kind === "access" ? layout.accessPoints[selection.itemIndex] : undefined;
  const selectedSlot = selection?.kind === "slot" ? layout.rows[selection.rowIndex]?.slots[selection.itemIndex] : undefined;
  const selectedPillar = selection?.kind === "pillar" ? layout.pillars[selection.itemIndex] : undefined;
  const selectedLandmark = selection?.kind === "landmark" ? layout.landmarks[selection.itemIndex] : undefined;
  const activeKey = selection ? selectionKey(selection) : "";
  const elementOptions: { key: string; label: string; selection: Selection }[] = [
    ...layout.rows.flatMap((row, rowIndex) => row.slots.map((slot, itemIndex) => ({ key: `slot:${rowIndex}:${itemIndex}`, label: `攤位 ${slot.code}`, selection: { kind: "slot", rowIndex, itemIndex } as Selection }))),
    ...layout.pillars.map((pillar, itemIndex) => ({ key: `pillar:${itemIndex}`, label: `柱子 ${pillar.id}`, selection: { kind: "pillar", itemIndex } as Selection })),
    ...layout.accessPoints.map((point, itemIndex) => ({ key: `access:${itemIndex}`, label: `出入口 ${point.label}`, selection: { kind: "access", itemIndex } as Selection })),
    ...layout.landmarks.map((landmark, itemIndex) => ({ key: `landmark:${itemIndex}`, label: `區域 ${landmark.label || landmark.id}`, selection: { kind: "landmark", itemIndex } as Selection })),
  ];

  const numberField = (label: string, value: number, onValue: (value: number) => void) => <label><span>{label}</span><input type="number" step="0.1" value={Number(value.toFixed(2))} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onValue(next); }} /></label>;

  return <section className={styles.editor} aria-label="活動地圖編輯器">
    <header><div><h3>細部位置編輯器</h3><p>點選或拖曳地圖元素；方向鍵微調 1 px，Shift + 方向鍵移動 10 px。</p></div><div className={styles.addTools}><button onClick={() => addLandmark("企業攤")}>新增企業攤</button><button onClick={() => addLandmark("舞台")}>新增舞台</button><button onClick={() => addLandmark("其他區域")}>新增其他區域</button></div></header>
    <div className={styles.workspace}>
      <div className={styles.canvas}>
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="可編輯 FF47 向量地圖" tabIndex={0} onKeyDown={handleKeyDown} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelection(null); }}>
          <rect className={styles.paper} width={layout.width} height={layout.height} />
          {backgroundImageUrl && <image className={styles.sourceImage} href={backgroundImageUrl} width={layout.width} height={layout.height} preserveAspectRatio="none" />}
          <rect className={styles.floor} {...layout.floor} />
          {layout.landmarks.map((landmark, itemIndex) => <g key={landmark.id} className={`${styles.editable} ${activeKey === `landmark:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "landmark", itemIndex })}><rect className={styles.landmark} {...landmark.rect} /><text x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label || "未命名區域"}</text></g>)}
          {layout.rows.map((row, rowIndex) => <g key={row.label}>{row.slots.map((slot, itemIndex) => <g key={slot.code} className={`${styles.editable} ${activeKey === `slot:${rowIndex}:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "slot", rowIndex, itemIndex })}><rect className={styles.slot} {...slot.rect} /><text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .7}>{slot.code}</text></g>)}</g>)}
          {layout.pillars.map((pillar, itemIndex) => <rect key={pillar.id} className={`${styles.editable} ${styles.pillar} ${activeKey === `pillar:${itemIndex}` ? styles.selected : ""}`} {...pillar} onPointerDown={(event) => startDrag(event, { kind: "pillar", itemIndex })} />)}
          {layout.accessPoints.map((point, itemIndex) => <g key={point.id} className={`${styles.editable} ${styles.access} ${point.kind === "entrance" ? styles.entrance : styles.exit} ${activeKey === `access:${itemIndex}` ? styles.selected : ""}`} onPointerDown={(event) => startDrag(event, { kind: "access", itemIndex })}><circle cx={point.x} cy={point.y} r={12} /><path d={`M ${point.x} ${point.y + 8} V ${point.y - 8} M ${point.x - 5} ${point.y - 3} L ${point.x} ${point.y - 9} L ${point.x + 5} ${point.y - 3}`} /><text x={point.x} y={point.y + 24}>{point.label}</text></g>)}
        </svg>
      </div>
      <aside className={styles.inspector} aria-label="選取元素屬性">
        <label className={styles.elementPicker}><span>精確選取地圖元素</span><select aria-label="選取地圖元素" value={activeKey} onChange={(event) => setSelection(elementOptions.find((option) => option.key === event.target.value)?.selection ?? null)}><option value="">請選擇攤位或設施</option>{elementOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        {!selection && <div className={styles.empty}><b>選取地圖元素</b><p>可調整一般攤位、柱子、出入口及企業攤／舞台區域的位置。</p></div>}
        {selection && <>
          <div className={styles.selectionTitle}><small>{selection.kind === "slot" ? "一般攤位" : selection.kind === "pillar" ? "柱子" : selection.kind === "access" ? "出入口" : "非一般攤位區"}</small><b>{selectedSlot?.code ?? selectedPillar?.id ?? selectedAccess?.id ?? selectedLandmark?.label ?? "未命名"}</b></div>
          {selectedLandmark && <label className={styles.wide}><span>顯示名稱</span><input value={selectedLandmark.label ?? ""} onChange={(event) => commit((draft) => { draft.landmarks[selection.itemIndex].label = event.target.value; })} /></label>}
          {selectedAccess && <><label className={styles.wide}><span>顯示名稱</span><input value={selectedAccess.label} onChange={(event) => updateAccess({ label: event.target.value })} /></label><label><span>類型</span><select value={selectedAccess.kind} onChange={(event) => updateAccess({ kind: event.target.value as "entrance" | "exit" })}><option value="entrance">入口</option><option value="exit">出口</option></select></label><label><span>方向</span><select value={selectedAccess.direction} onChange={(event) => updateAccess({ direction: event.target.value as "north" | "south" })}><option value="north">向北</option><option value="south">向南</option></select></label></>}
          <div className={styles.fields}>
            {numberField("X", selectedAccess?.x ?? selectedRect?.x ?? 0, (value) => selectedAccess ? updateAccess({ x: value }) : updateRect({ x: value }))}
            {numberField("Y", selectedAccess?.y ?? selectedRect?.y ?? 0, (value) => selectedAccess ? updateAccess({ y: value }) : updateRect({ y: value }))}
            {selectedRect && numberField("寬", selectedRect.width, (value) => updateRect({ width: value }))}
            {selectedRect && numberField("高", selectedRect.height, (value) => updateRect({ height: value }))}
          </div>
          {selectedLandmark && <button className={styles.remove} onClick={removeLandmark}>移除此區域</button>}
          <p className={styles.hint}>拖曳會直接更新預覽；發布前仍會由 FF47 完整性規則檢查所有座標與必要元素。</p>
        </>}
      </aside>
    </div>
  </section>;
}
