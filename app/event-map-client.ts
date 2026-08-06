import { isPublishedEventMap, type EventMapLayout, type PublishedEventMap } from "./event-map";

function endpoint(eventId: string) {
  return `/api/events/${encodeURIComponent(eventId)}/map`;
}

export async function loadPublishedEventMap(eventId: string): Promise<PublishedEventMap | null> {
  const response = await fetch(endpoint(eventId), { headers: { accept: "application/json" }, cache: "no-store" });
  if (response.status === 404) return null;
  const payload = await response.json() as { map?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `讀取活動地圖失敗（${response.status}）。`);
  if (!isPublishedEventMap(payload.map)) throw new Error("伺服器回傳的活動地圖格式無效。" );
  return payload.map;
}

export async function publishEventMap(eventId: string, input: { sourceName: string; confidence: number; layout: EventMapLayout }): Promise<PublishedEventMap> {
  const response = await fetch(endpoint(eventId), {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as { map?: unknown; error?: string; details?: string[] };
  if (!response.ok) throw new Error(payload.details?.join("\n") || payload.error || `發布活動地圖失敗（${response.status}）。`);
  if (!isPublishedEventMap(payload.map)) throw new Error("伺服器回傳的發布結果格式無效。" );
  return payload.map;
}
