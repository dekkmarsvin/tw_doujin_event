import type { OrganizerEventDetail } from "../organizer-client";
import { organizerStatusSummary } from "../organizer-status-summary";
import { ROLE_LABEL } from "./organizer-shared";
import styles from "./organizer.module.css";

export function OrganizerWorkspaceHeader({ detail, onReview, pendingClaims }: { detail: OrganizerEventDetail; onReview: () => void; pendingClaims: number | "loading" | "error" }) {
  const status = organizerStatusSummary(detail.event.status);
  return <header className={styles.activityHeader}>
    <div className={styles.activityIdentity}>
      <p>{detail.event.operation === "AMEND" ? "發布後修正" : "活動建置"}・{ROLE_LABEL[detail.event.role]}</p>
      <h2>{detail.draft.event.name || detail.event.tentativeName}</h2>
    </div>
    <dl className={styles.activityStatus} aria-label="活動審核與發布狀態">
      <div><dt>審核狀態</dt><dd data-state={detail.event.status}>{status.review}</dd></div>
      <div><dt>發布狀態</dt><dd data-state={detail.event.status}>{status.publication}</dd></div>
      {detail.claimReviewAvailable && <div><dt>社團認領</dt><dd>{typeof pendingClaims === "number" ? `待審 ${pendingClaims} 筆` : pendingClaims === "error" ? "讀取失敗" : "讀取中…"}</dd></div>}
    </dl>
    <button type="button" className={styles.ghost} onClick={onReview}>送審與發布</button>
  </header>;
}
