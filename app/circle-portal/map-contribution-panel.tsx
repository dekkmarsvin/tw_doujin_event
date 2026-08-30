"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import {
  createMapContributionDraft, exportMapContributionCandidate, listAdminMapDrafts, listMyMapDrafts,
  mapDraftConflict, mapDraftProblems, postMapDraftComment, readMapDraft, reviewMapContributionDraft, saveMapContributionDraft,
  submitMapContributionDraft, uploadMapContributionEvidence, withEventScope,
  type MapDraftComment, type MapDraftCommentTarget, type MapDraftDetail, type MapDraftFile, type MapDraftReview,
  type MapDraftStatus, type MapDraftSummary,
} from "../circle-editor-client";
import type { EventDefinition } from "../event-catalog";
import type { EventMapLayout, PublishedEventMap } from "../event-map";
import MapLayoutEditor, { type MapEditorFocusTarget } from "../map-layout-editor";
import type { MapCandidateDiff, MapDraftActorRole, MapDraftConflict, MapDraftProblem } from "../map-contribution-draft";
import { loadStaticEventMap } from "../static-event-map-client";
import styles from "./portal.module.css";

type Detail = { draft: MapDraftDetail; files: MapDraftFile[]; reviews: MapDraftReview[]; comments: MapDraftComment[] };
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string; conflict?: MapDraftConflict };
const IDLE: Status = { kind: "idle", message: "" };

const STATUS_LABEL: Record<MapDraftStatus, string> = {
  draft: "草稿", submitted: "待審", changes_requested: "需修改", approved: "已核准",
  rejected: "已拒絕", exported: "已匯出候選", withdrawn: "已被取代",
};

const ACTOR_LABEL: Record<MapDraftActorRole, string> = {
  map_contributor: "地圖貢獻者", admin: "管理者", system: "系統",
};
const CONFLICT_AT = new Intl.DateTimeFormat("zh-Hant", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei",
});

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

/** A version conflict is the one refusal the contributor can act on, so it
 * names the revision that now exists, when it changed and the role that
 * changed it. The other two refusals keep their own distinct message. */
function StatusNotice({ status, onReload }: { status: Status; onReload: (() => void) | null }) {
  if (status.kind === "idle") return null;
  const conflict = status.conflict;
  const text = conflict?.cause === "version"
    ? `草稿已更新至版本 ${conflict.revision}・${CONFLICT_AT.format(conflict.updatedAt)}・${ACTOR_LABEL[conflict.updatedByRole]}`
    : status.message;
  return <>
    <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{text}</p>
    {conflict && conflict.cause !== "permission" && onReload
      ? <button type="button" onClick={onReload}>重新載入草稿</button>
      : null}
  </>;
}

function Preview({ event, layout }: { event: EventDefinition; layout: EventMapLayout }) {
  const slots = useMemo(() => Object.fromEntries(layout.rows.flatMap((row) => row.slots.map(({ code }) => [code, {
    label: code, ariaLabel: `攤位 ${code}`,
  }]))), [layout]);
  return <div className={styles.mapReviewPreview}>
    <AccessibleEventMapRenderer eventName={`${event.name} 草稿預覽`} layout={layout} slots={slots} onSelect={() => undefined} />
  </div>;
}

function previewUrl(fileId: string) {
  return withEventScope(`/api/map-contributions/files/${encodeURIComponent(fileId)}/preview`);
}

function Problems({ problems }: { problems: MapDraftProblem[] }) {
  if (!problems.length) return null;
  return <ul className={styles.problemList}>{problems.map((problem, index) => <li key={`${problem.code}:${index}`}>
    {problem.message}{problem.boothCodes?.length ? <small>{problem.boothCodes.join("、")}</small> : null}
  </li>)}</ul>;
}

function EvidenceList({ files, showReviewResult = false }: { files: MapDraftFile[]; showReviewResult?: boolean }) {
  if (!files.length) return <p>尚未上傳來源檔。</p>;
  return <ul className={styles.auditList}>{files.map((item) => {
    const fileUrl = withEventScope(`/api/map-contributions/files/${encodeURIComponent(item.id)}`);
    const canReadRaw = item.raw_deleted_at == null;
    return <li key={item.id}>
      {item.document_date}・<a href={item.source_url} rel="noreferrer" target="_blank">原始來源</a>
      {canReadRaw && item.mime.startsWith("image/") ? <>・<a href={previewUrl(item.id)} rel="noreferrer" target="_blank">預覽上傳檔</a></> : null}
      {canReadRaw ? <>・<a href={fileUrl}>下載上傳檔</a></> : <>・原始檔已依保存期限刪除</>}
      ・版本 {item.revision}{showReviewResult ? `・${item.review_result ?? "尚未確認來源"}` : ""}・SHA-256 {item.sha256}
    </li>;
  })}</ul>;
}

