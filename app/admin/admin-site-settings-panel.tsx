import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { readAdminSiteSettings, requestAdminServiceCheck, saveAdminSiteSettings } from "../circle-editor-client";
import { CLAIM_REVIEW_NOTICE_MAX, CONTACT_URL_MAX, type AdminSiteSettings, type ServiceCheck, type SiteSettingsInput } from "../site-settings";
import styles from "../circle-portal/portal.module.css";
import settingsStyles from "./admin-site-settings-panel.module.css";

const steps: Record<string, string> = {
  assemble: "準備活動內容", preparing_data: "準備活動資料", waiting_data_checks: "檢查活動資料", merging_data: "套用活動資料",
  preparing_main: "準備網站更新", waiting_main_checks: "檢查網站更新", merging_main: "套用網站更新",
  waiting_deployment: "部署網站", verifying_production: "確認公開結果",
};
const date = (time: number) => new Date(time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
function formOf(data: AdminSiteSettings): SiteSettingsInput {
  const s = data.settings;
  return { organizerApplicationMode: s.organizerApplicationMode, organizerAllowedEmails: s.organizerAllowedEmails,
    accountNotificationsEnabled: s.accountNotificationsEnabled, adminReviewNotificationsEnabled: s.adminReviewNotificationsEnabled, publicationEnabled: s.publicationEnabled,
    contactUrl: s.contactUrl, claimReviewNotice: s.claimReviewNotice };
}
function ServiceStatus({ label, result, pending }: { label: string; result: ServiceCheck | null; pending: boolean }) {
  return <div className={settingsStyles.service}>
    <strong>{label}</strong>
    <div><span className={result?.status === "unavailable" ? settingsStyles.unavailable : result?.status === "available" ? settingsStyles.available : ""}>
      {pending ? "檢查中" : result?.status === "available" ? "可用" : result?.status === "unavailable" ? "不可用" : result ? "無法確認" : "尚未檢查"}
    </span>{result && <p>{result.source}：{result.reason}</p>}</div>
  </div>;
}

export function AdminSiteSettingsPanel() {
  const [data, setData] = useState<AdminSiteSettings | null>(null);
  const [form, setForm] = useState<SiteSettingsInput | null>(null);
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  const serviceRequestedAt = data?.services?.requestedAt;
  const serviceCheckedAt = data?.services?.checkedAt;
  const load = useCallback(async () => {
    try {
      const answer = await readAdminSiteSettings();
      if (!mounted.current) return;
      setData(answer); setForm(formOf(answer)); setEmails(answer.settings.organizerAllowedEmails.join("\n")); setMessage(""); setError("");
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "載入設定失敗，請稍後再試。"); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void readAdminSiteSettings().then(answer => {
      if (!mounted.current) return;
      setData(answer); setForm(formOf(answer)); setEmails(answer.settings.organizerAllowedEmails.join("\n"));
    }).catch(error => { if (mounted.current) setError(error instanceof Error ? error.message : "載入設定失敗，請稍後再試。"); });
    return () => { mounted.current = false; };
  }, []);
  // Only this on-demand diagnostic request is polled, with a fixed deadline. Settings never poll globally.
  useEffect(() => {
    if (!checking || serviceRequestedAt === undefined || serviceCheckedAt !== null) return;
    const requestedAt = serviceRequestedAt;
    const deadline = Date.now() + 90_000;
    let active = true;
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(timer); setChecking(false); setError("尚未收到排程服務的檢查結果，請稍後重新檢查。"); return;
      }
      void readAdminSiteSettings().then(answer => {
        if (!active) return;
        setData(current => current ? { ...current, services: answer.services, publicationActivities: answer.publicationActivities } : current);
        if (answer.services?.requestedAt !== requestedAt || answer.services.checkedAt !== null) setChecking(false);
      }).catch(error => { if (active) { setChecking(false); setError(error instanceof Error ? error.message : "無法取得檢查結果。"); } });
    }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [checking, serviceRequestedAt, serviceCheckedAt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const answer = await saveAdminSiteSettings({ ...form, organizerAllowedEmails: emails.split(/[,;\s]+/).filter(Boolean) }, data.settings.updatedAt);
      if (mounted.current) { setData(answer); setForm(formOf(answer)); setEmails(answer.settings.organizerAllowedEmails.join("\n")); setMessage("已生效"); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "儲存失敗，請稍後再試。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function checkServices() {
    setChecking(true); setError("");
    try {
      const answer = await requestAdminServiceCheck();
      if (mounted.current) setData(current => current ? { ...current, services: answer.services } : current);
    } catch (error) { if (mounted.current) { setChecking(false); setError(error instanceof Error ? error.message : "無法開始檢查。"); } }
  }
  if (!data || !form) return <section className={styles.card}><h2>網站設定</h2>{error ? <><p className={styles.error} role="alert">{error}</p><button type="button" onClick={() => void load()}>重新載入</button></> : <p>載入中…</p>}</section>;
  const patch = (change: Partial<SiteSettingsInput>) => setForm(current => current ? { ...current, ...change } : current);
  return <form className={settingsStyles.workspace} onSubmit={event => void submit(event)}>
    <div className={settingsStyles.title}><h2>網站設定</h2><span>管理活動申請、聯絡方式、通知與發布作業</span></div>
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
        <ServiceStatus label="寄信服務" result={data.services?.mail ?? null} pending={checking} />
      </section>
      <section className={`${styles.card} ${settingsStyles.card}`}><h3>發布作業</h3>
        <label className={settingsStyles.switch} htmlFor="site-publication" aria-label="處理發布作業"><span><strong>處理發布作業</strong><small>暫停後續發布處理，已公開活動不受影響。</small></span>
          <input id="site-publication" type="checkbox" role="switch" disabled={data.publicationMode === "disabled"} checked={form.publicationEnabled} onChange={event => patch({ publicationEnabled: event.target.checked })} /></label>
        <ServiceStatus label="發布功能" result={data.publicationMode === "disabled" ? { status: "unavailable", source: "發布設定", reason: "此環境尚未啟用 GitHub 發布能力。" } : data.services?.publication ?? null} pending={checking && data.publicationMode !== "disabled"} />
        {data.publicationActivities.length ? <div className={settingsStyles.activities}><h4>目前發布作業</h4><ul>{data.publicationActivities.map(job => <li key={job.id}>
          <a href={`/organizer?candidate=${encodeURIComponent(job.candidateId)}&section=review`}>{job.eventName}</a>
          <span>{job.status === "queued" ? "已排程" : "發布中"} · {!data.settings.publicationEnabled ? "已暫停" : job.status === "queued" ? "等待開始" : steps[job.step] ?? "處理中"}</span>
        </li>)}</ul></div> : <p className={settingsStyles.empty}>目前沒有排程或進行中的發布作業。</p>}
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
    {data.services?.checkedAt !== null && data.services?.checkedAt !== undefined && <p className={settingsStyles.updated}>服務檢查 {date(data.services.checkedAt)}</p>}
  </form>;
}
