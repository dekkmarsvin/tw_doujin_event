"use client";

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { type EventMapLayout } from "./event-map";
import styles from "./event-map-renderer.module.css";
import { MAP_MEDIA_LABEL_BAND, mapLabelFontSize, type MapLabelPresentation } from "./map-label-presentation";
import { DEFAULT_MAP_MARKER_PRESENTATION, layoutMapMarkerLabels, mapMarkerLabelKey, type MapMarkerLabel, type MapMarkerPresentation } from "./map-marker-presentation";
import { MapAccessBadge, MapServiceBadge } from "./map-marker-icons";
import { MAP_FACILITY_TYPE_LABELS } from "./map-facility-directory";

export type MapSlotView = {
  tone?: "coral" | "mint" | "blue" | "amber" | "lilac";
  label: string;
  ariaLabel: string;
  selected?: boolean;
  favorite?: boolean;
  planned?: boolean;
  visited?: boolean;
  next?: boolean;
  /** Set only when no circle at this booth is still attending. */
  retired?: "cancelled" | "moved";
  thumbnailUrl?: string;
};

type AccessibleEventMapRendererProps = {
  eventName: string;
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  showMedia?: boolean;
  labelPresentation?: MapLabelPresentation;
  /** Sizes access point badges and row, access point and area names on screen. */
  markerPresentation?: MapMarkerPresentation;
  /** Marker key of a facility the reader just located, outlined until cleared. */
  locatedMarker?: string | null;
  onFocusCode?: (code: string | null) => void;
  onSelect: (code: string) => void;
};

