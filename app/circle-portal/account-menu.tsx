import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { UiIcon } from "../ui-icons";
import styles from "./portal.module.css";
import { usePortalText } from "./portal-i18n";

/**
 * The account's own actions behind one "帳號" button, so the header keeps only
 * who is signed in and the page's event.
 *
 * The panel is hidden rather than unmounted: 通知設定 owns its dialog, and
 * unmounting the panel would close the dialog it just opened. For the same
 * reason a click or Escape inside that dialog is not a dismissal of the menu,
 * and closing the dialog hands focus back to the item that opened it.
 */
export function AccountMenu({ email, attention, onOpen, children }: { email?: string; attention?: "bad" | "warn" | "info" | null; onOpen?: () => void; children: ReactNode }) {
  const t = usePortalText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Focus can drop to the body inside an open dialog (a control disabled
    // while it saves), so an open modal counts as well as the event's target.
    const fromDialog = (target: EventTarget | null) =>
      (target instanceof Element && target.closest("dialog") !== null) || document.querySelector("dialog:modal") !== null;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !fromDialog(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || fromDialog(event.target)) return;
      setOpen(false);
      trigger.current?.focus();
    };
    // A followed link is done with the menu; a button keeps it until it is dismissed.
    const followed = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a") && root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("click", followed);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("click", followed);
    };
  }, [open]);

  return <div ref={root} className={styles.accountMenu}>
    <button ref={trigger} type="button" aria-label={email ? t("帳號") : t("登入")} title={t("帳號")} aria-expanded={open} aria-controls={panelId} data-attention={attention ?? undefined} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>{email ? email.slice(0, 1).toUpperCase() : <UiIcon name="user" />}</button>
    <div id={panelId} className={styles.accountMenuPanel} hidden={!open}>{children}</div>
  </div>;
}
