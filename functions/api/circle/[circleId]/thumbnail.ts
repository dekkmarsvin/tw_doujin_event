import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).readThumbnail(context.request, firstParam(context.params.circleId)), true);

export const onRequestPost: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).uploadThumbnail(context.request, firstParam(context.params.circleId)), true);
