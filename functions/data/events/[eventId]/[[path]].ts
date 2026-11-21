import { eventFileResponse, eventIndexResponse } from "../../../_event-data";

/**
 * Every published event file at the path readers already use, and the event
 * index at `/data/events/index.json` (Pages routes that here too, as an
 * `eventId` with no path). The overlay at `overrides.json` has its own route.
 */
export const onRequestGet: PagesFunction<PortalEnv, "eventId" | "path"> = ({ env, request, params }) => {
  const eventId = String(params.eventId);
  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path ?? "");
  if (eventId === "index.json" && path === "") return eventIndexResponse(env, request);
  return eventFileResponse(env, request, eventId, path);
};
export const onRequestHead = onRequestGet;
