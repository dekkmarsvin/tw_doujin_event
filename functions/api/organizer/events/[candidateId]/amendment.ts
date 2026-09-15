import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).getOrganizerAmendment(context.request, firstParam(context.params.candidateId)));

export const onRequestPut: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).saveOrganizerAmendment(context.request, firstParam(context.params.candidateId)));
