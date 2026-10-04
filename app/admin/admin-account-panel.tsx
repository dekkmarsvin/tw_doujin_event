import { useCallback, useEffect, useRef, useState } from "react";
import { disableAccount, manageMapContributor, readAdminAccountDetail, type AdminAccountDetail } from "../circle-editor-client";
import { isEmailShaped, normalizeEmail } from "../portal-crypto";
import { useModalFocus } from "../use-modal-focus";
import { adminHref } from "./admin-navigation";
import styles from "../circle-portal/portal.module.css";
import ui from "./admin-app.module.css";

const accountStatus = { active: "可使用", disabled: "已停用", deleting: "刪除中" };
const mapStatus = { none: "未授權", active: "有效", revoked: "已撤銷", suspended: "已停權" };
const claimStatus = { pending: "待審", verified: "已認領", rejected: "未核准", revoked: "已撤銷", withdrawn: "已撤回" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失敗，請稍後再試。";

export function AdminAccountPanel({ initialEmail, onSearchChange }: { initialEmail: string; onSearchChange: (email: string) => void }) {
  const [query, setQuery] = useState(initialEmail);
  const [target, setTarget] = useState(initialEmail);
  const [queried, setQueried] = useState(false);
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [result, setResult] = useState<{ failed: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(false);
  const requests = useRef({ value: 0 });
  const busy = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy.current) setConfirming(false); };
  useModalFocus(confirming, dialog, close);

  const load = useCallback(async (email: string, preserve = false) => {
    if (!mounted.current) return;
    const request = ++requests.current.value;
    setTarget(email); setLoading(true); setReadError(""); setQueried(true);
    if (!preserve) setDetail(null);
    try {
      const answer = await readAdminAccountDetail(email);
      if (request !== requests.current.value) return;
      setQuery(answer.email); setTarget(answer.email); setDetail(answer.account);
    } catch (error) {
      if (request === requests.current.value) setReadError(preserve ? `帳號明細更新失敗，顯示上次讀取的資料。${errorMessage(error)}` : errorMessage(error));
    } finally { if (request === requests.current.value) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const sequence = requests.current;
    queueMicrotask(() => {
      if (!mounted.current || !initialEmail) return;
      const email = normalizeEmail(initialEmail);
      if (isEmailShaped(email)) void load(email);
      else { setQueried(true); setReadError("請填寫有效的 Email。"); }
    });
    return () => { mounted.current = false; ++sequence.value; };
  }, [initialEmail, load]);

  const mutate = async (action: () => Promise<unknown>, message: string, disable = false) => {
    if (!detail || busy.current || loading || readError) return;
    const email = detail.email;
    busy.current = true; setPending(true); setResult(null);
    try {
      await action();
      if (!mounted.current) return;
      if (disable) setConfirming(false);
      setResult({ failed: false, message });
      await load(email, true);
    } catch (error) {
      if (mounted.current) setResult({ failed: true, message: errorMessage(error) });
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const available = detail?.status === "active" && !loading && !pending && !readError;
  const rosterHref = adminHref("accounts", { view: "admins", email: target });
  const mapAction = (action: "grant" | "revoke" | "suspend") => {
    if (!detail || !available) return;
    const message = action === "grant" ? "已授予地圖貢獻資格。" : action === "revoke" ? "地圖貢獻資格已撤銷。" : "地圖貢獻資格已停權。";
    void mutate(() => manageMapContributor(detail.email, action), message);
  };

  return <section className={`${styles.card} ${styles.admin} ${ui.accountDetail}`} aria-labelledby="account-query-heading">
    <h3 id="account-query-heading">帳號查詢</h3>
    <form className={styles.takedownSearch} noValidate onSubmit={event => {
      event.preventDefault();
      if (busy.current) return;
      const email = normalizeEmail(query);
      if (!isEmailShaped(email)) { setReadError("請填寫有效的 Email。"); return; }
      setQuery(email); setResult(null);
      if (email === initialEmail) void load(email);
      else onSearchChange(email);
    }}>
      <label htmlFor="account-query-email">帳號 Email<input id="account-query-email" type="email" autoComplete="email" maxLength={254} value={query} disabled={pending}
        onChange={event => {
          setQuery(event.target.value); ++requests.current.value;
          setTarget(""); setDetail(null); setQueried(false); setLoading(false); setReadError(""); setResult(null); setConfirming(false);
        }} /></label>
      <button type="submit" disabled={!query.trim() || loading || pending}>{loading ? "查詢中…" : "查詢"}</button>
    </form>
    {result && !confirming && <p role={result.failed ? "alert" : "status"} className={result.failed ? styles.error : styles.notice}>{result.message}</p>}
    {loading && <p role="status">載入帳號明細…</p>}
    {readError && <div role="alert" className={styles.error}><p>{readError}</p>
      {isEmailShaped(target) && <button type="button" disabled={pending || loading} onClick={() => void load(target, !!detail)}>重新讀取</button>}</div>}
    {queried && !loading && !readError && !detail && <p role="status">查無此帳號。</p>}
    {detail && <div aria-label="帳號明細">
      <div className={ui.detailSection}><div className={ui.detailHeading}><h3>{detail.email}</h3>
        <button type="button" disabled={loading || pending} onClick={() => void load(detail.email, true)}>重新整理</button></div>
        <dl className={ui.detailFacts}><div><dt>帳號狀態</dt><dd>{accountStatus[detail.status]}</dd></div></dl>
      </div>
      <section className={ui.detailSection} aria-labelledby="account-admin-heading"><h4 id="account-admin-heading">網站管理者</h4>
        <p>{detail.isAdmin ? "在管理者名單中" : "未列為管理者"}</p><a href={rosterHref}>管理網站管理者</a>
      </section>
      <section className={ui.detailSection} aria-labelledby="account-map-heading"><h4 id="account-map-heading">地圖貢獻者</h4>
        <p>{mapStatus[detail.mapContributor.status]}</p>
        {detail.status !== "active" ? <p className={styles.muted}>帳號{accountStatus[detail.status]}，無法變更地圖貢獻資格。</p>
          : <div className={`${styles.reviewActions} ${ui.accountActions}`}>
            {detail.mapContributor.status === "active" ? <>
              <button type="button" disabled={!available} onClick={() => mapAction("revoke")}>撤銷</button>
              <button type="button" disabled={!available} onClick={() => mapAction("suspend")}>停權</button>
            </> : <><button type="button" disabled={!available} onClick={() => mapAction("grant")}>{detail.mapContributor.status === "none" ? "授予" : "重新授予"}</button>
              {detail.mapContributor.status !== "none" && <p className={styles.muted}>重新授予會恢復地圖貢獻資格。</p>}</>}
          </div>}
      </section>
      <section className={ui.detailSection} aria-labelledby="account-workspaces-heading"><h4 id="account-workspaces-heading">活動工作區</h4>
        {detail.organizerGrants.length ? <ul className={ui.detailList}>{detail.organizerGrants.map(grant => <li key={grant.candidateId}>
          <div><strong>{grant.name}</strong><span>{grant.role === "owner" ? "負責人" : "協作者"}{grant.edition ? `・第 ${grant.edition} 版` : ""}</span></div>
          <a href={grant.membersHref}>管理成員</a>
        </li>)}</ul> : <p className={styles.muted}>無活動工作區權限。</p>}
      </section>
      <section className={ui.detailSection} aria-labelledby="account-claims-heading"><h4 id="account-claims-heading">社團認領</h4>
        {detail.claims.length ? <ul className={ui.detailList}>{detail.claims.map(claim => <li key={`${claim.eventId}:${claim.id}`}>
          <div><strong>{claim.circleName}</strong><span>{claim.eventName}・{claimStatus[claim.status]}</span></div>
          <div className={ui.detailActions}>{claim.detailHref && <a href={claim.detailHref}>查看社團明細</a>}{claim.reviewHref && <a href={claim.reviewHref}>前往認領審核</a>}</div>
        </li>)}</ul> : <p className={styles.muted}>沒有社團認領紀錄。</p>}
      </section>
      <section className={ui.detailSection} aria-labelledby="account-disable-heading"><h4 id="account-disable-heading">停用帳號</h4>
        {detail.isAdmin ? <p>請先移出管理者名單。<a href={rosterHref}>前往網站管理者</a></p>
          : detail.status === "disabled" ? <p>帳號已停用。</p> : detail.status === "deleting" ? <p>帳號正在刪除，無法停用。</p> : <>
            <p>停用會立即撤銷登入狀態，保留帳號資料。</p>
            <button type="button" disabled={!available} onClick={() => { setResult(null); setConfirming(true); }}>停用帳號</button>
          </>}
      </section>
    </div>}
    {confirming && detail && <div className={styles.previewBackdrop}><div ref={dialog} className={styles.batchDialog} role="dialog" aria-modal="true" aria-labelledby="account-disable-confirm" tabIndex={-1}>
      <h2 id="account-disable-confirm">停用「{detail.email}」？</h2>
      <p>停用會立即撤銷登入狀態，保留帳號資料。</p>
      {result?.failed && <p role="alert" className={styles.error}>{result.message}</p>}
      <div className={styles.reviewActions}><button type="button" disabled={pending} onClick={close}>取消</button>
        <button type="button" disabled={!available} onClick={() => void mutate(() => disableAccount(detail.email), "帳號已停用。", true)}>{pending ? "處理中…" : "確認停用"}</button>
      </div>
    </div></div>}
  </section>;
}