export default function AccessibleEventMapRenderer({ eventName, layout, slots, showMedia = false, labelPresentation, markerPresentation = DEFAULT_MAP_MARKER_PRESENTATION, locatedMarker = null, onFocusCode, onSelect }: AccessibleEventMapRendererProps) {
  const clipPrefix = useId().replaceAll(":", "");
  const interactiveSlots = useMemo(() => layout.rows.flatMap((row) => row.slots).filter((slot) => !!slots[slot.code]), [layout.rows, slots]);
  const selectedCode = interactiveSlots.find((slot) => slots[slot.code]?.selected)?.code;
  const [keyboardCode, setKeyboardCode] = useState(selectedCode ?? interactiveSlots[0]?.code ?? "");
  const [focusWithin, setFocusWithin] = useState(false);
  const { screenScale, fontScale } = markerPresentation;
  const markerLabels = useMemo(() => layoutMapMarkerLabels(layout, { screenScale, fontScale }), [fontScale, layout, screenScale]);
  const toScreen = 1 / (Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1);
  // Markers are drawn in screen pixels: a group at the layout anchor undoes the
  // map's scale, so badges and names keep their size while the map zooms.
  const screenGroup = (x: number, y: number) => `translate(${x} ${y}) scale(${toScreen})`;
  const markerText = (label: MapMarkerLabel, className: string) => <text className={className} x={label.dx} y={label.dy} textAnchor={label.anchor} style={{ fontSize: label.fontPx }}>{label.text}</text>;
  const preferredKeyboardCode = focusWithin ? keyboardCode : selectedCode;
  const activeKeyboardCode = interactiveSlots.some((slot) => slot.code === preferredKeyboardCode) ? preferredKeyboardCode : interactiveSlots.some((slot) => slot.code === keyboardCode) ? keyboardCode : interactiveSlots[0]?.code ?? "";

  const activateSlot = (code: string, element: SVGGElement) => {
    const svg = element.ownerSVGElement;
    const hadFocus = element === element.ownerDocument.activeElement;
    onSelect(code);
    // Selection moves the slot into the foreground group. Restore keyboard
    // focus to its replacement node so Enter does not end arrow-key traversal.
    if (hadFocus) requestAnimationFrame(() => svg?.querySelector<SVGGElement>(`[data-slot-code="${code}"]`)?.focus({ preventScroll: true }));
  };

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateSlot(code, event.currentTarget);
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
    requestAnimationFrame(() => svg?.querySelector<SVGGElement>(`[data-slot-code="${next.code}"]`)?.focus({ preventScroll: true }));
  };

  const renderSlot = (slot: EventMapLayout["rows"][number]["slots"][number]) => {
    const view = slots[slot.code];
    const interactive = !!view;
    const hasMedia = !!(showMedia && view?.thumbnailUrl);
    const labelSize = labelPresentation ? mapLabelFontSize(slot.rect, slot.code.slice(1), hasMedia, labelPresentation) : undefined;
    const className = [styles.slot, interactive ? styles.activeSlot : styles.emptySlot, hasMedia ? styles.mediaSlot : "", view?.retired ? styles.retiredSlot : "", view?.selected ? styles.selected : "", view?.visited ? styles.visited : ""].filter(Boolean).join(" ");
    const style = view?.tone ? ({ "--slot-tone": `var(--${view.tone})` } as CSSProperties) : undefined;
    return <g key={slot.code} data-slot-code={slot.code} className={className} style={style} role={interactive ? "button" : undefined} tabIndex={interactive && activeKeyboardCode === slot.code ? 0 : -1} aria-label={view?.ariaLabel} onFocus={interactive ? () => { setKeyboardCode(slot.code); setFocusWithin(true); onFocusCode?.(slot.code); } : undefined} onClick={interactive ? (event) => activateSlot(slot.code, event.currentTarget) : undefined} onKeyDown={interactive ? (event) => handleKeyDown(event, slot.code) : undefined}>
      <rect className={styles.slotSurface} x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} rx={Math.min(2.5, slot.rect.height * .16)} />
      {hasMedia && <image className={styles.slotMedia} href={view.thumbnailUrl} x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipPrefix}-${slot.code})`} aria-hidden="true" />}
      {hasMedia && <rect className={styles.mediaShade} x={slot.rect.x} y={slot.rect.y + slot.rect.height * (1 - MAP_MEDIA_LABEL_BAND)} width={slot.rect.width} height={slot.rect.height * MAP_MEDIA_LABEL_BAND} />}
      <text clipPath={labelPresentation ? `url(#${clipPrefix}-${slot.code})` : undefined} style={labelPresentation && labelSize !== null ? { fontSize: labelSize, dominantBaseline: "central" } : undefined} x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height * (labelPresentation ? (hasMedia ? 1 - MAP_MEDIA_LABEL_BAND / 2 : .5) : (hasMedia ? .88 : .69))}>{slot.code.slice(1)}</text>
      {/* A withdrawal and a move are different destinations, so they are different
          shapes, not two shades of the same one; the label carries the wording. */}
      {view?.retired && <path className={styles.retiredMark} d={view.retired === "cancelled"
        ? `M ${slot.rect.x + 2} ${slot.rect.y + 2} L ${slot.rect.x + slot.rect.width - 2} ${slot.rect.y + slot.rect.height - 2} M ${slot.rect.x + slot.rect.width - 2} ${slot.rect.y + 2} L ${slot.rect.x + 2} ${slot.rect.y + slot.rect.height - 2}`
        : `M ${slot.rect.x + 2} ${slot.rect.y + slot.rect.height / 2} H ${slot.rect.x + slot.rect.width - 2} M ${slot.rect.x + slot.rect.width - 5} ${slot.rect.y + slot.rect.height / 2 - 3} L ${slot.rect.x + slot.rect.width - 2} ${slot.rect.y + slot.rect.height / 2} L ${slot.rect.x + slot.rect.width - 5} ${slot.rect.y + slot.rect.height / 2 + 3}`} />}
      {view?.favorite && <circle className={styles.favoriteMark} cx={slot.rect.x + slot.rect.width - 2.5} cy={slot.rect.y + 2.5} r="2.2" />}
      {view?.planned && !view.next && <circle fill="#d59b37" stroke="#fff" strokeWidth=".6" cx={slot.rect.x + 2.8} cy={slot.rect.y + 2.8} r="1.8" />}
      {view?.visited && <path fill="none" stroke="#4f6559" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d={`M ${slot.rect.x + 1.5} ${slot.rect.y + slot.rect.height / 2} L ${slot.rect.x + slot.rect.width / 2 - 1} ${slot.rect.y + slot.rect.height - 2} L ${slot.rect.x + slot.rect.width - 1.5} ${slot.rect.y + 2}`} />}
      {view?.next && <path className={styles.nextMark} d={`M ${slot.rect.x + 2} ${slot.rect.y + slot.rect.height - 3} L ${slot.rect.x + slot.rect.width - 3} ${slot.rect.y + 3} M ${slot.rect.x + slot.rect.width - 7} ${slot.rect.y + 3} H ${slot.rect.x + slot.rect.width - 3} V ${slot.rect.y + 7}`} />}
      <title>{view?.label ?? `${slot.code} 未配置社團`}</title>
    </g>;
  };

  const selectedSlots = layout.rows.flatMap((row) => row.slots).filter((slot) => slots[slot.code]?.selected);

  return <svg className={styles.map} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocusWithin(false); onFocusCode?.(null); } }} aria-label={`${eventName} 社團攤位配置圖，使用方向鍵移動焦點，Enter 或空白鍵開啟攤位`}>
    <title>{`${eventName} 社團攤位配置圖`}</title>
    {(showMedia || labelPresentation) && <defs>{layout.rows.flatMap((row) => row.slots).flatMap((slot) => labelPresentation || slots[slot.code]?.thumbnailUrl ? [<clipPath key={slot.code} id={`${clipPrefix}-${slot.code}`}><rect x={slot.rect.x} y={slot.rect.y} width={slot.rect.width} height={slot.rect.height} rx={Math.min(2.5, slot.rect.height * .16)} /></clipPath>] : [])}</defs>}
    <rect className={styles.paper} x="0" y="0" width={layout.width} height={layout.height} />
    <rect className={styles.floor} x={layout.floor.x} y={layout.floor.y} width={layout.floor.width} height={layout.floor.height} />
    <g aria-label="非一般攤位區">{layout.landmarks.map((landmark) => <g key={landmark.id} role={landmark.label ? "img" : undefined} aria-label={landmark.label || undefined}><rect className={styles.landmark} {...landmark.rect} /></g>)}</g>
    <g aria-label="一般攤位排">{layout.rows.map((row) => <g key={row.label} data-row={row.label} data-orientation={row.orientation}>
      {row.slots.filter((slot) => !slots[slot.code]?.selected).map(renderSlot)}
    </g>)}<g data-layer="selected-slots">{selectedSlots.map(renderSlot)}</g></g>
    <g aria-label="場內柱子">{layout.pillars.map((pillar) => <rect key={pillar.id} className={styles.pillar} x={pillar.x} y={pillar.y} width={pillar.width} height={pillar.height} rx="1" />)}</g>
    <g className={styles.markerLayer} aria-hidden="true">
      {layout.landmarks.map((landmark) => {
        const key = mapMarkerLabelKey("landmark", landmark.id);
        const label = markerLabels.get(key);
        return <g key={landmark.id} data-marker={key}>
          {locatedMarker === key && <rect className={styles.locatedArea} x={landmark.rect.x} y={landmark.rect.y} width={landmark.rect.width} height={landmark.rect.height} style={{ strokeWidth: 3 * toScreen }} />}
          {label && <g transform={screenGroup(label.x, label.y)}>{markerText(label, styles.landmarkLabel)}</g>}
        </g>;
      })}
      {layout.rows.map((row) => {
        const label = markerLabels.get(mapMarkerLabelKey("row", row.label));
        return label && <g key={row.label} data-marker={mapMarkerLabelKey("row", row.label)} transform={screenGroup(label.x, label.y)}>{markerText(label, styles.rowLabel)}</g>;
      })}
    </g>
    <g className={styles.markerLayer} aria-label="出入口">{layout.accessPoints.map((point) => {
      const key = mapMarkerLabelKey("access", point.id);
      const label = markerLabels.get(key);
      return <g key={point.id} data-marker={key} className={point.kind === "exit" ? styles.exit : point.kind === "both" ? styles.bothWays : styles.entrance} role="img" aria-label={`${point.label || "未命名"}，${MAP_FACILITY_TYPE_LABELS[point.kind]}`} transform={screenGroup(point.x, point.y)}>
        {locatedMarker === key && <circle className={styles.locatedRing} r={17} />}
        <MapAccessBadge kind={point.kind} direction={point.direction} />
        {label && markerText(label, styles.accessLabel)}
      </g>;
    })}</g>
    {layout.servicePoints?.length ? <g className={styles.markerLayer} aria-label="服務設施">{layout.servicePoints.map((point) => {
      const key = mapMarkerLabelKey("service", point.id);
      const label = markerLabels.get(key);
      const type = MAP_FACILITY_TYPE_LABELS[point.kind];
      const name = point.label?.trim();
      return <g key={point.id} data-marker={key} className={styles.service} role="img" aria-label={name && !name.includes(type) ? `${name}，${type}` : name || type} transform={screenGroup(point.x, point.y)}>
        {locatedMarker === key && <circle className={styles.locatedRing} r={17} />}
        <MapServiceBadge kind={point.kind} />
        {label && markerText(label, styles.serviceLabel)}
      </g>;
    })}</g> : null}
  </svg>;
}