function DraftList({ drafts, selected, onSelect }: { drafts: MapDraftSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!drafts.length) return <p>目前沒有草稿。</p>;
  return <ul className={styles.claimList}>{drafts.map((draft) => <li key={draft.id}>
    <div><b>{draft.period_key}・{draft.venue_space_id}</b><small>{draft.id}・版本 {draft.current_revision}{draft.owner_email ? `・${draft.owner_email}` : ""}</small></div>
    <span>{STATUS_LABEL[draft.status]}</span>
    <button type="button" aria-pressed={selected === draft.id} onClick={() => onSelect(draft.id)}>開啟</button>
  </li>)}</ul>;
}

const COMMENT_AT = new Intl.DateTimeFormat("zh-Hant", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei",
});
const TARGET_LABEL: Record<"slot" | "landmark", string> = { slot: "攤位", landmark: "區域" };

/** A request names an element the draft carried when it was written. The
 * contributor can then remove that element - which is often what was asked for
 * - so what is on the canvas now decides whether the reference is still
 * reachable. An unreachable one reads as text; a button there would be one the
 * reader can press and that does nothing. */
function targetInLayout(layout: EventMapLayout | null, comment: MapDraftComment) {
  if (!layout || !comment.target_kind || !comment.target_ref) return false;
  return comment.target_kind === "slot"
    ? layout.rows.some((row) => row.slots.some((slot) => slot.code === comment.target_ref))
    : layout.landmarks.some((landmark) => landmark.id === comment.target_ref);
}

function CommentThread({ comments, layout, onFocus }: {
  comments: MapDraftComment[];
  layout: EventMapLayout | null;
  onFocus: ((comment: MapDraftComment) => void) | null;
}) {
  if (!comments.length) return null;
  return <ul className={styles.commentThread}>{comments.map((item) => <li key={item.id}>
    <span>{ACTOR_LABEL[item.author_role as MapDraftActorRole] ?? item.author_role}・版本 {item.revision}・{COMMENT_AT.format(item.at)}</span>
    {item.target_kind && item.target_ref
      ? <b>{onFocus && targetInLayout(layout, item)
        ? <button type="button" onClick={() => onFocus(item)}>{TARGET_LABEL[item.target_kind]} {item.target_ref}</button>
        : `${TARGET_LABEL[item.target_kind]} ${item.target_ref}`}</b>
      : null}
    <p>{item.body}</p>
  </li>)}</ul>;
}

