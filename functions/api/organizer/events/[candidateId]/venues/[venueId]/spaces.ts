import { firstParam, guard, portalHandlers } from "../../../../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "candidateId" | "venueId"> = (context) =>
  guard(() => portalHandlers(context).createOrganizerVenueSpace(
    context.request,
    firstParam(context.params.candidateId),
    firstParam(context.params.venueId),
  ));
