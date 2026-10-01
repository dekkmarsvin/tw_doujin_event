import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewQueue } from "../circle-editor-client";
import { listOrganizerClaims } from "../organizer-client";

export function useOrganizerPendingClaims(candidateId: string | null, eventId: string | null, queueOpen: boolean) {
  const [result, setResult] = useState<{ candidateId: string; count: number | "error" } | null>(null);
  const sequence = useRef({ value: 0 });
  const onQueueLoaded = useCallback((queue: ReviewQueue | null) => {
    if (!candidateId) return;
    ++sequence.current.value;
    setResult({ candidateId, count: queue ? queue.pendingClaimCount ?? queue.claims.filter(claim => claim.eventId === eventId).length : "error" });
  }, [candidateId, eventId]);

  useEffect(() => {
    if (!candidateId || queueOpen) return;
    let active = true;
    const requests = sequence.current;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const request = ++requests.value;
      void listOrganizerClaims(candidateId).then(queue => {
        if (active && request === requests.value) onQueueLoaded(queue);
      }).catch(() => {
        if (active && request === requests.value) setResult({ candidateId, count: "error" });
      });
    };
    queueMicrotask(() => { if (active) refresh(); });
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      ++requests.value;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [candidateId, onQueueLoaded, queueOpen]);

  return { pendingClaims: result?.candidateId === candidateId ? result.count : "loading" as const, onQueueLoaded };
}
