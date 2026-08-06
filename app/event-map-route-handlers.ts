import { FF47_EVENT_ID, validateEventMapLayout, validateFF47EventMapLayout, type EventMapLayout } from "./event-map";
import type { EventMapRepository } from "../db/event-map-repository";

type RouteContext = { params: Promise<{ eventId: string }> };

function validEventId(eventId: string) {
  return /^[a-z0-9][a-z0-9_-]{1,63}$/i.test(eventId);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const unavailable = message.includes("binding `DB` is unavailable");
  return Response.json({ error: message }, { status: unavailable ? 503 : 500 });
}

export function createEventMapHandlers(repository: Pick<EventMapRepository, "getEventMap" | "publishEventMap">) {
  const GET = async (_request: Request, { params }: RouteContext) => {
    try {
      const { eventId } = await params;
      if (!validEventId(eventId)) return Response.json({ error: "eventId 格式無效。" }, { status: 400 });
      const map = await repository.getEventMap(eventId);
      if (!map) return Response.json({ error: "此活動尚未發布地圖。" }, { status: 404 });
      return Response.json({ map }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return errorResponse(error);
    }
  };

  const PUT = async (request: Request, { params }: RouteContext) => {
    // TODO: 正式上線前由 route wrapper 驗證管理員角色後才呼叫此 handler。
    try {
      const { eventId } = await params;
      if (!validEventId(eventId)) return Response.json({ error: "eventId 格式無效。" }, { status: 400 });
      const payload = await request.json() as { sourceName?: string; confidence?: number; layout?: EventMapLayout };
      const sourceName = payload.sourceName?.trim() ?? "";
      if (!sourceName) return Response.json({ error: "sourceName 是必填欄位。" }, { status: 400 });
      if (typeof payload.confidence !== "number" || payload.confidence < .85 || payload.confidence > 1) return Response.json({ error: "辨識信心必須介於 0.85 與 1 之間。" }, { status: 400 });
      const validation = eventId === FF47_EVENT_ID ? validateFF47EventMapLayout(payload.layout) : validateEventMapLayout(payload.layout);
      if (!validation.ok) return Response.json({ error: "地圖資料驗證失敗。", details: validation.errors }, { status: 400 });
      const map = await repository.publishEventMap({ eventId, sourceName, confidence: payload.confidence, layout: payload.layout as EventMapLayout });
      return Response.json({ map });
    } catch (error) {
      return errorResponse(error);
    }
  };

  return { GET, PUT };
}
