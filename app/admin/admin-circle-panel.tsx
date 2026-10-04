import { useCallback, useEffect, useRef, useState } from "react";
import { PortalError, readAdminCircleDetail, searchTakedownCircles, takedownOverride, type AdminCircleDetail, type TakedownCircle } from "../circle-editor-client";
import { CIRCLE_OVERRIDE_LIST_FIELDS, type CircleOverrideFields } from "../circle-overrides";
import { LINK_KIND_LABEL } from "../circle-presentation";
import type { EventDefinition } from "../event-catalog";
import { useModalFocus } from "../use-modal-focus";
import { AdminEventSelect } from "./admin-panels";
import styles from "../circle-portal/portal.module.css";
import ui from "./admin-app.module.css";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "無法取得資料，請稍後再試。";
const dataStatus = { none: "沒有補充資料", live: "有補充資料", takendown: "已撤下" };
const claimStatus = { pending: "待審", verified: "已認領", rejected: "未核准", revoked: "已撤銷", withdrawn: "已撤回" };
const publicReason = { no_content: "沒有補充資料", takendown: "已撤下", no_verified_claim: "目前無有效認領", post_event_hidden: "活動後自行隱藏" };
const cleanupStatus = { not_required: "沒有清除工作", complete: "已清除", pending: "仍待清除", unknown: "無法確認" };
const historyLabel = { "claim.approved": "認領已核准", "claim.rejected": "認領未核准", "claim.revoked": "認領已撤銷", "override.takendown": "補充資料已撤下" };
const time = (at: number) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(at);

