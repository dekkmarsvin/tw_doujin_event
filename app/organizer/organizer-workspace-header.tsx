import type { OrganizerEventDetail } from "../organizer-client";
import { organizerStatusSummary } from "../organizer-status-summary";
import { ROLE_LABEL } from "./organizer-shared";
import styles from "./organizer.module.css";

/** Which panel the header's controls lead to. A status is a way in to the
 * panel that changes it, so each one is marked while that panel is open. */
export type OrganizerHeaderTarget = "review" | "claims" | "members";

export function OrganizerWorkspaceHeader({ detail, current, onOpen, pendingClaims }: {
  detail: OrganizerEventDetail;
  current: OrganizerHeaderTarget | null;
  onOpen: (target: OrganizerHeaderTarget) => void;
  pendingClaims: number | "loading" | "error";
}) {
  const status = organizerStatusSummary(detail.event.status);
  const marked = (target: OrganizerHeaderTarget) => current === target ? "page" as const : undefined;
  return <header className={styles.activityHeader}>
    <div className={styles.activityIdentity}>
      <p>{detail.event.operation === "AMEND" ? "發布後修正" : "活動建置"}・{ROLE_LABEL[detail.event.role]}</p>
      <h2>{detail.draft.event.name || detail.event.tentativeName}</h2>
    </div>
    <div className={styles.activityStatus} role="group" aria-label="活動審核與發布狀態">
      <button type="button" aria-current={marked("review")} onClick={() => onOpen("review")}>
        <span>審核狀態</span><strong data-state={detail.event.status}>{status.review}</strong>
      </button>
      <button type="button" aria-current={marked("review")} onClick={() => onOpen("review")}>
        <span>發布狀態</span><strong data-state={detail.event.status}>{status.publication}</strong>
      </button>
      {detail.claimReviewAvailable && <button type="button" aria-current={marked("claims")} onClick={() => onOpen("claims")}>
        <span>社團認領</span><strong>{typeof pendingClaims === "number" ? `待審 ${pendingClaims} 筆` : pendingClaims === "error" ? "讀取失敗" : "讀取中…"}</strong>
      </button>}
    </div>
    <button type="button" className={styles.ghost} aria-current={marked("members")} onClick={() => onOpen("members")}>成員與權限</button>
  </header>;
}
