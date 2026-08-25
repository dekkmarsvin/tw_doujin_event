"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import {
  createMapContributionDraft, exportMapContributionCandidate, listAdminMapDrafts, listMyMapDrafts,
  mapDraftProblems, readMapDraft, reviewMapContributionDraft, saveMapContributionDraft,
  submitMapContributionDraft, uploadMapContributionEvidence,
  type MapDraftDetail, type MapDraftFile, type MapDraftReview, type MapDraftStatus, type MapDraftSummary,
} from "../circle-editor-client";
import { ACTIVE_EVENT } from "../event-catalog";
import type { EventMapLayout, PublishedEventMap } from "../event-map";
import MapLayoutEditor from "../map-layout-editor";
import type { MapCandidateDiff, MapDraftProblem } from "../map-contribution-draft";
import { loadStaticEventMap } from "../static-event-map-client";
import styles from "./portal.module.css";

type Detail = { draft: MapDraftDetail; files: MapDraftFile[]; reviews: MapDraftReview[] };
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Status = { kind: "idle", message: "" };

const STATUS_LABEL: Record<MapDraftStatus, string> = {
  draft: "草稿", submitted: "待審", changes_requested: "需修改", approved: "已核准",
  rejected: "已拒絕", exported: "已匯出候選", withdrawn: "已被取代",
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

function Preview({ layout }: { layout: EventMapLayout }) {
  const slots = useMemo(() => Object.fromEntries(layout.rows.flatMap((row) => row.slots.map(({ code }) => [code, {
    label: code, ariaLabel: `攤位 ${code}`,
  }]))), [layout]);
  return <div className={styles.mapReviewPreview}>
    <AccessibleEventMapRenderer eventName={`${ACTIVE_EVENT.name} 草稿預覽`} layout={layout} slots={slots} onSelect={() => undefined} />
  </div>;
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
    const fileUrl = `/api/map-contributions/files/${encodeURIComponent(item.id)}`;
    const canReadRaw = item.raw_deleted_at == null;
    return <li key={item.id}>
      {item.document_date}・<a href={item.source_url} rel="noreferrer" target="_blank">投稿來源頁面</a>
      {canReadRaw && item.mime.startsWith("image/") ? <>・<a href={`${fileUrl}/preview`} rel="noreferrer" target="_blank">預覽上傳檔</a></> : null}
      {canReadRaw ? <>・<a href={fileUrl}>下載上傳檔</a></> : <>・原始檔已依保存期限刪除</>}
      ・revision {item.revision}{showReviewResult ? `・${item.review_result ?? "尚未確認來源"}` : ""}・SHA-256 {item.sha256}
    </li>;
  })}</ul>;
}

function DraftList({ drafts, selected, onSelect }: { drafts: MapDraftSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!drafts.length) return <p>目前沒有草稿。</p>;
  return <ul className={styles.claimList}>{drafts.map((draft) => <li key={draft.id}>
    <div><b>{draft.period_key}・{draft.venue_space_id}</b><small>{draft.id}・revision {draft.current_revision}{draft.owner_email ? `・${draft.owner_email}` : ""}</small></div>
    <span>{STATUS_LABEL[draft.status]}</span>
    <button type="button" aria-pressed={selected === draft.id} onClick={() => onSelect(draft.id)}>開啟</button>
  </li>)}</ul>;
}

