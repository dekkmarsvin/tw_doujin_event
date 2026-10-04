import { useMemo, useRef, useState } from "react";
import { AdminReviewQueue, type ClaimReviewScope } from "../admin/admin-review-queue";
import { decideOrganizerClaim, listOrganizerClaims, searchOrganizerTakedownCircles } from "../organizer-client";
import { useModalFocus } from "../use-modal-focus";
import type { ReviewQueue, TakedownCircle } from "../circle-editor-client";
import { OrganizerTakedownPanel } from "./organizer-takedown-panel";
import styles from "../circle-portal/portal.module.css";

/** 社團管理: claims and supplemental takedowns of the published activity. The
 * roster and booths themselves are activity data, so the intro points there. */
export function OrganizerCirclePanel({ candidateId, eventId, canRevoke, onQueueLoaded }: {
  candidateId: string; eventId: string; canRevoke: boolean; onQueueLoaded: (queue: ReviewQueue | null) => void;
}) {
  const claimScope = useMemo<ClaimReviewScope>(() => ({
    eventId,
    load: () => listOrganizerClaims(candidateId),
    decide: (claimId, decision) => decideOrganizerClaim(candidateId, claimId, decision),
  }), [candidateId, eventId]);
  return <div className={styles.claimPanels}>
    <section className={`${styles.card} ${styles.admin} ${styles.eventClaimPanel}`} aria-labelledby="circle-management-heading">
      <h2 id="circle-management-heading">社團管理</h2>
      <p>社團名單和攤位的新增、刪除或調整屬於活動資料，請在「活動資料」匯入；活動已發布後，由負責人建立修正版，送審並發布後生效。</p>
    </section>
    <AdminReviewQueue initialEventId={eventId} claimScope={claimScope} onQueueLoaded={onQueueLoaded} />
    {canRevoke && <OrganizerClaimRevoke candidateId={candidateId} />}
    <OrganizerTakedownPanel candidateId={candidateId} eventId={eventId} />
  </div>;
}

type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Status = { kind: "idle", message: "" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失敗，請稍後再試。";

/** Owners find an approved claim by circle name and withdraw it; the server rechecks the Owner grant. */
function OrganizerClaimRevoke({ candidateId }: { candidateId: string }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TakedownCircle[]>([]);
  const [searchStatus, setSearchStatus] = useState<Status>(IDLE);
  const [selected, setSelected] = useState<TakedownCircle | null>(null);
  const [result, setResult] = useState<Status>(IDLE);
  const sequence = useRef(0);
  const busy = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy.current) setSelected(null); };
  useModalFocus(!!selected, dialog, close);

  const search = async (text: string) => {
    const request = ++sequence.current;
    setMatches([]); setResult(IDLE); setSearchStatus({ kind: "busy", message: "搜尋中…" });
    try {
      const answer = await searchOrganizerTakedownCircles(candidateId, text);
      if (request !== sequence.current) return;
      setMatches(answer.circles);
      setSearchStatus({ kind: "ok", message: answer.circles.length ? `找到 ${answer.circles.length} 個社團` : "找不到符合的社團。" });
    } catch (error) {
      if (request === sequence.current) setSearchStatus({ kind: "error", message: errorMessage(error) });
    }
  };
  const revoke = async () => {
    if (!selected?.verifiedClaimId || busy.current) return;
    busy.current = true; setResult({ kind: "busy", message: "撤銷中…" });
    try {
      await decideOrganizerClaim(candidateId, selected.verifiedClaimId, "revoke");
      setMatches(current => current.map(circle => circle.circleId === selected.circleId ? { ...circle, verifiedClaimId: undefined } : circle));
      setResult({ kind: "ok", message: `已撤銷「${selected.name}」的認領。` });
      busy.current = false; setSelected(null);
    } catch (error) {
      busy.current = false;
      setResult({ kind: "error", message: errorMessage(error) });
    }
  };

  return <section className={`${styles.card} ${styles.admin} ${styles.eventClaimPanel}`} aria-labelledby="claim-revoke-heading">
    <h2 id="claim-revoke-heading">撤銷已通過的認領</h2>
    <p>認領給錯的帳號時使用。撤銷後該帳號不能再編輯這個社團，社團補充資料立即停止公開。</p>
    <form className={styles.takedownSearch} onSubmit={event => { event.preventDefault(); if (query.trim()) void search(query.trim()); }}>
      <label htmlFor="claim-revoke-search">社團名稱<input id="claim-revoke-search" maxLength={100} value={query} placeholder="輸入社團名稱"
        onChange={event => { setQuery(event.target.value); ++sequence.current; setMatches([]); setSearchStatus(IDLE); setResult(IDLE); }} /></label>
      <button type="submit" disabled={!query.trim() || searchStatus.kind === "busy"}>搜尋</button>
    </form>
    {searchStatus.kind !== "idle" && <p role="status" className={searchStatus.kind === "error" ? styles.error : styles.muted}>{searchStatus.message}</p>}
    {result.kind !== "idle" && !selected && <p role="status" className={result.kind === "error" ? styles.error : styles.notice}>{result.message}</p>}
    <ul className={styles.takedownResults}>
      {matches.map(circle => <li key={circle.circleId}>
        <div><strong>{circle.name}</strong><small>{circle.circleId}</small></div>
        <span>{circle.verifiedClaimId ? "已認領" : "未認領"}</span>
        {circle.verifiedClaimId && <button type="button" className={styles.secondaryButton} aria-label={`撤銷${circle.name}的認領`}
          onClick={() => { setResult(IDLE); setSelected(circle); }}>撤銷認領</button>}
      </li>)}
    </ul>
    {selected && <div className={styles.previewBackdrop}>
      <div ref={dialog} className={styles.batchDialog} role="dialog" aria-modal="true" aria-labelledby="claim-revoke-confirm" tabIndex={-1}>
        <h2 id="claim-revoke-confirm">撤銷「{selected.name}」的認領？</h2>
        <p>該帳號不能再編輯這個社團，社團補充資料立即停止公開；內容保留，之後由正確的社團完成認領時會重新公開。</p>
        {result.kind === "error" && <p role="alert" className={styles.error}>{result.message}</p>}
        <div className={styles.reviewActions}>
          <button type="button" disabled={result.kind === "busy"} onClick={close}>取消</button>
          <button type="button" disabled={result.kind === "busy"} onClick={() => { void revoke(); }}>{result.kind === "busy" ? "撤銷中…" : "確認撤銷"}</button>
        </div>
      </div>
    </div>}
  </section>;
}
