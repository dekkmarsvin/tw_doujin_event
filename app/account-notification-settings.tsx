import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PortalSession } from "./circle-editor-client";
import type { AccountNotificationCadence } from "./account-notifications";
import { useLocale } from "./i18n/locale-context";
import { LOCALES } from "./i18n/locale";
import { portalNotice, usePortalText } from "./circle-portal/portal-i18n";
import { useAccountPreferences, type AccountPreferencesController } from "./circle-portal/use-account-preferences";
import styles from "./account-notification-settings.module.css";

export function AccountNotificationSettings({ session, className, preferences }: { session: PortalSession; className?: string; preferences?: AccountPreferencesController }) {
  const t = usePortalText();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get("notifications") === "1");
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("notifications");
    window.history.replaceState(null, "", url);
  };
  return <><button type="button" className={className} onClick={() => setOpen(true)}>{t("通知設定")}</button>
    {open && createPortal(<SettingsDialog session={session} close={close} preferences={preferences} />, document.body)}
  </>;
}

function SettingsDialog({ session, close, preferences }: { session: PortalSession; close: () => void; preferences?: AccountPreferencesController }) {
  const t = usePortalText();
  const { locale, setLocale } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  // Organizer/Admin keep their existing cadence-only dialog. Circle shares
  // its version owner with the header, including a locale save in flight.
  const own = useAccountPreferences(preferences ? undefined : session.email);
  const settings = preferences ?? own;
  const { saved, busy, loading, error, savedNow } = settings;
  const reloadShared = preferences?.reload;
  useEffect(() => { reloadShared?.(); }, [reloadShared]);
  const requestClose = () => { if (!busy) close(); };
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); opener?.focus(); };
  }, []);
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="account-notification-title"
    onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.header}><h2 id="account-notification-title">{t("通知設定")}</h2><button type="button" disabled={busy} onClick={requestClose}>{t("關閉")}</button></header>
    <p className={styles.muted}>{t("套用所有活動，只影響你的通知。")}</p>
    <p className={styles.email}>{t("收件信箱：{email}", { email: session.email })}</p>
    <section className={styles.required}><h3>{t("審核與權限通知")}</h3><p>{t("認領、活動審核、權限異動與發布結果為必要通知，無法關閉。")}</p></section>
    {loading && <p role="status">{t("載入中…")}</p>}
    {saved && <div className={styles.form}>
      {preferences && <><label htmlFor="account-notification-locale">{t("通知語言")}</label>
        <select id="account-notification-locale" value={settings.unsavedLocale ?? saved.locale ?? locale} disabled={loading || settings.conflict}
          onChange={event => { const next = LOCALES.find(option => option === event.target.value); if (next) { setLocale(next); settings.chooseLocale(next); } }}>
          <option value="zh-Hant" lang="zh-Hant">繁體中文</option><option value="en" lang="en">English</option><option value="ja" lang="ja">日本語</option>
        </select></>}
      <label htmlFor="account-notification-cadence">{t("社團內容更新")}</label>
      <p>{t("彙整補充資料、品書與公開設定的變更，包含你自己的操作。")}</p>
      <select id="account-notification-cadence" value={saved.cadence} disabled={busy || loading || Boolean(error)}
        onChange={event => settings.chooseCadence(event.target.value as AccountNotificationCadence)}>
        <option value="daily">{t("每日 09:00（台北時間）")}</option><option value="hourly">{t("每小時")}</option><option value="off">{t("關閉內容更新摘要")}</option>
      </select>
      <p className={busy ? styles.result : `${styles.result} ${styles.done}`} role="status">{busy ? t("儲存中…") : savedNow && !settings.unsavedLocale ? t("已儲存") : ""}</p>
      <p>{t("沒有更新就不寄信。關閉後重新開啟，只通知之後的新變更。")}</p>
    </div>}
    {error && <div><p className={styles.error} role="alert">{portalNotice(error, locale)}</p><button type="button" disabled={loading || busy} onClick={settings.reload}>{t("重新載入設定")}</button></div>}
    {preferences && settings.unsavedLocale && !busy && !loading && !settings.conflict && <button type="button" onClick={settings.retry}>{t("重試儲存通知語言")}</button>}
    {session.isAdmin && <p className={styles.admin}>{t("管理者的待審摘要另外設定：")}<a href="/admin#review-notifications" target="_blank" rel="noreferrer">{t("管理待審通知（另開分頁）")}</a></p>}
  </dialog>;
}
