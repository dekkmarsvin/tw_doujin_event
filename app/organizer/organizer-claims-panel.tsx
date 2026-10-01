import { useMemo } from "react";
import { AdminReviewQueue, type ClaimReviewScope } from "../admin/admin-review-queue";
import { decideOrganizerClaim, listOrganizerClaims } from "../organizer-client";

export function OrganizerClaimsPanel({ candidateId, eventId }: { candidateId: string; eventId: string }) {
  const claimScope = useMemo<ClaimReviewScope>(() => ({
    eventId,
    load: () => listOrganizerClaims(candidateId),
    decide: (claimId, decision) => decideOrganizerClaim(candidateId, claimId, decision),
  }), [candidateId, eventId]);
  return <AdminReviewQueue initialEventId={eventId} claimScope={claimScope} />;
}
