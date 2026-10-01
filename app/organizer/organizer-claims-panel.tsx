import { useMemo } from "react";
import { AdminReviewQueue, type ClaimReviewScope } from "../admin/admin-review-queue";
import { decideOrganizerClaim, listOrganizerClaims } from "../organizer-client";
import type { ReviewQueue } from "../circle-editor-client";

export function OrganizerClaimsPanel({ candidateId, eventId, onQueueLoaded }: { candidateId: string; eventId: string; onQueueLoaded: (queue: ReviewQueue | null) => void }) {
  const claimScope = useMemo<ClaimReviewScope>(() => ({
    eventId,
    load: () => listOrganizerClaims(candidateId),
    decide: (claimId, decision) => decideOrganizerClaim(candidateId, claimId, decision),
  }), [candidateId, eventId]);
  return <AdminReviewQueue initialEventId={eventId} claimScope={claimScope} onQueueLoaded={onQueueLoaded} />;
}
