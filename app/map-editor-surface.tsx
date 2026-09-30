import { useLayoutEffect, useRef, useState, type Ref, type ReactNode } from "react";
import { UiIcon } from "./ui-icons";
import styles from "./map-layout-editor.module.css";

export type MapEditorSave = { label: string; disabled: boolean; busy?: boolean; message: string; error?: boolean; onSave: () => void };

/** A non-modal inline dialog becomes modal in place. The editor is never
 * reparented/remounted; native top-layer focus containment also keeps the
 * Organizer's scope controls out of reach until the user returns. */
export function MapEditorSurface({ children, title, save, saveButtonRef }: { children: ReactNode; title?: string; save?: MapEditorSave; saveButtonRef?: Ref<HTMLButtonElement> }) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const viewCenter = useRef<{ x: number; y: number } | null>(null);
  const changeExpanded = (next: boolean) => {
    const viewport = dialog.current?.querySelector<HTMLElement>("#map-layout-editor-canvas");
    const svg = viewport?.querySelector("svg");
    if (viewport && svg) {
      const frame = svg.getBoundingClientRect(), area = viewport.getBoundingClientRect(), css = getComputedStyle(viewport);
      const left = parseFloat(css.paddingLeft), right = parseFloat(css.paddingRight), top = parseFloat(css.paddingTop), bottom = parseFloat(css.paddingBottom);
      viewCenter.current = frame.width && frame.height ? { x: (area.left + left + (viewport.clientWidth - left - right) / 2 - frame.left) / frame.width, y: (area.top + top + (viewport.clientHeight - top - bottom) / 2 - frame.top) / frame.height } : null;
    }
    setExpanded(next);
  };
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || wasExpanded.current === expanded) return;
    const viewport = node.querySelector<HTMLElement>("#map-layout-editor-canvas");
    node.close();
    if (expanded) node.showModal(); else node.show();
    wasExpanded.current = expanded;
    toggle.current?.focus({ preventScroll: true });
    // ResizeObserver fits the same zoom to the new viewport. Restore the map
    // coordinate at its center once that fit has painted, subject to bounds.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      const svg = viewport?.querySelector("svg"), center = viewCenter.current;
      if (!viewport || !svg || !center) return;
      const bounds = svg.getBoundingClientRect(), area = viewport.getBoundingClientRect(), css = getComputedStyle(viewport);
      const left = parseFloat(css.paddingLeft), right = parseFloat(css.paddingRight), top = parseFloat(css.paddingTop), bottom = parseFloat(css.paddingBottom);
      viewport.scrollLeft += bounds.left + center.x * bounds.width - (area.left + left + (viewport.clientWidth - left - right) / 2);
      viewport.scrollTop += bounds.top + center.y * bounds.height - (area.top + top + (viewport.clientHeight - top - bottom) / 2);
    }); });
    const overflow = document.body.style.overflow;
    if (expanded) document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = overflow; };
  }, [expanded]);
  return <dialog ref={dialog} open className={`${styles.editorSurface} ${expanded ? styles.expanded : ""}`} aria-label="地圖編輯工作區" aria-modal={expanded || undefined} onCancel={event => { event.preventDefault(); changeExpanded(false); }}>
    <div className={styles.surfaceHeader}>
      <button ref={toggle} type="button" className={styles.expandToggle} aria-expanded={expanded} onClick={() => changeExpanded(!expanded)}><UiIcon name={expanded ? "chevron-left" : "external"} />{expanded ? "返回地圖步驟" : "展開全視窗"}</button>
      {!expanded && <span className={styles.expandHint}>畫布較小，建議展開全視窗。</span>}
      <div className={styles.surfaceTitle}><strong>地圖編輯器</strong>{title && <span>{title}</span>}</div>
      {save && <><span role="status" className={save.error ? styles.saveError : styles.saveStatus}>{save.message}</span><button ref={saveButtonRef} type="button" className={styles.savePrimary} disabled={save.disabled || save.busy} onClick={save.onSave}>{save.busy ? "儲存中…" : save.label}</button></>}
    </div>
    {children}
  </dialog>;
}