export function MapContributorPanel({ event }: { event: EventDefinition }) {
  const [drafts, setDrafts] = useState<MapDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [layout, setLayout] = useState<EventMapLayout | null>(null);
  const [savedLayoutJson, setSavedLayoutJson] = useState("");
  const [periodKey, setPeriodKey] = useState(String(event.days[0]?.id ?? ""));
  const [venueSpaceId, setVenueSpaceId] = useState(event.venueAssignments[0]?.venueSpaceId ?? "");
  const [status, setStatus] = useState<Status>(IDLE);
  const [problems, setProblems] = useState<MapDraftProblem[]>([]);
  const [sourceUrl, setSourceUrl] = useState(event.officialData.eventUrl);
  const [documentDate, setDocumentDate] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState("");
  const [focusTarget, setFocusTarget] = useState<MapEditorFocusTarget | null>(null);

  const refreshList = useCallback(async () => setDrafts((await listMyMapDrafts()).drafts), []);
  const openDraft = useCallback(async (draftId: string) => {
    const next = await readMapDraft(draftId);
    setSelectedId(draftId); setDetail(next); setLayout(next.draft.content.layout);
    setSavedLayoutJson(JSON.stringify(next.draft.content.layout)); setProblems([]);
  }, []);
  /** Opening a different draft resets what was typed against the last one: the
   * send button posts to whichever draft is open, so a leftover reply would go
   * to the wrong thread. Reloading the same draft keeps it. */
  const selectDraft = useCallback(async (draftId: string) => {
    setComment(""); setFocusTarget(null);
    await openDraft(draftId);
  }, [openDraft]);
  useEffect(() => { queueMicrotask(() => { void refreshList(); }); }, [refreshList]);

  const run = async (task: () => Promise<void>, ok: string) => {
    setStatus({ kind: "busy", message: "處理中…" }); setProblems([]);
    try { await task(); setStatus({ kind: "ok", message: ok }); }
    catch (error) {
      setProblems(mapDraftProblems(error));
      setStatus({ kind: "error", message: message(error), conflict: mapDraftConflict(error) ?? undefined });
    }
  };

  const editable = detail?.draft.status === "draft" || detail?.draft.status === "changes_requested";
  const hasUnsavedChanges = !!layout && JSON.stringify(layout) !== savedLayoutJson;
  const previewFile = detail?.files.find((item) => item.revision === detail.draft.current_revision
    && item.raw_deleted_at == null && item.mime.startsWith("image/"));

  return <section className={`${styles.card} ${styles.editorCard}`} id="map-contribution">
    <h2>活動地圖貢獻</h2>
    <p>草稿與來源檔僅供審閱。提交、核准與匯出候選都不會直接變更公開地圖；公開資料仍須進入 event-data repository 審查。</p>
    <DraftList drafts={drafts} selected={selectedId} onSelect={(id) => void run(() => selectDraft(id), "草稿已載入。")} />
    {!detail && <div className={styles.mapDraftCreate}>
      <label>活動日<select value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>{event.days.map((day) => <option key={String(day.id)} value={String(day.id)}>{day.label}</option>)}</select></label>
      <label>場地空間<select value={venueSpaceId} onChange={(event) => setVenueSpaceId(event.target.value)}>{event.venueAssignments.map((venue) => <option key={venue.venueSpaceId} value={venue.venueSpaceId}>{venue.venueSpaceName}</option>)}</select></label>
      <button type="button" onClick={() => void run(async () => {
        const current = await loadStaticEventMap(event.id);
        const created = await createMapContributionDraft(periodKey, venueSpaceId, current.layout);
        await refreshList(); await openDraft(created.draftId);
      }, "私人草稿已建立。")}>從目前公開地圖建立私人草稿</button>
    </div>}
    {detail && layout && <>
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{detail.draft.period_key}・{detail.draft.venue_space_id}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・版本 {detail.draft.current_revision}</dd></div></dl>
      {editable && <MapLayoutEditor layout={layout} backgroundImageUrl={previewFile ? previewUrl(previewFile.id) : undefined} focusTarget={focusTarget} onChange={setLayout} />}
      <h3>公開地圖預覽</h3><Preview event={event} layout={layout} />
      {editable && <>
        <div className={styles.editorActions}>
          <button type="button" onClick={() => void run(async () => {
            const saved = await saveMapContributionDraft(detail.draft.id, detail.draft.current_revision, layout);
            await openDraft(detail.draft.id); await refreshList();
            setStatus({ kind: "ok", message: `已儲存版本 ${saved.revision}；請為這個版本上傳來源檔。` });
          }, "草稿已儲存。")}>儲存新版本</button>
          <button type="button" disabled={hasUnsavedChanges} onClick={() => void run(async () => {
            await submitMapContributionDraft(detail.draft.id, detail.draft.current_revision);
            await openDraft(detail.draft.id); await refreshList();
          }, "草稿已送審。")}>提交審閱</button>
        </div>
        {hasUnsavedChanges && <p className={styles.notice}>請先儲存新版本，再為該版本上傳來源並提交。</p>}
        <h3>目前版本的官方來源</h3>
        <label>活動官方說明頁 URL<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
        <label>文件日期<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></label>
        <label>頁碼（選填）<input type="number" min="1" value={pageNumber} onChange={(event) => setPageNumber(event.target.value)} /></label>
        <label>來源檔<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" disabled={!file || !sourceUrl || !documentDate} onClick={() => void run(async () => {
          if (!file) return;
          await uploadMapContributionEvidence({
            draftId: detail.draft.id, revision: detail.draft.current_revision, file, sourceUrl, documentDate,
            pageNumber: pageNumber ? Number(pageNumber) : null,
          });
          await openDraft(detail.draft.id); setFile(null);
        }, "來源檔已綁定目前版本。")}>上傳私人來源檔</button>
      </>}
      <h3>審閱留言</h3>
      <CommentThread comments={detail.comments} layout={layout} onFocus={editable ? (item) => {
        if (item.target_kind && item.target_ref) setFocusTarget({ kind: item.target_kind, ref: item.target_ref, nonce: Date.now() });
      } : null} />
      <label>留言<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <button type="button" disabled={!comment.trim()} onClick={() => void run(async () => {
        await postMapDraftComment({ draftId: detail.draft.id, body: comment });
        setComment(""); await openDraft(detail.draft.id);
      }, "留言已送出。")}>送出留言</button>
      <h3>來源與審閱軌跡</h3>
      <EvidenceList files={detail.files} />
      <ul className={styles.auditList}>{detail.reviews.map((item, index) => <li key={`${item.at}:${index}`}>{item.from_status} → {item.to_status}・版本 {item.revision}{item.note ? `・${item.note}` : ""}</li>)}</ul>
    </>}
    <Problems problems={problems} />
    <StatusNotice status={status} onReload={detail ? () => void run(() => openDraft(detail.draft.id), "草稿已載入。") : null} />
  </section>;
}