export function MapContributorPanel() {
  const [drafts, setDrafts] = useState<MapDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [layout, setLayout] = useState<EventMapLayout | null>(null);
  const [savedLayoutJson, setSavedLayoutJson] = useState("");
  const [periodKey, setPeriodKey] = useState(String(ACTIVE_EVENT.days[0]?.id ?? ""));
  const [venueSpaceId, setVenueSpaceId] = useState(ACTIVE_EVENT.venueAssignments[0]?.venueSpaceId ?? "");
  const [status, setStatus] = useState<Status>(IDLE);
  const [problems, setProblems] = useState<MapDraftProblem[]>([]);
  const [sourceUrl, setSourceUrl] = useState(ACTIVE_EVENT.officialData.eventUrl);
  const [documentDate, setDocumentDate] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const refreshList = useCallback(async () => setDrafts((await listMyMapDrafts()).drafts), []);
  const openDraft = useCallback(async (draftId: string) => {
    const next = await readMapDraft(draftId);
    setSelectedId(draftId); setDetail(next); setLayout(next.draft.content.layout);
    setSavedLayoutJson(JSON.stringify(next.draft.content.layout)); setProblems([]);
  }, []);
  useEffect(() => { queueMicrotask(() => { void refreshList(); }); }, [refreshList]);

  const run = async (task: () => Promise<void>, ok: string) => {
    setStatus({ kind: "busy", message: "處理中…" }); setProblems([]);
    try { await task(); setStatus({ kind: "ok", message: ok }); }
    catch (error) { setProblems(mapDraftProblems(error)); setStatus({ kind: "error", message: message(error) }); }
  };

  const editable = detail?.draft.status === "draft" || detail?.draft.status === "changes_requested";
  const hasUnsavedChanges = !!layout && JSON.stringify(layout) !== savedLayoutJson;
  const previewFile = detail?.files.find((item) => item.revision === detail.draft.current_revision
    && item.raw_deleted_at == null && item.mime.startsWith("image/"));

  return <section className={`${styles.card} ${styles.editorCard}`} id="map-contribution">
    <h2>活動地圖貢獻</h2>
    <p>草稿與來源檔僅供審閱。提交、核准與匯出候選都不會直接變更公開地圖；公開資料仍須進入 event-data repository 審查。</p>
    <DraftList drafts={drafts} selected={selectedId} onSelect={(id) => void run(() => openDraft(id), "草稿已載入。")} />
    {!detail && <div className={styles.mapDraftCreate}>
      <label>活動日<select value={periodKey} onChange={(event) => setPeriodKey(event.target.value)}>{ACTIVE_EVENT.days.map((day) => <option key={String(day.id)} value={String(day.id)}>{day.label}</option>)}</select></label>
      <label>場地空間<select value={venueSpaceId} onChange={(event) => setVenueSpaceId(event.target.value)}>{ACTIVE_EVENT.venueAssignments.map((venue) => <option key={venue.venueSpaceId} value={venue.venueSpaceId}>{venue.venueSpaceName}</option>)}</select></label>
      <button type="button" onClick={() => void run(async () => {
        const current = await loadStaticEventMap(ACTIVE_EVENT.id);
        const created = await createMapContributionDraft(periodKey, venueSpaceId, current.layout);
        await refreshList(); await openDraft(created.draftId);
      }, "私人草稿已建立。")}>從目前公開地圖建立私人草稿</button>
    </div>}
    {detail && layout && <>
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{detail.draft.period_key}・{detail.draft.venue_space_id}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・revision {detail.draft.current_revision}</dd></div></dl>
      {editable && <MapLayoutEditor layout={layout} backgroundImageUrl={previewFile ? `/api/map-contributions/files/${encodeURIComponent(previewFile.id)}/preview` : undefined} onChange={setLayout} />}
      <h3>共用公開 renderer 預覽</h3><Preview layout={layout} />
      {editable && <>
        <div className={styles.editorActions}>
          <button type="button" onClick={() => void run(async () => {
            const saved = await saveMapContributionDraft(detail.draft.id, detail.draft.current_revision, layout);
            await openDraft(detail.draft.id); await refreshList();
            setStatus({ kind: "ok", message: `已儲存 revision ${saved.revision}；請為這個 revision 上傳來源檔。` });
          }, "草稿已儲存。")}>儲存新 revision</button>
          <button type="button" disabled={hasUnsavedChanges} onClick={() => void run(async () => {
            await submitMapContributionDraft(detail.draft.id, detail.draft.current_revision);
            await openDraft(detail.draft.id); await refreshList();
          }, "草稿已送審。")}>提交審閱</button>
        </div>
        {hasUnsavedChanges && <p className={styles.notice}>請先儲存新 revision，再為該 revision 上傳來源並提交。</p>}
        <h3>目前 revision 的官方來源</h3>
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
        }, "來源檔已綁定目前 revision。")}>上傳私人來源檔</button>
      </>}
      <h3>來源與審閱軌跡</h3>
      <EvidenceList files={detail.files} />
      <ul className={styles.auditList}>{detail.reviews.map((item, index) => <li key={`${item.at}:${index}`}>{item.from_status} → {item.to_status}・revision {item.revision}{item.note ? `・${item.note}` : ""}</li>)}</ul>
    </>}
    <Problems problems={problems} />
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{status.message}</p>}
  </section>;
}

