import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "claimId"> = (context) =>
  guard(() => portalHandlers(context).runChallenge(context.request, firstParam(context.params.claimId)));
