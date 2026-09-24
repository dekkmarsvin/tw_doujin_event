import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).getOrganizerEventImage(context.request, firstParam(context.params.candidateId)));

export const onRequestPut: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).putOrganizerEventImage(context.request, firstParam(context.params.candidateId)));
