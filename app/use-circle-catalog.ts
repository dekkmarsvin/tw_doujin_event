"use client";

import { useEffect, useSyncExternalStore } from "react";
import { failCircleCatalog, getCircleCatalogState, setCircleCatalog, subscribeCircleCatalog } from "./circle-records";
import { loadStaticCircleCatalog } from "./static-circle-catalog-client";

let started = false;

/**
 * Read the shared catalog and start its one-time fetch. The store lives outside
 * React so non-component callers (planning migration, transfer) see the same
 * snapshot, while every mounted surface re-renders when it arrives.
 */
export function useCircleCatalog(eventId: string) {
  useEffect(() => {
    if (started) return;
    started = true;
    void loadStaticCircleCatalog(eventId)
      .then(setCircleCatalog)
      .catch((error) => failCircleCatalog(error instanceof Error ? error.message : "讀取社團資料失敗。"));
  }, [eventId]);

  return useSyncExternalStore(subscribeCircleCatalog, getCircleCatalogState, getCircleCatalogState);
}
