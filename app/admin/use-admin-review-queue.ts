import { useCallback, useEffect, useRef, useState } from "react";
import { listReviewQueue, type ReviewQueue } from "../circle-editor-client";

type QueueState = {
  key: string;
  queue: ReviewQueue | null;
  loading: boolean;
  loadError: string;
  updatedAt: number | null;
};

/** One mounted overview or claims panel owns the visible queue refresh. */
export function useAdminReviewQueue({ eventId = "", claimId, load, onQueueLoaded, isBusy }: {
  eventId?: string;
  claimId?: string;
  load?: () => Promise<ReviewQueue>;
  onQueueLoaded?: (queue: ReviewQueue | null) => void;
  isBusy?: () => boolean;
} = {}) {
  const key = `${eventId}\u0000${claimId ?? ""}`;
  const [state, setState] = useState<QueueState>(() => ({ key, queue: null, loading: true, loadError: "", updatedAt: null }));
  const requests = useRef(0);
  const invalidate = useCallback(() => { ++requests.current; }, []);
  const refresh = useCallback((announce = true) => {
    if (isBusy?.()) return;
    const request = ++requests.current;
    if (announce) setState(current => current.key === key ? { ...current, loading: true }
      : { key, queue: null, loading: true, loadError: "", updatedAt: null });
    void (load ? load() : listReviewQueue(eventId, claimId)).then(queue => {
      if (request !== requests.current) return;
      setState({ key, queue, loading: false, loadError: "", updatedAt: Date.now() });
      onQueueLoaded?.(queue);
    }).catch((error: unknown) => {
      if (request !== requests.current) return;
      setState(current => ({ ...(current.key === key ? current : { key, queue: null, updatedAt: null }), loading: false,
        loadError: error instanceof Error ? error.message : "無法取得待審工作，請稍後再試。" }));
      onQueueLoaded?.(null);
    });
  }, [claimId, eventId, isBusy, key, load, onQueueLoaded]);

  useEffect(() => {
    const initial = window.setTimeout(() => refresh(true), 0);
    const refreshVisible = () => { if (document.visibilityState === "visible") refresh(false); };
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      invalidate();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [invalidate, refresh]);

  return {
    ...(state.key === key ? state : { queue: null, loading: true, loadError: "", updatedAt: null }),
    refresh,
    invalidate,
  };
}
