import type { ClaimSummary, PortalSession, ReviewQueue } from "./circle-editor-client";
import type { OrganizerEventSummary } from "./organizer-client";
import type { AdminSiteSettings } from "./site-settings";
import { forgetSignedIn } from "./session-hint";

/**
 * The reader's own, read-only view of the signed-in account (#581). The
 * control surfaces' clients stay out of the reader bundle: this module only
 * reads, never writes, and answers null for anything it could not read.
 */
async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
    // The session ended: this device is no longer signed in.
    if (response.status === 401) forgetSignedIn();
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

export const readReaderSession = () => read<PortalSession>("/api/auth/session");
export const readReaderClaims = (eventId: string) =>
  read<{ claims: ClaimSummary[] }>(`/api/claims?${new URLSearchParams({ event: eventId })}`).then((answer) => answer?.claims ?? null);
export const readReaderWorkspaces = () => read<{ events: OrganizerEventSummary[] }>("/api/organizer/events").then((answer) => answer?.events ?? null);
export const readReaderWorkspaceClaims = (candidateId: string) => read<ReviewQueue>(`/api/organizer/events/${encodeURIComponent(candidateId)}/claims`);
export const readReaderReviewQueue = () => read<ReviewQueue>("/api/admin/review-queue");
export const readReaderServices = () => read<AdminSiteSettings>("/api/admin/site-settings").then((answer) => answer?.services ?? null);
