"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createCatalogPublication } from "./catalog-publication";
import { loadStaticCircleCatalog } from "./static-circle-catalog-client";
import { loadStaticCircleOverrides } from "./static-circle-overrides-client";

/** Production-shaped HTTP adapter; tests inject the same two-port interface. */
const browserCatalogPublication = createCatalogPublication({
  loadBase: loadStaticCircleCatalog,
  loadOverlay: loadStaticCircleOverrides,
});

/**
 * Read one event's shared catalog and start that event's one-time publication
 * load. Base paints first; an unavailable overlay leaves the reviewed catalog
 * complete and records that freshness could not be confirmed.
 */
export function useCircleCatalog(eventId: string) {
  useEffect(() => { void browserCatalogPublication.load(eventId); }, [eventId]);
  const subscribe = useCallback((listener: () => void) => browserCatalogPublication.subscribe(eventId, listener), [eventId]);
  const snapshot = useCallback(() => browserCatalogPublication.getSnapshot(eventId), [eventId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