export function AdminMapReviewPanel() {
  const [drafts, setDrafts] = useState<MapDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [replacementDraftId, setReplacementDraftId] = useState("");
  const [officialSourceConfirmed, setOfficialSourceConfirmed] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [problems, setProblems] = useState<MapDraftProblem[]>([]);
  const [candidate, setCandidate] = useState<{ map: PublishedEventMap; diff: MapCandidateDiff; targetPath: string; sha256: string } | null>(null);
  const refreshList = useCallback(async () => setDrafts((await listAdminMapDrafts()).drafts), []);
  const openDraft = useCallback(async (id: string) => { setSelectedId(id); setDetail(await readMapDraft(id, true)); setProblems([]); setCandidate(null); setOfficialSourceConfirmed(false); }, []);
  useEffect(() => { queueMicrotask(() => { void refreshList(); }); }, [refreshList]);
  const run = async (task: () => Promise<void>, ok: string) => {
    setStatus({ kind: "busy", message: "處理中…" }); setProblems([]);
    try { await task(); setStatus({ kind: "ok", message: ok }); }
    catch (error) { setProblems(mapDraftProblems(error)); setStatus({ kind: "error", message: message(error) }); }
  };
  const decide = (decision: "changes_requested" | "approve" | "reject") => detail && run(async () => {
    await reviewMapContributionDraft({
      draftId: detail.draft.id, expectedRevision: detail.draft.current_revision, decision,
      note: note || undefined, replacementDraftId: replacementDraftId || undefined,
      confirmOfficialSource: decision === "approve" ? officialSourceConfirmed : undefined,
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
      <dl className={styles.reviewSummary}><div><dt>範圍</dt><dd>{detail.draft.period_key}・{detail.draft.venue_space_id}</dd></div><div><dt>狀態</dt><dd>{STATUS_LABEL[detail.draft.status]}・revision {detail.draft.current_revision}</dd></div></dl>
      <Preview layout={detail.draft.content.layout} />
      <label>審閱說明<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <label>取代既有核准 draftId（只有同範圍已有核准稿時填寫）<input value={replacementDraftId} onChange={(event) => setReplacementDraftId(event.target.value)} /></label>
      <label className={styles.confirmCheck}><input type="checkbox" checked={officialSourceConfirmed} onChange={(event) => setOfficialSourceConfirmed(event.target.checked)} /><span>我已逐一確認目前 revision 的來源檔來自活動官方說明頁面。</span></label>
      {detail.draft.status === "submitted" && <div className={styles.reviewActions}><button type="button" onClick={() => void decide("changes_requested")}>要求修改</button><button type="button" onClick={() => void decide("reject")}>拒絕</button><button type="button" onClick={() => void decide("approve")}>核准</button></div>}
      {(detail.draft.status === "approved" || detail.draft.status === "exported") && <button type="button" onClick={() => void run(async () => {
        const result = await exportMapContributionCandidate(detail.draft.id, detail.draft.current_revision);
        await openDraft(detail.draft.id); await refreshList();
        setCandidate({ map: result.candidate, diff: result.diff, targetPath: result.targetPath, sha256: result.candidateSha256 });
      }, "候選已建立；尚未發布。")}>匯出 event-data 候選</button>}
      {candidate && <div className={styles.candidate}><b>{candidate.targetPath}</b><small>SHA-256 {candidate.sha256}</small><pre>{JSON.stringify(candidate.diff, null, 2)}</pre><button type="button" onClick={downloadCandidate}>下載候選 JSON</button></div>}
      <h3>官方來源與狀態軌跡</h3>
      <EvidenceList files={detail.files} showReviewResult />
      <ul className={styles.auditList}>{detail.reviews.map((item, index) => <li key={`${item.at}:${index}`}>{item.from_status} → {item.to_status}・revision {item.revision}{item.note ? `・${item.note}` : ""}</li>)}</ul>
    </>}
    <Problems problems={problems} />
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{status.message}</p>}
  </section>;
}
