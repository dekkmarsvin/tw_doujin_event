import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { exportMapContributionCandidate, listAdminMapDrafts, mapDraftConflict, mapDraftProblems, postMapDraftComment, readMapDraft, reviewMapContributionDraft, type MapDraftCommentTarget, type MapDraftSummary } from "../circle-editor-client";
import type { EventDefinition } from "../event-catalog";
import type { PublishedEventMap } from "../event-map";
import type { MapCandidateDiff, MapDraftProblem } from "../map-contribution-draft";
import { IDLE, STATUS_LABEL, TARGET_LABEL, CommentThread, DraftList, draftScopeLabel, EvidenceList, Preview, Problems, StatusNotice, message, type Detail, type Status } from "../map-contribution-panels";
import styles from "../circle-portal/portal.module.css";
import { AdminEventSelect } from "./admin-panels";

/**
 * The picker stays mounted across event changes, so a keyboard change of the
 * event keeps focus on it; only the review body below is keyed to the event,
 * which drops every draft-scoped field with the event it was typed against.
 */
export function AdminMapReviewPanel({ event, picker, initialDraftId, onSelectDraft, onEventChange }: {
  event: EventDefinition; picker?: ReactNode; initialDraftId?: string;
  onSelectDraft?: (draftId: string) => void; onEventChange?: (eventId: string) => void;
}) {
  const navigationGuardRef = useRef<() => boolean>(() => true);
  return <section className={`${styles.card} ${styles.admin}`} id="map-review" aria-labelledby="map-review-heading">
    <h2 id="map-review-heading">地圖草稿審閱</h2>
    <p>核准與匯出地圖都不會直接發布。</p>
    {onEventChange ? <AdminEventSelect id="map-review-event" value={event.id} onChange={id => {
      if (navigationGuardRef.current()) onEventChange(id);
    }} /> : picker}
    <MapReviewBody key={event.id} event={event} initialDraftId={initialDraftId} onSelectDraft={onSelectDraft} navigationGuardRef={navigationGuardRef} />
  </section>;
}

