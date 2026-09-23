import type { QueuedClaim } from "../circle-editor-client";

export type ClaimDecision = "approve" | "reject";

/** Claims a batch leaves in the queue, grouped per circle so the confirmation
 * can name each circle once. */
export type SkippedClaims = { ids: string[]; circleName: string; count: number; reason: "claimed" | "duplicate" };

export type ClaimBatchPlan = { decision: ClaimDecision; go: QueuedClaim[]; skipped: SkippedClaims[] };

/**
 * What a batch will actually send, in queue order.
 *
 * Rejecting is always possible. Approving is not where the circle already has
 * an owner in that event, which the server refuses, nor where two claims for
 * the same circle were ticked together: only one of them can be approved, and
 * which one is the administrator's call, not the order of the loop. Both stay
 * in the queue for a decision of their own.
 */
export function planClaimBatch(claims: readonly QueuedClaim[], selected: ReadonlySet<string>, decision: ClaimDecision): ClaimBatchPlan {
  const chosen = claims.filter((claim) => selected.has(claim.id));
  if (decision === "reject") return { decision, go: chosen, skipped: [] };

  const byCircle = new Map<string, QueuedClaim[]>();
  for (const claim of chosen) {
    const key = `${claim.eventId}\u0000${claim.circleId}`;
    byCircle.set(key, [...(byCircle.get(key) ?? []), claim]);
  }
  const blocked = new Set<string>();
  const skipped: SkippedClaims[] = [];
  for (const group of byCircle.values()) {
    const reason = group[0].circleClaimed ? "claimed" : group.length > 1 ? "duplicate" : null;
    if (!reason) continue;
    group.forEach((claim) => blocked.add(claim.id));
    skipped.push({ ids: group.map((claim) => claim.id), circleName: group[0].circleName, count: group.length, reason });
  }
  return { decision, go: chosen.filter((claim) => !blocked.has(claim.id)), skipped };
}
