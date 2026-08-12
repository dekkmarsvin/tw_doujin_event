import { firstParam, guard, portalHandlers } from "../../../_portal";

/**
 * The public overlay of circle-authored content.
 *
 * Deliberately served from `/data/events/`, not `/api/`: the reader's service
 * worker already treats that namespace as stale-while-revalidate, so this is
 * offline-capable with no client change, and the reader never authenticates to
 * fetch it.
 */
export const onRequestGet: PagesFunction<PortalEnv, "eventId"> = (context) =>
  guard(() => portalHandlers(context).publicOverrides(context.request, firstParam(context.params.eventId)));

/**
 * Pages routes HEAD separately from GET, so without this a cache or proxy
 * probing the overlay would see a 404 for a resource that GETs fine. Same
 * headers, no body.
 */
export const onRequestHead: PagesFunction<PortalEnv, "eventId"> = (context) =>
  guard(async () => {
    const response = await portalHandlers(context).publicOverrides(context.request, firstParam(context.params.eventId));
    return new Response(null, { status: response.status, headers: response.headers });
  });
