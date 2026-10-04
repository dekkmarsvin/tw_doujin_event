import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { saveAdminSiteSettings } from "../circle-editor-client";
import { CLAIM_REVIEW_NOTICE_MAX, CONTACT_URL_MAX, type AdminSiteSettings, type SiteSettingsInput } from "../site-settings";
import { useAdminSiteStatus } from "./use-admin-site-status";
import { adminDate as date, publicationProgress, ServiceStatus } from "./admin-service-status";
import styles from "../circle-portal/portal.module.css";
import settingsStyles from "./admin-site-settings-panel.module.css";

function formOf(data: AdminSiteSettings): SiteSettingsInput {
  const s = data.settings;
  return { organizerApplicationMode: s.organizerApplicationMode, organizerAllowedEmails: s.organizerAllowedEmails,
    accountNotificationsEnabled: s.accountNotificationsEnabled, adminReviewNotificationsEnabled: s.adminReviewNotificationsEnabled, publicationEnabled: s.publicationEnabled,
    contactUrl: s.contactUrl, claimReviewNotice: s.claimReviewNotice };
}
export function AdminSiteSettingsPanel() {
  const [form, setForm] = useState<SiteSettingsInput | null>(null);
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const onLoaded = useCallback((answer: AdminSiteSettings) => {
    setForm(formOf(answer)); setEmails(answer.settings.organizerAllowedEmails.join("\n")); setMessage("");
  }, []);
  const { data, error, setError, checking, load, applySaved, checkServices } = useAdminSiteStatus(onLoaded);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const answer = await saveAdminSiteSettings({ ...form, organizerAllowedEmails: emails.split(/[,;\s]+/).filter(Boolean) }, data.settings.updatedAt);
      if (mounted.current) { applySaved(answer); setMessage("已生效"); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "儲存失敗，請稍後再試。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!data || !form) return <section className={styles.card}>{error ? <><p className={styles.error} role="alert">{error}</p><button type="button" onClick={() => void load()}>重新載入</button></> : <p>載入中…</p>}</section>;
  const patch = (change: Partial<SiteSettingsInput>) => setForm(current => current ? { ...current, ...change } : current);
  return <form className={settingsStyles.workspace} onSubmit={event => void submit(event)}>
    <p className={settingsStyles.intro}>管理活動申請、聯絡方式、通知與發布作業</p>
    <fieldset disabled={busy} className={settingsStyles.fields}>
      <section className={`${styles.card} ${settingsStyles.card}`}><h3>活動申請</h3><p>決定誰可以送出活動建置申請。</p>
        <fieldset className={settingsStyles.modes}><legend>申請開放對象</legend>
          {([
            ["closed", "暫停申請", "所有帳號都無法送出新申請。"],
            ["invite_only", "僅限邀請", "僅開放下方名單中的帳號申請。"],
            ["public", "公開申請", "所有已登入的帳號都可以申請。"],
          ] as const).map(([value, label, hint]) => <label key={value} aria-label={label} htmlFor={`site-application-${value}`}><input id={`site-application-${value}`} type="radio" name="application-mode" value={value}
            checked={form.organizerApplicationMode === value} onChange={() => patch({ organizerApplicationMode: value })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}
        </fieldset>
        <label className={settingsStyles.emails} htmlFor="site-invite-emails">邀請名單<textarea id="site-invite-emails" rows={3} value={emails} onChange={event => setEmails(event.target.value)} placeholder="每行一個 email" /></label>
      </section>
      <section className={`${styles.card} ${settingsStyles.card}`}><h3>聯絡管理者</h3><p>社團資料與主辦工作區的頁首會顯示「聯絡管理者」連結。</p>
        <label className={settingsStyles.emails} htmlFor="site-contact-url">聯絡連結<input id="site-contact-url" type="url" maxLength={CONTACT_URL_MAX} value={form.contactUrl}
          onChange={event => patch({ contactUrl: event.target.value })} placeholder="留空則不顯示" /></label>
        <label className={settingsStyles.emails} htmlFor="site-claim-review-notice">認領審核中說明<textarea id="site-claim-review-notice" rows={2} maxLength={CLAIM_REVIEW_NOTICE_MAX} value={form.claimReviewNotice}
          onChange={event => patch({ claimReviewNotice: event.target.value })} placeholder="留空則不顯示" /></label>
      </section>
      <section className={`${styles.card} ${settingsStyles.card}`}><h3>通知</h3>
        <label className={settingsStyles.switch} htmlFor="site-account-mail" aria-label="全站寄送帳號通知"><span><strong>全站寄送帳號通知</strong><small>寄給社團認領人，通知認領結果與補充資料更新或撤下；活動申請人收到申請結果，主辦負責人收到審核、權限與發布結果，協作者收到自己的權限異動。</small></span>
          <input id="site-account-mail" type="checkbox" role="switch" checked={form.accountNotificationsEnabled} onChange={event => patch({ accountNotificationsEnabled: event.target.checked })} /></label>
        <label className={settingsStyles.switch} htmlFor="site-review-mail" aria-label="全站寄送待審通知"><span><strong>全站寄送待審通知</strong><small>寄給已開啟待審通知的網站管理者，彙整活動申請、活動內容送審、社團認領與地圖貢獻的待審項目。</small></span>
          <input id="site-review-mail" type="checkbox" role="switch" checked={form.adminReviewNotificationsEnabled} onChange={event => patch({ adminReviewNotificationsEnabled: event.target.checked })} /></label>
        <ServiceStatus label="寄信服務" result={data.services?.mail ?? null} pending={checking} requested={!!data.services} />
      </section>
      <section className={`${styles.card} ${settingsStyles.card}`}><h3>發布作業</h3>
        <label className={settingsStyles.switch} htmlFor="site-publication" aria-label="處理發布作業"><span><strong>處理發布作業</strong><small>暫停後續發布處理，已公開活動不受影響。</small></span>
          <input id="site-publication" type="checkbox" role="switch" disabled={data.publicationMode === "disabled"} checked={form.publicationEnabled} onChange={event => patch({ publicationEnabled: event.target.checked })} /></label>
        {data.publicationMode === "disabled" && <p>此環境未啟用發布能力。</p>}
        <ServiceStatus label="發布服務" result={data.services?.publication ?? null} pending={checking} requested={!!data.services} />
        {data.publicationActivities.length ? <div className={settingsStyles.activities}><h4>目前發布作業</h4><ul>{data.publicationActivities.map(job => <li key={job.id}>
          <a href={`/organizer?candidate=${encodeURIComponent(job.candidateId)}&section=review`}>{job.eventName}</a>
          <span>第 {job.edition} 版 · {publicationProgress(job, data.settings.publicationEnabled)}</span>
        </li>)}</ul></div> : <p className={settingsStyles.empty}>目前沒有待處理的發布作業。</p>}
      </section>
    </fieldset>
    <div className={settingsStyles.actions}>
      <button type="submit" disabled={busy}>{busy ? "儲存中…" : "儲存設定"}</button>
      <button type="button" disabled={busy} onClick={() => void load()}>重新載入</button>
      <button type="button" disabled={checking} onClick={() => void checkServices()}>{checking ? "檢查中…" : "檢查服務"}</button>
      <span role="status" className={settingsStyles.available}>{message}</span>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={settingsStyles.updated}>最後更新 {date(data.settings.updatedAt)} · {data.settings.updatedBy === "migration" ? "初始設定" : data.settings.updatedBy}</p>
    {data.services && <p className={settingsStyles.updated}>{data.services.checkedAt === null ? `已要求檢查 ${date(data.services.requestedAt)}` : `服務檢查 ${date(data.services.checkedAt)}`}</p>}
  </form>;
}
