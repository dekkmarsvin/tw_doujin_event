import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import styles from "./organizer.module.css";

export function RosterCell({ label, value, display, options, disabled, errors = [], onChange, onRestore, focusKey }: {
  label: string; value: string; display?: string;
  options?: readonly { value: string; label: string }[];
  disabled: boolean; errors?: readonly string[]; focusKey: string;
  onChange: (value: string) => void; onRestore: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const field = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restore = useRef(onRestore);
  const composing = useRef(false);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const begin = () => { restore.current = onRestore; setText(value); setEditing(true); };
  const finish = (focus = true) => { setEditing(false); if (focus) requestAnimationFrame(() => button.current?.focus()); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); restore.current(); finish(); }
    if (event.key === "Enter") { event.preventDefault(); finish(); }
    if (event.key === "Tab") {
      const cells = Array.from(button.current?.closest("table")?.querySelectorAll<HTMLButtonElement>("button[data-roster-cell]:not(:disabled)") ?? []);
      const next = cells[cells.indexOf(button.current!) + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); finish(false); next.click(); }
      else finish(false);
    }
  };
  const props = { "aria-label": label, "aria-invalid": errors.length ? true as const : undefined,
    "aria-describedby": errors.length ? `error-${focusKey}` : undefined,
    disabled, value: text, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setText(event.target.value); onChange(event.target.value); },
    onKeyDown: keyDown, onBlur: () => finish(false),
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; } };
  return <td className={errors.length ? styles.issueCell : undefined}>
    <button ref={button} type="button" data-roster-cell={focusKey} className={styles.cellButton}
      aria-label={`編輯 ${label}`} disabled={disabled} hidden={editing} onClick={begin}>{display || value || "—"}</button>
    {editing && (options ? <select {...props} ref={element => { field.current = element; }}>
      <option value="">請選擇</option>
      {value && !options.some(item => item.value === value) && <option value={value}>{value}</option>}
      {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select> : <input {...props} ref={element => { field.current = element; }} />)}
    {errors.length > 0 && <small id={`error-${focusKey}`} className={styles.fieldError}>{errors.join(" ")}</small>}
  </td>;
}
