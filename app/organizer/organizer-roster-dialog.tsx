import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./organizer.module.css";

/** Native modal supplies focus containment, inert background and focus return. */
export function RosterDialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={styles.rosterDialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.panelHead}><h3 id={titleId}>{title}</h3>
      <button type="button" className={styles.ghost} disabled={busy} onClick={onClose}>關閉</button></div>
    {children}
  </dialog>;
}
