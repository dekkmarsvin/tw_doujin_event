import { firstParam, guard, portalHandlers } from "../../_portal";

export const onRequestDelete: PagesFunction<PortalEnv, "claimId"> = (context) =>
  guard(() => portalHandlers(context).withdrawClaim(context.request, firstParam(context.params.claimId)));
