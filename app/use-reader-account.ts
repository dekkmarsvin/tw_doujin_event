import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaimSummary, PortalSession, ReviewQueue } from "./circle-editor-client";
import type { OrganizerEventSummary } from "./organizer-client";
import { ReaderUnauthorizedError, readReaderClaims, readReaderReviewQueue, readReaderServices, readReaderSession, readReaderWorkspaceClaims, readReaderWorkspaces } from "./reader-account-client";
import type { ServiceChecks } from "./site-settings";
import { forgetSignedIn, SESSION_EXPIRED_EVENT, subscribeSignedInChange, wasSignedIn } from "./session-hint";

export type Account = {
  eventId: string;
  session: PortalSession;
  claims: ClaimSummary[] | null;
  /** The newest workspace this account is a member of for the event being read. */
  candidate: OrganizerEventSummary | null;
  candidatePendingClaims: number | null;
  queue: ReviewQueue | null;
  services: ServiceChecks | null;
};

/**
 * Who is signed in, and what waits for them, read only on a device that has
 * signed in before (#581). Re-read when the page comes back and when the
 * connection returns, like the overlay; no timers.
 */
export function useReaderAccount(eventId: string, claimsOnly = false, workspaceSession?: PortalSession | null, candidateId?: string) {
  const [account, setAccount] = useState<Account | null>(null);
  const sequence = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    const request = ++sequence.current.value;
    if (workspaceSession === null || (!workspaceSession && !wasSignedIn())) { setAccount(null); return; }
    try {
      const session = await readReaderSession();
      if (request !== sequence.current.value) return;
      if (!session) { setAccount(null); return; }
      if (workspaceSession && (session.email !== workspaceSession.email || session.isAdmin !== workspaceSession.isAdmin || session.hasOrganizerAccess !== workspaceSession.hasOrganizerAccess)) {
        setAccount(null);
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        return;
      }
      const [claims, events, queue, services] = await Promise.all([
        eventId ? readReaderClaims(eventId) : null,
        !claimsOnly && (eventId || candidateId) && session.hasOrganizerAccess ? readReaderWorkspaces() : null,
        !claimsOnly && session.isAdmin ? readReaderReviewQueue() : null,
        !claimsOnly && session.isAdmin ? readReaderServices() : null,
      ]);
      const candidate = (events ?? []).filter((item) => (candidateId ? item.id === candidateId : item.eventId === eventId) && (item.isMember ?? item.role !== "admin"))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      const organizerQueue = candidate && eventId ? await readReaderWorkspaceClaims(candidate.id) : null;
      if (request !== sequence.current.value) return;
      setAccount({
        eventId, session, claims, candidate, queue, services,
        candidatePendingClaims: organizerQueue ? organizerQueue.pendingClaimCount ?? organizerQueue.claims.length : null,
      });
    } catch (error) {
      if (error instanceof ReaderUnauthorizedError && request === sequence.current.value) {
        forgetSignedIn();
        if (workspaceSession) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        ++sequence.current.value;
        setAccount(null);
      }
    }
  }, [eventId, claimsOnly, workspaceSession, candidateId]);
  useEffect(() => {
    const requests = sequence.current;
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const online = () => void refresh();
    const timer = workspaceSession ? window.setInterval(visible, 30_000) : undefined;
    const stopStorage = subscribeSignedInChange(() => {
      if (workspaceSession && !wasSignedIn()) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      else void refresh();
    });
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    return () => {
      active = false;
      ++requests.value;
      window.clearInterval(timer);
      stopStorage();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
    };
  }, [refresh, workspaceSession]);
  return account?.eventId === eventId && (!workspaceSession || account.session.email === workspaceSession.email) && (!candidateId || !account.candidate || account.candidate.id === candidateId) ? account : null;
}
