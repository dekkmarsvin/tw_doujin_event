import type { CircleOverrideFields } from "./circle-overrides";

export type AdminCircleClaim = {
  id: string;
  status: "pending" | "verified" | "rejected" | "revoked" | "withdrawn";
  method: string | null;
  accountEmail: string | null;
  accountStatus: "active" | "disabled" | "deleting" | "deleted";
  createdAt: number;
  verifiedAt: number | null;
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewHref: string | null;
};

export type AdminCircleHistory = {
  action: "claim.approved" | "claim.rejected" | "claim.revoked" | "override.takendown";
  at: number;
  claimId: string | null;
  reason: string | null;
  by: string | null;
  retryCleanup: boolean;
};

export type AdminCircleDetail = {
  eventId: string;
  circleId: string;
  name: string;
  placements: { day: string | number; area: string; boothCode: string; status: "active" | "cancelled" | "moved" }[];
  publicHref: string | null;
  organizerHref: string | null;
  claims: AdminCircleClaim[];
  supplemental: {
    status: "none" | "live" | "takendown";
    fields: CircleOverrideFields | null;
    updatedAt: number | null;
    postEventHidden: boolean;
    publicState: "public" | "hidden";
    publicReason: null | "no_content" | "takendown" | "no_verified_claim" | "post_event_hidden";
    phase: "during" | "after";
    cleanupState: "not_required" | "complete" | "pending" | "unknown";
    takedown: { reason: string | null; at: number | null; by: string | null } | null;
  };
  history: AdminCircleHistory[];
};
