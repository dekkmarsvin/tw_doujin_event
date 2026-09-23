import { useMemo } from "react";
import AccessibleEventMapRenderer from "./accessible-event-map-renderer";
import { withEventScope, type MapDraftComment, type MapDraftDetail, type MapDraftFile, type MapDraftReview, type MapDraftStatus, type MapDraftSummary } from "./circle-editor-client";
import type { EventDefinition } from "./event-catalog";
import type { EventMapLayout } from "./event-map";
import { resolveCanonicalMapPeriod, type MapDraftActorRole, type MapDraftConflict, type MapDraftProblem } from "./map-contribution-draft";
import type { MapBoothScope } from "./map-booth-coverage";
import styles from "./circle-portal/portal.module.css";

export type Detail = { draft: MapDraftDetail; files: MapDraftFile[]; reviews: MapDraftReview[]; comments: MapDraftComment[]; scope?: MapBoothScope | null };
export type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string; conflict?: MapDraftConflict };
export const IDLE: Status = { kind: "idle", message: "" };

export const STATUS_LABEL: Record<MapDraftStatus, string> = {
  draft: "草稿", submitted: "待審", changes_requested: "需修改", approved: "已核准",
  rejected: "已拒絕", exported: "已匯出候選", withdrawn: "已被取代",
};

const ACTOR_LABEL: Record<MapDraftActorRole, string> = {
  map_contributor: "地圖貢獻者", admin: "管理者", system: "系統",
};
const CONFLICT_AT = new Intl.DateTimeFormat("zh-Hant", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei",
});

export function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

/** A version conflict is the one refusal the contributor can act on, so it
 * names the revision that now exists, when it changed and the role that
 * changed it. The other two refusals keep their own distinct message. */
export function StatusNotice({ status, onReload }: { status: Status; onReload: (() => void) | null }) {
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

export function Preview({ event, layout }: { event: EventDefinition; layout: EventMapLayout }) {
  const slots = useMemo(() => Object.fromEntries(layout.rows.flatMap((row) => row.slots.map(({ code }) => [code, {
    label: code, ariaLabel: `攤位 ${code}`,
  }]))), [layout]);
  return <div className={styles.mapReviewPreview}>
    <AccessibleEventMapRenderer eventName={`${event.name} 草稿預覽`} layout={layout} slots={slots} onSelect={() => undefined} />
  </div>;
}

export function previewUrl(fileId: string) {
  return withEventScope(`/api/map-contributions/files/${encodeURIComponent(fileId)}/preview`);
}

export function Problems({ problems }: { problems: MapDraftProblem[] }) {
  if (!problems.length) return null;
  return <ul className={styles.problemList}>{problems.map((problem, index) => <li key={`${problem.code}:${index}`}>
    {problem.message}{problem.boothCodes?.length ? <small>{problem.boothCodes.join("、")}</small> : null}
  </li>)}</ul>;
}

export function EvidenceList({ files, showReviewResult = false }: { files: MapDraftFile[]; showReviewResult?: boolean }) {
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

/** The day and the space as the event names them, e.g. 「第 1 日・1F 開放式場地」. */
export function draftScopeLabel(event: EventDefinition, periodKey: string, venueSpaceId: string) {
  const day = resolveCanonicalMapPeriod(event.days, periodKey)?.period;
  const space = event.venueAssignments.find((assignment) => assignment.venueSpaceId === venueSpaceId);
  return `${day?.label ?? periodKey}・${space?.venueSpaceName ?? venueSpaceId}`;
}

export function DraftList({ event, drafts, selected, onSelect }: { event: EventDefinition; drafts: MapDraftSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!drafts.length) return <p>目前沒有草稿。</p>;
  return <ul className={styles.claimList}>{drafts.map((draft) => <li key={draft.id}>
    <div><b>{draftScopeLabel(event, draft.period_key, draft.venue_space_id)}</b><small>{draft.id}・版本 {draft.current_revision}{draft.owner_email ? `・${draft.owner_email}` : ""}</small></div>
    <span>{STATUS_LABEL[draft.status]}</span>
    <button type="button" aria-pressed={selected === draft.id} onClick={() => onSelect(draft.id)}>開啟</button>
  </li>)}</ul>;
}

const COMMENT_AT = new Intl.DateTimeFormat("zh-Hant", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei",
});
export const TARGET_LABEL: Record<"slot" | "landmark", string> = { slot: "攤位", landmark: "區域" };

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

export function CommentThread({ comments, layout, onFocus }: {
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

