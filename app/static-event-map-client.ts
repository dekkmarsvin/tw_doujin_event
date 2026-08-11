import { isPublishedEventMap, type PublishedEventMap } from "./event-map";

function endpoint(eventId: string) {
  return `/data/events/${encodeURIComponent(eventId)}/map.json`;
}

export async function loadStaticEventMap(eventId: string): Promise<PublishedEventMap> {
  const response = await fetch(endpoint(eventId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取活動地圖失敗（${response.status}）。`);

  const map: unknown = await response.json();
  if (!isPublishedEventMap(map)) throw new Error("靜態活動地圖格式無效。");
  return map;
}
