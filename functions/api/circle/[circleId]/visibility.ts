import { firstParam, guard, portalHandlers } from "../../../_portal";

/** Whether this circle's own contributions stay public after the event ends. */
export const onRequestPost: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).setPostEventVisibility(context.request, firstParam(context.params.circleId)));