function MapReviewBody({ event, initialDraftId, onSelectDraft, navigationGuardRef }: {
  event: EventDefinition; initialDraftId?: string; onSelectDraft?: (draftId: string) => void;
  navigationGuardRef: RefObject<() => boolean>;
}) {
  const active = useRef(true);
  const detailRequest = useRef(0);
  const selection = useRef<string | null>(null);
  const busy = useRef(false);
  const [drafts, setDrafts] = useState<MapDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [replacementDraftId, setReplacementDraftId] = useState("");
  const [officialSourceConfirmed, setOfficialSourceConfirmed] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [problems, setProblems] = useState<MapDraftProblem[]>([]);
  const [candidate, setCandidate] = useState<{ map: PublishedEventMap; diff: MapCandidateDiff; targetPath: string; sha256: string } | null>(null);
  const [targets, setTargets] = useState<MapDraftCommentTarget[]>([]);
  const [targetKind, setTargetKind] = useState<"slot" | "landmark" | "draft">("draft");
  const [targetRef, setTargetRef] = useState("");
  const [targetBody, setTargetBody] = useState("");
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const refreshList = useCallback(async () => {
    const result = await listAdminMapDrafts(event.id);
    if (active.current) setDrafts(result.drafts);
  }, [event.id]);
  /** Refreshes the thread without touching what the reviewer has queued or
   * typed, which is what a standalone reply needs. */
  const reloadDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    const result = await readMapDraft(id, true, event.id);
    if (active.current && request === detailRequest.current && selection.current === id) setDetail(result);
  }, [event.id]);
  // Everything draft-scoped is reset together. Leaving the composer filled
  // would let review text typed against one draft be sent to another.
  const openDraft = useCallback(async (id: string) => {
    if (!active.current) return false;
    const request = ++detailRequest.current;
    selection.current = id;
    setSelectedId(id); setDetail(null); setProblems([]); setCandidate(null); setNote(""); setReplacementDraftId("");
    setOfficialSourceConfirmed(false); setTargets([]); setTargetKind("draft"); setTargetRef(""); setTargetBody("");
    const result = await readMapDraft(id, true, event.id);
    if (!active.current || request !== detailRequest.current) return false;
    setDetail(result);
    return true;
  }, [event.id]);
  const dirty = !!(note || replacementDraftId || targetRef || targetBody || targets.length || officialSourceConfirmed);
  useEffect(() => {
    navigationGuardRef.current = () => !busy.current && (!dirty || window.confirm("放棄尚未送出的審閱內容？"));
    return () => { navigationGuardRef.current = () => true; };
  }, [dirty, navigationGuardRef]);
  useEffect(() => {
    if (!dirty && status.kind !== "busy") return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, status.kind]);
  useEffect(() => {
    queueMicrotask(() => {
      if (!active.current) return;
      void refreshList().catch((error: unknown) => {
        if (active.current) setStatus({ kind: "error", message: message(error) });
      });
    });
  }, [refreshList]);
  const run = useCallback(async (task: () => Promise<unknown>, ok: string) => {
    if (busy.current || !active.current) return;
    busy.current = true;
    setStatus({ kind: "busy", message: "處理中…" }); setProblems([]);
    try { await task(); if (active.current) setStatus({ kind: "ok", message: ok }); }
    catch (error) {
      if (!active.current) return;
      setProblems(mapDraftProblems(error));
      setStatus({ kind: "error", message: message(error), conflict: mapDraftConflict(error) ?? undefined });
    }
    finally { busy.current = false; }
  }, []);
  useEffect(() => {
    if (!initialDraftId || initialDraftId === selection.current) return;
    queueMicrotask(() => {
      if (active.current) void run(() => openDraft(initialDraftId), "審閱資料已載入。");
    });
  }, [initialDraftId, openDraft, run]);
  const decide = (decision: "changes_requested" | "approve" | "reject") => detail && run(async () => {
    await reviewMapContributionDraft({
      draftId: detail.draft.id, expectedRevision: detail.draft.current_revision, decision,
      note: note || undefined, replacementDraftId: replacementDraftId || undefined,
      confirmOfficialSource: decision === "approve" ? officialSourceConfirmed : undefined,
      // Only a request to change carries per-element requests; an approval or a
      // rejection ends the draft, so there is nothing left to point at.
      targets: decision === "changes_requested" && targets.length ? targets : undefined,
    }, event.id);
    if (active.current) { await openDraft(detail.draft.id); await refreshList(); }
  }, decision === "approve" ? "草稿已核准。" : decision === "reject" ? "草稿已拒絕。" : "已要求修改。" );

  const downloadCandidate = () => {
    if (!candidate) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(candidate.map, null, 2) + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = candidate.targetPath.split("/").at(-1) ?? "map.json"; anchor.click();
    URL.revokeObjectURL(url);
  };

  return <>
    <DraftList event={event} drafts={drafts} selected={selectedId} disabled={status.kind === "busy"} onSelect={id => {
      if (!navigationGuardRef.current()) return;
      onSelectDraft?.(id);
      void run(() => openDraft(id), "審閱資料已載入。");
    }} />
    {detail && <>
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{draftScopeLabel(event, detail.draft.period_key, detail.draft.venue_space_id)}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・版本 {detail.draft.current_revision}</dd></div></dl>
      <Preview event={event} layout={detail.draft.content.layout} />
      <label>審閱說明<textarea rows={3} disabled={status.kind === "busy"} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <h3>審閱留言</h3>
      <CommentThread comments={detail.comments} layout={detail.draft.content.layout} onFocus={null} />
      <div className={styles.commentTarget}>
        <label>對象<select disabled={status.kind === "busy"} value={targetKind} onChange={(event) => setTargetKind(event.target.value as "slot" | "landmark" | "draft")}><option value="draft">整份草稿</option><option value="slot">攤位</option><option value="landmark">區域</option></select></label>
        <label>{targetKind === "landmark" ? "區域代號" : "攤位代碼"}<input disabled={status.kind === "busy" || targetKind === "draft"} value={targetRef} onChange={(event) => setTargetRef(event.target.value)} /></label>
      </div>
      <label>留言<textarea rows={2} disabled={status.kind === "busy"} value={targetBody} onChange={(event) => setTargetBody(event.target.value)} /></label>
      <div className={styles.reviewActions}>
        {/* Sent now, so a thread stays answerable after the draft has left
            `submitted` and the decision buttons below are gone. */}
        <button type="button" disabled={status.kind === "busy" || !targetBody.trim() || (targetKind !== "draft" && !targetRef.trim())} onClick={() => void run(async () => {
          await postMapDraftComment({
            draftId: detail.draft.id, body: targetBody.trim(),
            ...(targetKind === "draft" ? {} : { targetKind, targetRef: targetRef.trim() }),
          }, event.id);
          if (!active.current) return;
          setTargetRef(""); setTargetBody(""); await reloadDetail(detail.draft.id);
        }, "留言已送出。")}>送出留言</button>
        {/* Queued instead, so the request rides the decision and is written
            only once that transition takes effect. */}
        <button type="button" disabled={status.kind === "busy" || targetKind === "draft" || !targetRef.trim() || !targetBody.trim()} onClick={() => {
          if (targetKind === "draft") return;
          setTargets([...targets, { targetKind, targetRef: targetRef.trim(), body: targetBody.trim() }]);
          setTargetRef(""); setTargetBody("");
        }}>隨「要求修改」送出</button>
      </div>
      {!!targets.length && <ul className={styles.auditList}>{targets.map((item, index) => <li key={`${item.targetKind}:${item.targetRef}:${index}`}>
        {TARGET_LABEL[item.targetKind]} {item.targetRef}・{item.body}
        <button type="button" disabled={status.kind === "busy"} onClick={() => setTargets(targets.filter((entry, position) => position !== index))}>移除</button>
      </li>)}</ul>}
      <label>取代的已核准草稿代號（同範圍已有核准稿時填寫）<input disabled={status.kind === "busy"} value={replacementDraftId} onChange={(event) => setReplacementDraftId(event.target.value)} /></label>
      <label className={styles.confirmCheck}><input type="checkbox" disabled={status.kind === "busy"} checked={officialSourceConfirmed} onChange={(event) => setOfficialSourceConfirmed(event.target.checked)} /><span>我已逐一確認目前版本的來源檔來自活動官方說明頁面。</span></label>
      {detail.draft.status === "submitted" && <div className={styles.reviewActions}><button type="button" disabled={status.kind === "busy"} onClick={() => void decide("changes_requested")}>要求修改</button><button type="button" disabled={status.kind === "busy"} onClick={() => void decide("reject")}>拒絕</button><button type="button" disabled={status.kind === "busy"} onClick={() => void decide("approve")}>核准</button></div>}
      {(detail.draft.status === "approved" || detail.draft.status === "exported") && <button type="button" disabled={status.kind === "busy"} onClick={() => void run(async () => {
        const result = await exportMapContributionCandidate(detail.draft.id, detail.draft.current_revision, event.id);
        if (!active.current) return;
        if (await openDraft(detail.draft.id)) {
          await refreshList();
          if (active.current) setCandidate({ map: result.candidate, diff: result.diff, targetPath: result.targetPath, sha256: result.candidateSha256 });
        }
      }, "地圖已匯出；尚未發布。")}>匯出地圖候選</button>}
      {candidate && <div className={styles.candidate}>
        <h3>地圖變更</h3>
        <p>{candidate.diff.previousRevision == null ? "新增地圖" : `第 ${candidate.diff.previousRevision} 版 → 第 ${candidate.diff.candidateRevision} 版`}</p>
        <ul>
          {candidate.diff.dimensionsChanged && <li>畫布尺寸已變更</li>}
          {candidate.diff.floorChanged && <li>場地範圍已變更</li>}
          {([
            ["新增攤位", candidate.diff.addedBoothCodes], ["移除攤位", candidate.diff.removedBoothCodes],
            ["移動攤位", candidate.diff.movedBoothCodes], ["變更排段", candidate.diff.changedRowLabels],
            ["變更柱位", candidate.diff.changedPillarIds], ["變更出入口", candidate.diff.changedAccessPointIds],
            ["變更區域", candidate.diff.changedLandmarkIds], ["變更服務設施", candidate.diff.changedServicePointIds ?? []], ["變更展區範圍", candidate.diff.changedAreaRegionIds ?? []],
    ["變更保留／取消格", candidate.diff.changedSpaceMarkIds ?? []],
    ["變更文字註記", candidate.diff.changedNoteIds ?? []],
    ["變更動線箭頭", candidate.diff.changedPathIds ?? []],
          ] as const).map(([label, values]) => values.length ? <li key={label}>{label}：{values.join("、")}</li> : null)}
        </ul>
        <button type="button" onClick={downloadCandidate}>下載地圖檔案</button>
      </div>}
      <h3>來源與審閱紀錄</h3>
      <EvidenceList files={detail.files} showReviewResult eventId={event.id} />
      <ul className={styles.auditList}>{detail.reviews.map((item, index) => <li key={`${item.at}:${index}`}>{STATUS_LABEL[item.from_status]} → {STATUS_LABEL[item.to_status]}・版本 {item.revision}{item.note ? `・${item.note}` : ""}</li>)}</ul>
    </>}
    <Problems problems={problems} />
    <StatusNotice status={status} onReload={detail ? () => void run(() => openDraft(detail.draft.id), "審閱資料已載入。") : null} />
  </>;
}
