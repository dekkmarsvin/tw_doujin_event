"use client";

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { EventMapLayout } from "./event-map";
import styles from "./event-map-renderer.module.css";

export type MapSlotView = {
  tone?: "coral" | "mint" | "blue" | "amber" | "lilac";
  label: string;
  ariaLabel: string;
  selected?: boolean;
  favorite?: boolean;
  planned?: boolean;
  visited?: boolean;
  next?: boolean;
  thumbnailUrl?: string;
};

export type AccessibleEventMapRendererProps = {
  eventName: string;
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  showMedia?: boolean;
  onSelect: (code: string) => void;
};

export default function AccessibleEventMapRenderer({ eventName, layout, slots, showMedia = false, onSelect }: AccessibleEventMapRendererProps) {
  const clipPrefix = useId().replaceAll(":", "");
  const interactiveSlots = useMemo(() => layout.rows.flatMap((row) => row.slots).filter((slot) => !!slots[slot.code]), [layout.rows, slots]);
  const selectedCode = interactiveSlots.find((slot) => slots[slot.code]?.selected)?.code;
  const [keyboardCode, setKeyboardCode] = useState(selectedCode ?? interactiveSlots[0]?.code ?? "");
  const activeKeyboardCode = selectedCode ?? (interactiveSlots.some((slot) => slot.code === keyboardCode) ? keyboardCode : interactiveSlots[0]?.code ?? "");

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(code);
      return;
    }
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    const current = interactiveSlots.find((slot) => slot.code === code);
    if (!current) return;
    event.preventDefault();
    const cx = current.rect.x + current.rect.width / 2;
    const cy = current.rect.y + current.rect.height / 2;
    const next = interactiveSlots
      .filter((slot) => {
        const dx = slot.rect.x + slot.rect.width / 2 - cx;
        const dy = slot.rect.y + slot.rect.height / 2 - cy;
        return direction.x ? Math.sign(dx) === direction.x : Math.sign(dy) === direction.y;
      })
      .map((slot) => {
        const dx = slot.rect.x + slot.rect.width / 2 - cx;
        const dy = slot.rect.y + slot.rect.height / 2 - cy;
        const primary = direction.x ? Math.abs(dx) : Math.abs(dy);
        const secondary = direction.x ? Math.abs(dy) : Math.abs(dx);
        return { slot, score: primary + secondary * 2.5 };
      })
      .sort((a, b) => a.score - b.score)[0]?.slot;
    if (!next) return;
    setKeyboardCode(next.code);
    const svg = event.currentTarget.ownerSVGElement;
    requestAnimationFrame(() => svg?.querySelector<SVGGElement>(`[data-slot-code="${next.code}"]`)?.focus());
  };

  const renderSlot = (slot: EventMapLayout["rows"][number]["slots"][number]) => {
    const view = slots[slot.code];
    const interactive = !!view;
    const hasMedia = !!(showMedia && view?.thumbnailUrl);
    const className = [styles.slot, interactive ? styles.activeSlot : styles.emptySlot, hasMedia ? styles.mediaSlot : "", view?.selected ? styles.selected : "", view?.visited ? styles.visited : ""].filter(Boolean).join(" ");
    const style = view?.tone ? ({ "--slot-tone": `var(--${view.tone})` } as CSSProperties) : undefined;
    return <g key={slot.code} data-slot-code={slot.code} className={className} style={style} role={interactive ? "button" : undefined} tabIndex={interactive && activeKeyboardCode === slot.code ? 0 : -1} aria-label={view?.ariaLabel} onFocus={interactive ? () => setKeyboardCode(slot.code) : undefined} onClick={interactive ? () => onSelect(slot.code) : undefined} onKeyDown={interactive ? (event) => handleKeyDown(event, slot.code) : undefined}>
      <rect className={styles.slotSurface} x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} rx={Math.min(2.5, slot.rect.height * .16)} />
      {hasMedia && <image className={styles.slotMedia} href={view.thumbnailUrl} x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipPrefix}-${slot.code})`} aria-hidden="true" />}
      {hasMedia && <rect className={styles.mediaShade} x={slot.rect.x} y={slot.rect.y + slot.rect.height * .62} width={slot.rect.width} height={slot.rect.height * .38} />}
      <text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * (hasMedia ? .88 : .69)}>{slot.code.slice(1)}</text>
      {view?.favorite && <circle className={styles.favoriteMark} cx={slot.rect.x + slot.rect.width - 2.5} cy={slot.rect.y + 2.5} r="2.2" />}
      {view?.planned && !view.next && <circle fill="#d59b37" stroke="#fff" strokeWidth=".6" cx={slot.rect.x + 2.8} cy={slot.rect.y + 2.8} r="1.8" />}
      {view?.visited && <path fill="none" stroke="#4f6559" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d={`M ${slot.rect.x + 1.5} ${slot.rect.y + slot.rect.height / 2} L ${slot.rect.x + slot.rect.width / 2 - 1} ${slot.rect.y + slot.rect.height - 2} L ${slot.rect.x + slot.rect.width - 1.5} ${slot.rect.y + 2}`} />}
      {view?.next && <path className={styles.nextMark} d={`M ${slot.rect.x + 2} ${slot.rect.y + slot.rect.height - 3} L ${slot.rect.x + slot.rect.width - 3} ${slot.rect.y + 3} M ${slot.rect.x + slot.rect.width - 7} ${slot.rect.y + 3} H ${slot.rect.x + slot.rect.width - 3} V ${slot.rect.y + 7}`} />}
      <title>{view?.label ?? `${slot.code} 未配置社團`}</title>
    </g>;
  };

  const selectedSlots = layout.rows.flatMap((row) => row.slots).filter((slot) => slots[slot.code]?.selected);

  return <svg className={styles.map} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${eventName} 社團攤位配置圖，使用方向鍵移動焦點，Enter 或空白鍵開啟攤位`}>
    <title>{eventName} 社團攤位配置圖</title>
    {showMedia && <defs>{layout.rows.flatMap((row) => row.slots).flatMap((slot) => slots[slot.code]?.thumbnailUrl ? [<clipPath key={slot.code} id={`${clipPrefix}-${slot.code}`}><rect x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} rx={Math.min(2.5, slot.rect.height * .16)} /></clipPath>] : [])}</defs>}
    <rect className={styles.paper} x="0" y="0" width={layout.width} height={layout.height} />
    <rect className={styles.floor} x={layout.floor.x} y={layout.floor.y} width={layout.floor.width} height={layout.floor.height} />
    <g aria-label="非一般攤位區">{layout.landmarks.map((landmark) => <g key={landmark.id}><rect className={styles.landmark} {...landmark.rect} />{landmark.label && <text className={styles.landmarkLabel} x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label}</text>}</g>)}</g>
    <g aria-label="一般攤位排">{layout.rows.map((row) => <g key={row.label} data-row={row.label} data-orientation={row.orientation}>
      {row.slots.filter((slot) => !slots[slot.code]?.selected).map(renderSlot)}
      {row.slots.length > 0 && (() => {
        const minX = Math.min(...row.slots.map((slot) => slot.rect.x));
        const maxX = Math.max(...row.slots.map((slot) => slot.rect.x + slot.rect.width));
        const minY = Math.min(...row.slots.map((slot) => slot.rect.y));
        const maxY = Math.max(...row.slots.map((slot) => slot.rect.y + slot.rect.height));
        return <text className={styles.rowLabel} x={(minX + maxX) / 2} y={row.orientation === "horizontal" ? maxY + 30 : minY - 13}>{row.label}</text>;
      })()}
    </g>)}<g data-layer="selected-slots">{selectedSlots.map(renderSlot)}</g></g>
    <g aria-label="場內柱子">{layout.pillars.map((pillar) => <rect key={pillar.id} className={styles.pillar} x={pillar.x} y={pillar.y} width={pillar.width} height={pillar.height} rx="1" />)}</g>
    <g aria-label="出入口">{layout.accessPoints.map((point) => <g key={point.id} className={point.kind === "entrance" ? styles.entrance : styles.exit}><line x1={point.x} y1={point.y + 24} x2={point.x} y2={point.y - 20} /><path d={`M ${point.x - 7} ${point.y - 10} L ${point.x} ${point.y - 22} L ${point.x + 7} ${point.y - 10}`} /><text x={point.x} y={point.kind === "exit" ? point.y - 34 : point.y + 42}>{point.label}</text></g>)}</g>
  </svg>;
}
