import { isPublishedEventMap, type PublishedEventMap } from "./event-map";
import { parseEventMapManifest } from "./event-map-manifest";

function eventDataEndpoint(eventId: string, relativePath: string) {
  return `/data/events/${encodeURIComponent(eventId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function readMap(eventId: string, relativePath: string) {
  const response = await fetch(eventDataEndpoint(eventId, relativePath), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取活動地圖失敗（${response.status}）。`);

  const map: unknown = await response.json();
  if (!isPublishedEventMap(map)) throw new Error("靜態活動地圖格式無效。");
  if (map.eventId !== eventId) throw new Error("靜態活動地圖 eventId 不相符。");
  return map;
}

export async function loadStaticEventMap(eventId: string, scope?: { periodKey: string; venueSpaceId: string }): Promise<PublishedEventMap> {
  if (!scope) return readMap(eventId, "map.json");
  const manifestResponse = await fetch(eventDataEndpoint(eventId, "map-manifest.json"), {
    headers: { accept: "application/json" },
  });
  if (!manifestResponse.ok) throw new Error(`讀取活動地圖索引失敗（${manifestResponse.status}）。`);
  const manifest = parseEventMapManifest(await manifestResponse.json(), eventId);
  const entry = manifest.maps.find((map) => map.periodKey === scope.periodKey && map.venueSpaceId === scope.venueSpaceId);
  if (!entry) throw new Error("找不到目前活動日與場地空間的地圖。");
  return readMap(eventId, entry.path);
}
