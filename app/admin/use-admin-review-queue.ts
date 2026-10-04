import { useCallback, useEffect, useRef, useState } from "react";
import { listReviewQueue, type ReviewQueue } from "../circle-editor-client";
import { useVisibleRefresh } from "./use-visible-refresh";

type QueueState = {
  key: string;
  queue: ReviewQueue | null;
  loading: boolean;
  loadError: string;
  updatedAt: number | null;
};

/** How often a visible admin panel re-reads what it shows. */
export const ADMIN_REFRESH_INTERVAL = 30_000;

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
    return () => { invalidate(); window.clearTimeout(initial); };
  }, [invalidate, refresh]);
  useVisibleRefresh(() => refresh(false), ADMIN_REFRESH_INTERVAL);

  return {
    ...(state.key === key ? state : { queue: null, loading: true, loadError: "", updatedAt: null }),
    refresh,
    invalidate,
  };
}
