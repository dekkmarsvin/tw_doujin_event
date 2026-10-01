import type { OrganizerCandidateStatus } from "./organizer-event";

/** Review and publication are distinct outcomes even when one candidate status names both. */
export function organizerStatusSummary(status: OrganizerCandidateStatus) {
  const review = status === "draft" ? "尚未送審" : status === "submitted" ? "審核中"
    : status === "changes_requested" ? "要求修改" : status === "abandoned" ? "已終止修正" : "已核准";
  const publication = status === "published" ? "已發布" : status === "publishing" ? "發布中"
    : status === "failed" ? "發布失敗" : status === "approved" ? "等待發布" : "尚未發布";
  return { review, publication };
}
