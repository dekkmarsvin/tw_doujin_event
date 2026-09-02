import type { CircleOverridesPayload } from "./circle-overrides";
import {
  failCircleCatalog,
  failCircleOverlay,
  getCircleCatalogState,
  markCircleOverlayLoading,
  setCircleCatalog,
  setCircleOverrides,
  subscribeCircleCatalog,
  type CircleCatalogPayload,
} from "./circle-records";

export const DYNAMIC_OVERLAY_CACHE_POLICY = "public, max-age=60, must-revalidate";

export type PublicationResource<T> = {
  payload: T;
  cacheControl: string | null;
  etag: string | null;
};

type CatalogPublicationAdapter = {
  loadBase: (eventId: string) => Promise<PublicationResource<CircleCatalogPayload>>;
  loadOverlay: (eventId: string) => Promise<PublicationResource<CircleOverridesPayload>>;
};

export function createCatalogPublication(adapter: CatalogPublicationAdapter) {
  const inFlight = new Map<string, Promise<void>>();
  const cacheMetadata = new Map<string, { base?: Omit<PublicationResource<unknown>, "payload">; overlay?: Omit<PublicationResource<unknown>, "payload"> }>();

  async function performLoad(eventId: string) {
    try {
      const base = await adapter.loadBase(eventId);
      if (base.payload.eventId !== eventId) throw new Error(`Catalog request ${eventId} received base ${base.payload.eventId}.`);
      setCircleCatalog(base.payload);
      cacheMetadata.set(eventId, { base: { cacheControl: base.cacheControl, etag: base.etag } });
      markCircleOverlayLoading(eventId);
      try {
        const overlay = await adapter.loadOverlay(eventId);
        if (overlay.payload.eventId !== eventId) throw new Error(`Catalog request ${eventId} received overlay ${overlay.payload.eventId}.`);
        setCircleOverrides(overlay.payload);
        cacheMetadata.set(eventId, { ...cacheMetadata.get(eventId), overlay: { cacheControl: overlay.cacheControl, etag: overlay.etag } });
      } catch (error) {
        failCircleOverlay(eventId, error instanceof Error ? error.message : "讀取社團補充資料失敗。");
      }
    } catch (error) {
      failCircleCatalog(eventId, error instanceof Error ? error.message : "讀取社團資料失敗。");
    }
  }

  function load(eventId: string, options: { retry?: boolean } = {}) {
    const pending = inFlight.get(eventId);
    if (pending) return pending;
    const current = getCircleCatalogState(eventId);
    if (!options.retry && current.status === "ready" && current.overlayStatus !== "idle") return Promise.resolve();
    const run = performLoad(eventId).finally(() => { inFlight.delete(eventId); });
    inFlight.set(eventId, run);
    return run;
  }

  return {
    load,
    retry: (eventId: string) => load(eventId, { retry: true }),
    getSnapshot: (eventId: string) => getCircleCatalogState(eventId),
    subscribe: (eventId: string, listener: () => void) => subscribeCircleCatalog(eventId, listener),
    getCacheMetadata: (eventId: string) => cacheMetadata.get(eventId) ?? {},
  };
}

