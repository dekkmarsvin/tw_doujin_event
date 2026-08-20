import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).getMyOverride(context.request, firstParam(context.params.circleId)));

export const onRequestPut: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).putOverride(context.request, firstParam(context.params.circleId)));

/** Deletes the row. Distinct from clearing a field, which writes a tombstone. */
export const onRequestDelete: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).deleteMyOverride(context.request, firstParam(context.params.circleId)));
