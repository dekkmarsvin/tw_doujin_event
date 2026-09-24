"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { MapFacilityEntry, MapLegendEntry } from "./map-facility-directory";
import { MapAccessBadge } from "./map-marker-icons";
import styles from "./event-map-app.module.css";

function FacilitySymbol({ kind }: { kind: MapFacilityEntry["kind"] | MapLegendEntry["kind"] }) {
  if (kind === "entrance" || kind === "exit") return <svg className={styles.facilitySymbol} viewBox="-12 -12 24 24" aria-hidden="true"><MapAccessBadge kind={kind} direction="north" /></svg>;
  if (kind === "pillar") return <svg className={styles.facilitySymbol} viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" fill="#151918" /></svg>;
  return <svg className={styles.facilitySymbol} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5" fill="#f0eee7" stroke="#89918b" strokeWidth="1.5" /></svg>;
}

/**
 * The reader's list of this map's entrances, exits and named areas, with a
 * legend for what the map draws. Choosing an entry locates it on the map. The
 * panel opens with focus on its first entry; Escape returns focus to the
 * button that opened it, and a press outside closes it without taking over
 * that press, so a pan or a booth tap still happens, and returns focus to the
 * button unless the press itself moved focus somewhere.
 */
export default function MapFacilityPanel({ id, entries, legend, triggerRef, onClose, onLocate }: {
  id: string;
  entries: MapFacilityEntry[];
  legend: MapLegendEntry[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (returnFocus: boolean) => void;
  onLocate: (entry: MapFacilityEntry) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (panelRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      onClose(false);
      // The press carries on: a pan pans and a booth or a field takes focus.
      // Only when it ends with focus nowhere does focus go back to 設施 — and
      // only then, since pressing the empty map blurs whatever was focused.
      // A tap's emulated mousedown lands after pointerup and blurs again, so
      // the check waits for the click; a drag that ends without one falls back
      // to a timer.
      let fallback: number | undefined;
      const restore = () => {
        window.clearTimeout(fallback);
        window.removeEventListener("pointerup", released, true);
        window.removeEventListener("pointercancel", released, true);
        window.removeEventListener("click", restore, true);
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (!active || active === document.body) triggerRef.current?.focus({ preventScroll: true });
        });
      };
      const released = () => { window.clearTimeout(fallback); fallback = window.setTimeout(restore, 400); };
      window.addEventListener("pointerup", released, true);
      window.addEventListener("pointercancel", released, true);
      window.addEventListener("click", restore, true);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (!panelRef.current?.contains(active) && active !== triggerRef.current) return;
      event.stopPropagation();
      onClose(true);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [onClose, triggerRef]);

  const section = (title: string, group: MapFacilityEntry["group"]) => {
    const items = entries.filter((entry) => entry.group === group);
    return items.length > 0 && <div role="group" aria-labelledby={`${id}-${group}`}>
      <h3 id={`${id}-${group}`}>{title}</h3>
      <ul>{items.map((entry) => <li key={entry.key}><button type="button" aria-label={entry.ariaLabel} onClick={() => onLocate(entry)}><FacilitySymbol kind={entry.kind} /><span>{entry.label}</span></button></li>)}</ul>
    </div>;
  };

  return <div id={id} ref={panelRef} className={styles.facilityPanel} data-map-overlay role="group" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>場內設施</h2>
    {section("出入口", "access")}
    {section("場內區域", "area")}
    {legend.length > 0 && <div role="group" aria-labelledby={`${id}-legend`}>
      <h3 id={`${id}-legend`}>圖例</h3>
      <ul className={styles.facilityLegend}>{legend.map((item) => <li key={`${item.kind}:${item.label}`}><FacilitySymbol kind={item.kind} /><span>{item.label}</span></li>)}</ul>
    </div>}
  </div>;
}
