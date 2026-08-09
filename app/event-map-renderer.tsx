"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { EventMapLayout } from "./event-map";
import styles from "./event-map-renderer.module.css";

export type MapSlotView = {
  tone?: "coral" | "mint" | "blue" | "amber" | "lilac";
  label: string;
  ariaLabel: string;
  selected?: boolean;
  favorite?: boolean;
  next?: boolean;
};

type Props = {
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  onSelect: (code: string) => void;
};

export default function EventMapRenderer({ layout, slots, onSelect }: Props) {
  const activate = (event: KeyboardEvent<SVGGElement>, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(code);
    }
  };

  return <svg className={styles.map} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="FF47 社團攤位配置圖">
    <rect className={styles.paper} x="0" y="0" width={layout.width} height={layout.height} />
    <rect className={styles.floor} x={layout.floor.x} y={layout.floor.y} width={layout.floor.width} height={layout.floor.height} />

    <g aria-label="非一般攤位區">
      {layout.landmarks.map((landmark) => <g key={landmark.id}>
        <rect className={styles.landmark} {...landmark.rect} />
        {landmark.label && <text className={styles.landmarkLabel} x={landmark.rect.x + landmark.rect.width / 2} y={landmark.rect.y + landmark.rect.height / 2}>{landmark.label}</text>}
      </g>)}
    </g>

    <g aria-label="一般攤位排">
      {layout.rows.map((row) => <g key={row.label} data-row={row.label} data-orientation={row.orientation}>
        {row.slots.map((slot) => {
          const view = slots[slot.code];
          const interactive = !!view;
          const className = [styles.slot, interactive ? styles.activeSlot : styles.emptySlot, view?.selected ? styles.selected : "", view?.favorite ? styles.favorite : "", view?.next ? styles.next : ""].filter(Boolean).join(" ");
          const style = view?.tone ? ({ "--slot-tone": `var(--${view.tone})` } as CSSProperties) : undefined;
          return <g key={slot.code} className={className} style={style} role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : -1} aria-label={view?.ariaLabel} onClick={interactive ? () => onSelect(slot.code) : undefined} onKeyDown={interactive ? (event) => activate(event, slot.code) : undefined}>
            <rect className={styles.slotSurface} x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} rx={Math.min(2.5, slot.rect.height * .16)} />
            <text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * .69}>{slot.code.slice(1)}</text>
            {view?.favorite && <circle className={styles.favoriteMark} cx={slot.rect.x + slot.rect.width - 2.5} cy={slot.rect.y + 2.5} r="2.2" />}
            {view?.next && <path className={styles.nextMark} d={`M ${slot.rect.x + 2} ${slot.rect.y + slot.rect.height - 3} L ${slot.rect.x + slot.rect.width - 3} ${slot.rect.y + 3} M ${slot.rect.x + slot.rect.width - 7} ${slot.rect.y + 3} H ${slot.rect.x + slot.rect.width - 3} V ${slot.rect.y + 7}`} />}
            <title>{view?.label ?? `${slot.code} 未配置社團`}</title>
          </g>;
        })}
        {row.slots.length > 0 && (() => {
          const minX = Math.min(...row.slots.map((slot) => slot.rect.x));
          const maxX = Math.max(...row.slots.map((slot) => slot.rect.x + slot.rect.width));
          const minY = Math.min(...row.slots.map((slot) => slot.rect.y));
          const maxY = Math.max(...row.slots.map((slot) => slot.rect.y + slot.rect.height));
          return <text className={styles.rowLabel} x={(minX + maxX) / 2} y={row.orientation === "horizontal" ? maxY + 30 : minY - 13}>{row.label}</text>;
        })()}
      </g>)}
    </g>

    <g aria-label="場內柱子">
      {layout.pillars.map((pillar) => <rect key={pillar.id} className={styles.pillar} x={pillar.x} y={pillar.y} width={pillar.width} height={pillar.height} rx="1" />)}
    </g>

    <g aria-label="出入口">
      {layout.accessPoints.map((point) => <g key={point.id} className={point.kind === "entrance" ? styles.entrance : styles.exit}>
        <line x1={point.x} y1={point.y + 24} x2={point.x} y2={point.y - 20} />
        <path d={`M ${point.x - 7} ${point.y - 10} L ${point.x} ${point.y - 22} L ${point.x + 7} ${point.y - 10}`} />
        <text x={point.x} y={point.kind === "exit" ? point.y - 34 : point.y + 42}>{point.label}</text>
      </g>)}
    </g>
  </svg>;
}
