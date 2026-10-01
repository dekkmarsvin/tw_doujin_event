import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).organizerListClaims(context.request, firstParam(context.params.candidateId)));

export const onRequestPost: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).organizerDecideClaim(context.request, firstParam(context.params.candidateId)));
