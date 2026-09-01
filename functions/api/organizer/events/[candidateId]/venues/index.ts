import { firstParam, guard, portalHandlers } from "../../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).listOrganizerVenues(
    context.request,
    firstParam(context.params.candidateId),
  ));

export const onRequestPost: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).createOrganizerVenue(
    context.request,
    firstParam(context.params.candidateId),
  ));
