import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).getOrganizerCandidate(context.request, firstParam(context.params.candidateId)));

export const onRequestPatch: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).updateOrganizerCandidate(context.request, firstParam(context.params.candidateId)));

