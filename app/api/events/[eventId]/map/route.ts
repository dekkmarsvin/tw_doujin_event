import { getEventMap, publishEventMap } from "../../../../../db/event-maps";
import { createEventMapHandlers } from "../../../../event-map-route-handlers";

// TODO: 正式上線前在此 wrapper 驗證管理員角色，再把 PUT 意圖交給純 handler。
const handlers = createEventMapHandlers({ getEventMap, publishEventMap });

export const GET = handlers.GET;
export const PUT = handlers.PUT;
