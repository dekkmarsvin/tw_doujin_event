import { isCircleCatalogPayload, type CircleCatalogPayload } from "./circle-records";

function endpoint(eventId: string) {
  return `/data/events/${encodeURIComponent(eventId)}/circles.json`;
}

export async function loadStaticCircleCatalog(eventId: string): Promise<CircleCatalogPayload> {
  const response = await fetch(endpoint(eventId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`讀取社團資料失敗（${response.status}）。`);

  const payload: unknown = await response.json();
  if (!isCircleCatalogPayload(payload)) throw new Error("靜態社團資料格式無效。");
  return payload;
}
