import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).validateOrganizerCandidate(context.request, firstParam(context.params.candidateId)));

