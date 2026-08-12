"use client";

import { useEffect, useSyncExternalStore } from "react";
import { failCircleCatalog, getCircleCatalogState, setCircleCatalog, setCircleOverrides, subscribeCircleCatalog } from "./circle-records";
import { loadStaticCircleCatalog } from "./static-circle-catalog-client";
import { loadStaticCircleOverrides } from "./static-circle-overrides-client";

let started = false;

/**
 * Read the shared catalog and start its one-time fetch. The store lives outside
 * React so non-component callers (planning migration, transfer) see the same
 * snapshot, while every mounted surface re-renders when it arrives.
 *
 * The reviewed base snapshot paints first; circle-authored content is layered
 * on afterwards and its failure is non-fatal. An offline first load, a 500, or
 * an expired Access session therefore degrades to the full base catalog rather
 * than to an error state.
 */
export function useCircleCatalog(eventId: string) {
  useEffect(() => {
    if (started) return;
    started = true;
    void loadStaticCircleCatalog(eventId)
      .then(async (payload) => {
        setCircleCatalog(payload);
        const overrides = await loadStaticCircleOverrides(eventId).catch(() => undefined);
        if (overrides) setCircleOverrides(overrides);
      })
      .catch((error) => failCircleCatalog(error instanceof Error ? error.message : "讀取社團資料失敗。"));
  }, [eventId]);

  return useSyncExternalStore(subscribeCircleCatalog, getCircleCatalogState, getCircleCatalogState);
}
