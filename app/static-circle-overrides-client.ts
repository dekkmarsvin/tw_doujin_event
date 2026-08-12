import { parseCircleOverridesPayload, type CircleOverridesPayload } from "./circle-overrides";

function endpoint(eventId: string) {
  return `/data/events/${encodeURIComponent(eventId)}/overrides.json`;
}

/**
 * Read circle-authored content. Served from the `/data/events/` namespace so it
 * inherits the service worker's stale-while-revalidate rule and the same cache
 * headers as the base snapshot — the overlay is offline-capable for free.
 *
 * Deliberately anonymous — the request carries no session, so the response
 * stays edge-cacheable and the public read path never authenticates.
 */
export async function loadStaticCircleOverrides(eventId: string): Promise<CircleOverridesPayload> {
  const response = await fetch(endpoint(eventId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取社團補充資料失敗（${response.status}）。`);

  const payload = parseCircleOverridesPayload(await response.json());
  if (!payload) throw new Error("社團補充資料格式無效。");
  return payload;
}
