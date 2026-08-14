import { parseCircleOverridesPayload, type CircleOverridesPayload } from "./circle-overrides";
import type { PublicationResource } from "./catalog-publication";

function endpoint(eventId: string) {
  return `/data/events/${encodeURIComponent(eventId)}/overrides.json`;
}

/**
 * Read circle-authored content. The service worker gives the namespace the same
 * stale-while-revalidate offline strategy as static data, but freshness is not
 * the same: this Function response owns max-age=60 + a strong ETag.
 *
 * Deliberately anonymous — the request carries no session, so the response
 * stays edge-cacheable and the public read path never authenticates.
 */
export async function loadStaticCircleOverrides(eventId: string): Promise<PublicationResource<CircleOverridesPayload>> {
  const response = await fetch(endpoint(eventId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取社團補充資料失敗（${response.status}）。`);

  const payload = parseCircleOverridesPayload(await response.json());
  if (!payload) throw new Error("社團補充資料格式無效。");
  if (payload.eventId !== eventId) throw new Error(`社團補充資料屬於 ${payload.eventId}，不是要求的 ${eventId}。`);
  return { payload, cacheControl: response.headers.get("cache-control"), etag: response.headers.get("etag") };
}