export function AdminCirclePanel({ event, initialQuery, circleId, onEventChange, onSearchChange, onSelectCircle }: {
  event: EventDefinition; initialQuery: string; circleId: string; onEventChange: (eventId: string) => void;
  onSearchChange: (query: string) => void; onSelectCircle: (circleId: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<TakedownCircle[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchFailed, setSearchFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const sequence = useRef(0);
  const search = useCallback(async (query: string) => {
    const current = ++sequence.current;
    setMatches([]); setSearchFailed(false); setSearchMessage("");
    if (!query.trim()) { setSearching(false); return; }
    setSearching(true);
    try {
      const result = await searchTakedownCircles(query.trim(), event.id);
      if (current !== sequence.current) return;
      setMatches(result.circles);
      setSearchMessage(result.circles.length ? `找到 ${result.circles.length} 個社團` : "找不到符合的社團。");
    } catch (error) {
      if (current === sequence.current) { setSearchFailed(true); setSearchMessage(errorMessage(error)); }
    } finally { if (current === sequence.current) setSearching(false); }
  }, [event.id]);
  useEffect(() => {
    const requests = sequence;
    let current = true;
    queueMicrotask(() => { if (current) { setQuery(initialQuery); void search(initialQuery); } });
    return () => { current = false; requests.current++; };
  }, [initialQuery, search]);

  if (circleId) return <AdminCircleDetailPanel key={`${event.id}:${circleId}`} event={event} circleId={circleId}
    onBack={() => onSelectCircle("")} onChanged={() => { void search(initialQuery); }} />;
  return <section className={`${styles.card} ${styles.admin}`} id="takedown" aria-labelledby="circle-search-heading">
    <h3 id="circle-search-heading">社團查詢</h3>
    <AdminEventSelect id="circle-search-event" value={event.id} onChange={onEventChange} />
    <form className={styles.takedownSearch} onSubmit={event => {
      event.preventDefault();
      const next = query.trim();
      if (next === initialQuery) void search(next);
      else onSearchChange(next);
    }}>
      <label htmlFor="circle-search-query">社團名稱<input id="circle-search-query" maxLength={100} value={query} placeholder="輸入社團名稱" onChange={event => {
        setQuery(event.target.value); sequence.current++; setMatches([]); setSearchMessage(""); setSearching(false);
      }} /></label>
      <button type="submit" disabled={!query.trim() || searching}>{searching ? "搜尋中…" : "搜尋"}</button>
    </form>
    {searchMessage && <p role={searchFailed ? "alert" : "status"} className={searchFailed ? styles.error : styles.muted}>{searchMessage}</p>}
    <ul className={`${styles.takedownResults} ${ui.circleResults}`}>
      {matches.map(circle => <li key={circle.circleId}>
        <div><strong>{circle.name}</strong><small>{event.name}</small></div>
        <span>{circle.cleanupPending ? "已撤下，圖片待清除" : dataStatus[circle.status]}</span>
        <button type="button" aria-label={`查看${circle.name}明細`} onClick={() => onSelectCircle(circle.circleId)}>查看明細</button>
      </li>)}
    </ul>
  </section>;
}

function AdminCircleDetailPanel({ event, circleId, onBack, onChanged }: {
  event: EventDefinition; circleId: string; onBack: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminCircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ message: string; failed: boolean } | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy.current) setConfirming(false); };
  useModalFocus(confirming, dialog, close);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setReadError(""); setDetail(null);
    try {
      const next = await readAdminCircleDetail(circleId, event.id);
      if (current === sequence.current) setDetail(next);
    } catch (error) {
      if (current === sequence.current) setReadError(errorMessage(error));
    } finally { if (current === sequence.current) setLoading(false); }
  }, [circleId, event.id]);
  useEffect(() => {
    const requests = sequence;
    let current = true;
    queueMicrotask(() => { if (current) void reload(); });
    return () => { current = false; requests.current++; };
  }, [reload]);
  const supplemental = detail?.supplemental;
  const cleanup = supplemental?.status === "takendown";
  const actionAvailable = supplemental?.status === "live" || cleanup && (supplemental.cleanupState === "pending" || supplemental.cleanupState === "unknown");
  const submittedReason = cleanup && supplemental.takedown?.reason ? supplemental.takedown.reason : reason.trim();
  const submit = async () => {
    if (!detail || !submittedReason || busy.current) return;
    busy.current = true; setPending(true); setResult(null);
    try {
      await takedownOverride(circleId, submittedReason, event.id);
      setResult({ message: cleanup ? "圖片已清除。" : "已撤下。", failed: false });
      setReason("");
    } catch (error) {
      setResult({ message: errorMessage(error), failed: true });
      if (error instanceof PortalError && error.status === 401) return;
    } finally {
      setConfirming(false);
      await reload(); onChanged();
      busy.current = false; setPending(false);
    }
  };
  return <section className={`${styles.card} ${styles.admin} ${ui.circleDetail}`} id="takedown" aria-label="社團明細">
    <div className={ui.detailHeading}><div><p className={styles.muted}>{event.name}</p><h3>{detail?.name ?? "社團明細"}</h3></div>
      <button type="button" disabled={pending} onClick={onBack}>返回搜尋結果</button></div>
    {result && <p role="status" className={result.failed ? styles.error : styles.notice}>{result.message}</p>}
    {loading ? <p role="status">載入社團明細…</p> : readError ? <div><p role="alert" className={styles.error}>{readError}</p>
      <button type="button" onClick={() => { void reload(); }}>重新讀取明細</button></div> : detail && <>
      <section className={ui.detailSection} aria-labelledby="circle-basic-heading"><h4 id="circle-basic-heading">基本資料</h4>
        <dl className={ui.detailFacts}><div><dt>活動</dt><dd>{event.name}</dd></div><div><dt>社團</dt><dd>{detail.name}</dd></div>
          <div><dt>攤位</dt><dd>{detail.placements.length ? <ul>{detail.placements.map((placement, index) => <li key={index}>
            第 {placement.day} 日・{placement.area}・{placement.boothCode}{placement.status === "cancelled" ? "（已取消）" : placement.status === "moved" ? "（已移動）" : ""}
          </li>)}</ul> : "沒有攤位資料"}</dd></div></dl>
        <div className={ui.detailActions}>{detail.publicHref ? <a href={detail.publicHref}>查看公開頁</a> : <span className={styles.muted}>沒有可用的公開頁</span>}{detail.organizerHref ? <a href={detail.organizerHref}>前往活動工作區修改官方資料</a> : <span className={styles.muted}>沒有可用的活動工作區</span>}</div>
      </section>
      <section className={ui.detailSection} aria-labelledby="circle-claims-heading"><h4 id="circle-claims-heading">認領</h4>
        <p>{detail.claims.some(claim => claim.status === "verified") ? "已認領" : detail.claims.some(claim => claim.status === "pending") ? "待審" : "未認領"}</p>
        <ul className={ui.detailList}>{detail.claims.map(claim => <li key={claim.id}>
          <div><strong>{claim.accountEmail ?? "帳號已刪除"}</strong><span>{claimStatus[claim.status]}{claim.accountStatus === "disabled" ? "・帳號已停用" : claim.accountStatus === "deleting" ? "・帳號刪除中" : ""}</span>
            <small>申請時間：{time(claim.createdAt)}</small></div>{claim.reviewHref && <a href={claim.reviewHref}>前往認領審核</a>}
        </li>)}</ul>
      </section>
      <section className={ui.detailSection} aria-labelledby="circle-content-heading"><h4 id="circle-content-heading">補充內容</h4>
        <dl className={ui.detailFacts}><div><dt>資料狀態</dt><dd>{dataStatus[detail.supplemental.status]}</dd></div>
          <div><dt>公開狀態</dt><dd>{detail.supplemental.publicState === "public" ? "公開中" : `不公開${detail.supplemental.publicReason ? `・${publicReason[detail.supplemental.publicReason]}` : ""}`}</dd></div>
          <div><dt>圖片處理</dt><dd>{cleanupStatus[detail.supplemental.cleanupState]}</dd></div>
          {detail.supplemental.updatedAt !== null && <div><dt>最後更新</dt><dd>{time(detail.supplemental.updatedAt)}</dd></div>}</dl>
        {detail.supplemental.fields && <SupplementalContent fields={detail.supplemental.fields} />}
        {detail.supplemental.takedown?.reason && <p className={ui.contentText}>撤下原因：{detail.supplemental.takedown.reason}</p>}
        {actionAvailable && <div className={styles.takedownSelection}>
          {(!cleanup || !supplemental?.takedown?.reason) && <label htmlFor="circle-takedown-reason">原因<textarea id="circle-takedown-reason" maxLength={500} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>}
          <button type="button" disabled={!submittedReason || pending} onClick={() => setConfirming(true)}>{pending ? "處理中…" : !cleanup ? "撤下補充資料" : supplemental?.cleanupState === "pending" ? "清除剩餘圖片" : "再次確認撤下"}</button>
        </div>}
      </section>
      <section className={ui.detailSection} aria-labelledby="circle-history-heading"><h4 id="circle-history-heading">處理紀錄</h4>
        {detail.history.length ? <ul className={ui.detailList}>{detail.history.map((item, index) => <li key={index}><div>
          <strong>{item.retryCleanup ? "圖片清除接續" : historyLabel[item.action]}</strong><small>{time(item.at)}{item.by ? `・${item.by}` : ""}</small>
          {item.reason && <span className={ui.contentText}>{item.reason}</span>}
        </div></li>)}</ul> : <p className={styles.muted}>沒有處理紀錄。</p>}
      </section>
    </>}
    {confirming && detail && <div className={styles.previewBackdrop}><div ref={dialog} className={styles.batchDialog} role="dialog" aria-modal="true" aria-labelledby="circle-takedown-confirm" tabIndex={-1}>
      <h2 id="circle-takedown-confirm">{cleanup ? "完成圖片清除？" : `撤下「${detail.name}」的補充資料？`}</h2>
      <p>{event.name}／{detail.name}</p><p>{cleanup ? "清除上次撤下後留下的上傳圖片。官方攤位資料與社團認領保留。" : "介紹與品書將停止公開，已上傳圖片會刪除。官方攤位資料與社團認領保留。"}</p>
      <p className={ui.contentText}>原因：{submittedReason}</p><div className={styles.reviewActions}><button type="button" disabled={pending} onClick={close}>取消</button>
        <button type="button" disabled={pending} onClick={() => { void submit(); }}>{pending ? "處理中…" : "確認撤下"}</button></div>
    </div></div>}
  </section>;
}