export function AdminMapReviewPanel({ event }: { event: EventDefinition }) {
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
  const refreshList = useCallback(async () => setDrafts((await listAdminMapDrafts()).drafts), []);
  /** Refreshes the thread without touching what the reviewer has queued or
   * typed, which is what a standalone reply needs. */
  const reloadDetail = useCallback(async (id: string) => setDetail(await readMapDraft(id, true)), []);
  // Everything draft-scoped is reset together. Leaving the composer filled
  // would let review text typed against one draft be sent to another.
  const openDraft = useCallback(async (id: string) => {
    setSelectedId(id); setDetail(await readMapDraft(id, true)); setProblems([]); setCandidate(null);
    setOfficialSourceConfirmed(false); setTargets([]); setTargetKind("draft"); setTargetRef(""); setTargetBody("");
  }, []);
  useEffect(() => { queueMicrotask(() => { void refreshList(); }); }, [refreshList]);
  const run = async (task: () => Promise<void>, ok: string) => {
    setStatus({ kind: "busy", message: "處理中…" }); setProblems([]);
    try { await task(); setStatus({ kind: "ok", message: ok }); }
    catch (error) {
      setProblems(mapDraftProblems(error));
      setStatus({ kind: "error", message: message(error), conflict: mapDraftConflict(error) ?? undefined });
    }
  };
  const decide = (decision: "changes_requested" | "approve" | "reject") => detail && run(async () => {
    await reviewMapContributionDraft({
      draftId: detail.draft.id, expectedRevision: detail.draft.current_revision, decision,
      note: note || undefined, replacementDraftId: replacementDraftId || undefined,
      confirmOfficialSource: decision === "approve" ? officialSourceConfirmed : undefined,
      // Only a request to change carries per-element requests; an approval or a
      // rejection ends the draft, so there is nothing left to point at.
      targets: decision === "changes_requested" && targets.length ? targets : undefined,
    });
    await openDraft(detail.draft.id); await refreshList();
  }, decision === "approve" ? "草稿已核准。" : decision === "reject" ? "草稿已拒絕。" : "已要求修改。" );

  const downloadCandidate = () => {
    if (!candidate) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(candidate.map, null, 2) + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = candidate.targetPath.split("/").at(-1) ?? "map.json"; anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className={`${styles.card} ${styles.editorCard} ${styles.admin}`} id="map-review">
    <h2>地圖草稿審閱</h2>
    <p>核准只確認私人草稿；「匯出候選」仍不會發布。請以候選 JSON 與語意差異建立 event-data repository 的可審查變更。</p>
    <DraftList drafts={drafts} selected={selectedId} onSelect={(id) => void run(() => openDraft(id), "審閱資料已載入。")} />
    {detail && <>
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{detail.draft.period_key}・{detail.draft.venue_space_id}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・版本 {detail.draft.current_revision}</dd></div></dl>
      <Preview event={event} layout={detail.draft.content.layout} />
      <label>審閱說明<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <h3>審閱留言</h3>
      <CommentThread comments={detail.comments} layout={detail.draft.content.layout} onFocus={null} />
      <div className={styles.commentTarget}>
        <label>對象<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as "slot" | "landmark" | "draft")}><option value="draft">整份草稿</option><option value="slot">攤位</option><option value="landmark">區域</option></select></label>
        <label>{targetKind === "landmark" ? "區域 ID" : "攤位代碼"}<input disabled={targetKind === "draft"} value={targetRef} onChange={(event) => setTargetRef(event.target.value)} /></label>
      </div>
      <label>留言<textarea rows={2} value={targetBody} onChange={(event) => setTargetBody(event.target.value)} /></label>
      <div className={styles.reviewActions}>
        {/* Sent now, so a thread stays answerable after the draft has left
            `submitted` and the decision buttons below are gone. */}
        <button type="button" disabled={!targetBody.trim() || (targetKind !== "draft" && !targetRef.trim())} onClick={() => void run(async () => {
          await postMapDraftComment({
            draftId: detail.draft.id, body: targetBody.trim(),
            ...(targetKind === "draft" ? {} : { targetKind, targetRef: targetRef.trim() }),
          });
          setTargetRef(""); setTargetBody(""); await reloadDetail(detail.draft.id);
        }, "留言已送出。")}>送出留言</button>
        {/* Queued instead, so the request rides the decision and is written
            only once that transition takes effect. */}
        <button type="button" disabled={targetKind === "draft" || !targetRef.trim() || !targetBody.trim()} onClick={() => {
          if (targetKind === "draft") return;
          setTargets([...targets, { targetKind, targetRef: targetRef.trim(), body: targetBody.trim() }]);
          setTargetRef(""); setTargetBody("");
        }}>隨「要求修改」送出</button>
      </div>
      {!!targets.length && <ul className={styles.auditList}>{targets.map((item, index) => <li key={`${item.targetKind}:${item.targetRef}:${index}`}>
        {TARGET_LABEL[item.targetKind]} {item.targetRef}・{item.body}
        <button type="button" onClick={() => setTargets(targets.filter((entry, position) => position !== index))}>移除</button>
      </li>)}</ul>}
      <label>取代既有核准 draftId（只有同範圍已有核准稿時填寫）<input value={replacementDraftId} onChange={(event) => setReplacementDraftId(event.target.value)} /></label>
      <label className={styles.confirmCheck}><input type="checkbox" checked={officialSourceConfirmed} onChange={(event) => setOfficialSourceConfirmed(event.target.checked)} /><span>我已逐一確認目前版本的來源檔來自活動官方說明頁面。</span></label>
      {detail.draft.status === "submitted" && <div className={styles.reviewActions}><button type="button" onClick={() => void decide("changes_requested")}>要求修改</button><button type="button" onClick={() => void decide("reject")}>拒絕</button><button type="button" onClick={() => void decide("approve")}>核准</button></div>}
      {(detail.draft.status === "approved" || detail.draft.status === "exported") && <button type="button" onClick={() => void run(async () => {
        const result = await exportMapContributionCandidate(detail.draft.id, detail.draft.current_revision);
        await openDraft(detail.draft.id); await refreshList();
        setCandidate({ map: result.candidate, diff: result.diff, targetPath: result.targetPath, sha256: result.candidateSha256 });
      }, "候選已建立；尚未發布。")}>匯出 event-data 候選</button>}
      {candidate && <div className={styles.candidate}><b>{candidate.targetPath}</b><small>SHA-256 {candidate.sha256}</small><pre>{JSON.stringify(candidate.diff, null, 2)}</pre><button type="button" onClick={downloadCandidate}>下載候選 JSON</button></div>}
      <h3>官方來源與狀態軌跡</h3>
      <EvidenceList files={detail.files} showReviewResult />
      <ul className={styles.auditList}>{detail.reviews.map((item, index) => <li key={`${item.at}:${index}`}>{item.from_status} → {item.to_status}・版本 {item.revision}{item.note ? `・${item.note}` : ""}</li>)}</ul>
    </>}
    <Problems problems={problems} />
    <StatusNotice status={status} onReload={detail ? () => void run(() => openDraft(detail.draft.id), "審閱資料已載入。") : null} />
  </section>;
}
