import { isCircleCatalogPayload, type CircleCatalogPayload } from "./circle-records";
import type { PublicationResource } from "./catalog-publication";

function endpoint(eventId: string) {
  return `/data/events/${encodeURIComponent(eventId)}/circles.json`;
}

export async function loadStaticCircleCatalog(eventId: string): Promise<PublicationResource<CircleCatalogPayload>> {
  const response = await fetch(endpoint(eventId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取社團資料失敗（${response.status}）。`);

  const payload: unknown = await response.json();
  if (!isCircleCatalogPayload(payload)) throw new Error("靜態社團資料格式無效。");
  if (payload.eventId !== eventId) throw new Error(`靜態社團資料屬於 ${payload.eventId}，不是要求的 ${eventId}。`);
  return { payload, cacheControl: response.headers.get("cache-control"), etag: response.headers.get("etag") };
}