function SupplementalContent({ fields }: { fields: CircleOverrideFields }) {
  const textFields = [{ key: "pen", label: "作者" }, { key: "saleInfo", label: "介紹與品書說明" }, { key: "circleCategory", label: "社團分類" }] as const;
  return <>
    <dl className={ui.detailFacts}>
      {textFields.map(({ key, label }) => fields[key] !== undefined && <div key={key}><dt>{label}</dt><dd className={ui.contentText}>{fields[key] || "未填寫"}</dd></div>)}
      {CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => fields[key] && <div key={key}><dt>{label}</dt><dd>{fields[key]!.join("、") || "未填寫"}</dd></div>)}
      {fields.links && <div><dt>連結</dt><dd>{fields.links.length ? <ul>{fields.links.map((link, index) => <li key={index}><a href={link.url} target="_blank" rel="noreferrer">{LINK_KIND_LABEL[link.kind] || link.provider || "連結"}</a></li>)}</ul> : "未填寫"}</dd></div>}
    </dl>
    {(fields.thumbnail || fields.catalogImages?.length) ? <div className={ui.detailMedia}>
      {fields.thumbnail && <a href={fields.thumbnail.url} target="_blank" rel="noreferrer"><img src={fields.thumbnail.url} alt="代表圖" loading="lazy" /></a>}
      {fields.catalogImages?.map((item, index) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer"><img src={item.previewUrl} alt={`品書 ${index + 1}`} loading="lazy" /></a>)}
    </div> : null}
  </>;
}
