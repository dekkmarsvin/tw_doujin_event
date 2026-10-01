import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readAccountNotificationPreferences, saveAccountNotificationPreferences, type PortalSession } from "./circle-editor-client";
import type { AccountNotificationCadence, AccountNotificationPreferences } from "./account-notifications";
import styles from "./account-notification-settings.module.css";

export function AccountNotificationSettings({ session, className }: { session: PortalSession; className?: string }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get("notifications") === "1");
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("notifications");
    window.history.replaceState(null, "", url);
  };
  return <><button type="button" className={className} onClick={() => setOpen(true)}>通知設定</button>
    {open && createPortal(<SettingsDialog session={session} close={close} />, document.body)}
  </>;
}

function SettingsDialog({ session, close }: { session: PortalSession; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<AccountNotificationPreferences | null>(null);
  // One menu, so a choice is saved as it is made: no save button to forget and
  // no unsaved state to confirm away on close. The menu shows the pending
  // choice until the server answers, then whatever is actually stored.
  const [pending, setPending] = useState<AccountNotificationCadence | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [savedNow, setSavedNow] = useState(false);
  const busy = pending !== null;
  const requestClose = () => { if (!busy) close(); };
  const choose = (cadence: AccountNotificationCadence) => {
    if (!saved || busy || loading || cadence === saved.cadence) return;
    setPending(cadence); setError(""); setSavedNow(false);
    void saveAccountNotificationPreferences({ ...saved, cadence }).then(value => { setSaved(value); setSavedNow(true); })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "無法儲存通知設定。"))
      .finally(() => setPending(null));
  };
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); opener?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    void readAccountNotificationPreferences().then(value => {
      if (active) { setSaved(value); setError(""); }
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "無法載入通知設定。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [generation, session.email]);
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="account-notification-title"
    onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.header}><h2 id="account-notification-title">通知設定</h2><button type="button" disabled={busy} onClick={requestClose}>關閉</button></header>
    <p className={styles.muted}>套用所有活動，只影響你的通知。</p>
    <p className={styles.email}>收件信箱：{session.email}</p>
    <section className={styles.required}><h3>審核與權限通知</h3><p>認領、活動審核、權限異動與發布結果為必要通知，無法關閉。</p></section>
    {loading && <p role="status">載入中…</p>}
    {saved && <div className={styles.form}>
      <label htmlFor="account-notification-cadence">社團內容更新</label>
      <p>彙整補充資料、品書與公開設定的變更，包含你自己的操作。</p>
      <select id="account-notification-cadence" value={pending ?? saved.cadence} disabled={busy || loading}
        onChange={event => choose(event.target.value as AccountNotificationCadence)}>
        <option value="daily">每日 09:00（台北時間）</option><option value="hourly">每小時</option><option value="off">關閉內容更新摘要</option>
      </select>
      <p className={busy ? styles.result : `${styles.result} ${styles.done}`} role="status">{busy ? "儲存中…" : savedNow ? "已儲存" : ""}</p>
      <p>沒有更新就不寄信。關閉後重新開啟，只通知之後的新變更。</p>
    </div>}
    {error && <div><p className={styles.error} role="alert">{error}</p><button type="button" disabled={loading || busy} onClick={() => {
      setLoading(true); setError(""); setSavedNow(false); setGeneration(value => value + 1);
    }}>重新載入設定</button></div>}
    {session.isAdmin && <p className={styles.admin}>管理者的待審摘要另外設定：<a href="/admin#review-notifications" target="_blank" rel="noreferrer">管理待審通知（另開分頁）</a></p>}
  </dialog>;
}
