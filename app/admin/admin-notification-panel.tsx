import { useEffect, useState } from "react";
import { readNotificationPreferences, saveNotificationPreferences } from "../circle-editor-client";
import type { NotificationCadence, NotificationPreferences } from "../review-notifications";
import styles from "../circle-portal/portal.module.css";

export function AdminNotificationPanel({ email }: { email: string }) {
  const [saved, setSaved] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    void readNotificationPreferences().then(value => {
      if (current) { setSaved(value); setDraft(value); setError(""); }
    }).catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : "無法載入通知設定。"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [email, loadKey]);
  const changed = draft && saved && (draft.enabled !== saved.enabled || draft.cadence !== saved.cadence);
  const edit = (value: Partial<NotificationPreferences>) => {
    if (draft) setDraft({ ...draft, ...value });
    setMessage(""); setError("");
  };
  return <section className={styles.card} id="review-notifications" aria-labelledby="notification-heading">
    <h2 id="notification-heading">待審通知</h2>
    <p>套用所有活動，只影響你的通知。</p>
    <p>收件信箱：{email}</p>
    {loading && <p role="status">載入中…</p>}
    {draft && <form onSubmit={event => {
      event.preventDefault();
      if (!changed || busy || loading) return;
      setBusy(true); setError(""); setMessage("");
      void saveNotificationPreferences(draft).then(value => {
        setSaved(value); setDraft(value); setMessage("通知設定已儲存。");
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "無法儲存通知設定。"))
        .finally(() => setBusy(false));
    }}>
      <label className={styles.confirmCheck}><input type="checkbox" checked={draft.enabled} disabled={busy || loading}
        onChange={event => edit({ enabled: event.target.checked })} />接收待審通知</label>
      <p className={styles.editorHint}>只通知開啟後的新送審，不重複提醒已通知的項目。</p>
      <label htmlFor="notification-cadence">通知頻率</label>
      <select id="notification-cadence" value={draft.cadence} disabled={busy || loading || !draft.enabled}
        onChange={event => edit({ cadence: event.target.value as NotificationCadence })}>
        <option value="five_minutes">每 5 分鐘</option>
        <option value="hourly">每小時</option>
        <option value="daily">每日 09:00（台北時間）</option>
      </select>
      <button type="submit" disabled={busy || loading || !changed}>{busy ? "儲存中…" : "儲存設定"}</button>
    </form>}
    {error && <div><p className={styles.error} role="alert">{error}</p>
      <button type="button" disabled={busy || loading} onClick={() => { setLoading(true); setError(""); setMessage(""); setLoadKey(value => value + 1); }}>重新載入設定</button></div>}
    {message && <p className={styles.notice} role="status">{message}</p>}
  </section>;
}
