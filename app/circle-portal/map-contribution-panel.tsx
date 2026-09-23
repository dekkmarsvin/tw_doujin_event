"use client";
import { useCallback, useEffect, useState } from "react";
import { createMapContributionDraft, listMyMapDrafts, mapDraftConflict, mapDraftProblems, postMapDraftComment, readMapDraft, saveMapContributionDraft, submitMapContributionDraft, uploadMapContributionEvidence, type MapDraftSummary } from "../circle-editor-client";
import { eventUsesScopedMaps, type EventDefinition } from "../event-catalog";
import type { EventMapLayout } from "../event-map";
import { EMPTY_MAP_AUTHORING, type MapAuthoringState } from "../map-authoring-state";
import MapLayoutEditor, { type MapEditorFocusTarget } from "../map-layout-editor";
import type { MapDraftProblem } from "../map-contribution-draft";
import { loadStaticEventMap } from "../static-event-map-client";
import { IDLE, STATUS_LABEL, CommentThread, DraftList, draftScopeLabel, EvidenceList, Preview, Problems, StatusNotice, message, previewUrl, type Detail, type Status } from "../map-contribution-panels";
import styles from "./portal.module.css";

export function MapContributorPanel({ event }: { event: EventDefinition }) {
  const [drafts, setDrafts] = useState<MapDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [layout, setLayout] = useState<EventMapLayout | null>(null);
  const [authoring, setAuthoring] = useState<MapAuthoringState>(EMPTY_MAP_AUTHORING);
  const [savedAuthoringJson, setSavedAuthoringJson] = useState(JSON.stringify(EMPTY_MAP_AUTHORING));
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
    setAuthoring(next.draft.content.authoring ?? EMPTY_MAP_AUTHORING); setSavedAuthoringJson(JSON.stringify(next.draft.content.authoring ?? EMPTY_MAP_AUTHORING));
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
  const hasUnsavedChanges = !!layout && (JSON.stringify(layout) !== savedLayoutJson || JSON.stringify(authoring) !== savedAuthoringJson);
  const previewFile = detail?.files.find((item) => item.revision === detail.draft.current_revision
    && item.raw_deleted_at == null && item.mime.startsWith("image/"));

  return <section className={`${styles.card} ${styles.editorCard}`} id="map-contribution">
    <h2>活動地圖貢獻</h2>
    <p>草稿與來源檔僅供審閱。提交或核准都不會直接變更公開地圖，公開內容仍須另行審查後才會更新。</p>
    <DraftList event={event} drafts={drafts} selected={selectedId} onSelect={(id) => void run(() => selectDraft(id), "草稿已載入。")} />
    {!detail && <div className={styles.mapDraftCreate}>
      <label>活動日<select value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>{event.days.map((day) => <option key={String(day.id)} value={String(day.id)}>{day.label}</option>)}</select></label>
      <label>使用空間<select value={venueSpaceId} onChange={(event) => setVenueSpaceId(event.target.value)}>{event.venueAssignments.map((venue) => <option key={venue.venueSpaceId} value={venue.venueSpaceId}>{venue.venueSpaceName}</option>)}</select></label>
      <button type="button" onClick={() => void run(async () => {
        const current = await loadStaticEventMap(event.id, eventUsesScopedMaps(event)
          ? { periodKey, venueSpaceId }
          : undefined);
        const created = await createMapContributionDraft(periodKey, venueSpaceId, current.layout);
        await refreshList(); await openDraft(created.draftId);
      }, "私人草稿已建立。")}>從目前公開地圖建立私人草稿</button>
    </div>}
    {detail && layout && <>
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{draftScopeLabel(event, detail.draft.period_key, detail.draft.venue_space_id)}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・版本 {detail.draft.current_revision}</dd></div></dl>
      {editable && <MapLayoutEditor key={detail.draft.id} layout={layout} scope={detail.scope} authoring={authoring} backgroundImageUrl={previewFile ? previewUrl(previewFile.id) : undefined} focusTarget={focusTarget} onChange={(next, nextAuthoring) => { setLayout(next); setAuthoring(nextAuthoring); }} />}
      <h3>公開地圖預覽</h3><Preview event={event} layout={layout} />
      {editable && <>
        <div className={styles.editorActions}>
          <button type="button" onClick={() => void run(async () => {
            const saved = await saveMapContributionDraft(detail.draft.id, detail.draft.current_revision, layout, authoring);
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
