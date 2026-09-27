import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).uploadCatalogImage(context.request, firstParam(context.params.circleId)));
