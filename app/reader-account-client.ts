import type { ClaimSummary, PortalSession, ReviewQueue } from "./circle-editor-client";
import type { OrganizerEventSummary } from "./organizer-client";
import type { AdminSiteSettings } from "./site-settings";
import { forgetSignedIn } from "./session-hint";

export class ReaderUnauthorizedError extends Error {
  constructor() { super("Session ended."); }
}

/** Read just the private account data the reader needs. */
async function read<T>(path: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    return null;
  }
  // The session ended: this device is no longer signed in.
  if (response.status === 401) {
    throw new ReaderUnauthorizedError();
  }
  if (!response.ok) return null;
  try {
    return await response.json() as T;
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

export async function endReaderSession() {
  const response = await fetch("/api/auth/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  if (response.status !== 401 && (!response.ok || (await response.json()).ok !== true)) throw new Error("Sign-out failed");
  forgetSignedIn();
  window.dispatchEvent(new Event("reader-signed-out"));
}
