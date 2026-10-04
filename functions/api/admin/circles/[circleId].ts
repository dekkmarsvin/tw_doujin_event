import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).adminCircleDetail(context.request, firstParam(context.params.circleId)));
