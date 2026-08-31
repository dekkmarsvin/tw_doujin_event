import { firstParam, guard, portalHandlers } from "../../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId" | "draftId"> = (context) =>
  guard(() => portalHandlers(context).getOrganizerMap(
    context.request, firstParam(context.params.candidateId), firstParam(context.params.draftId),
  ));

export const onRequestPatch: PagesFunction<PortalEnv, "candidateId" | "draftId"> = (context) =>
  guard(() => portalHandlers(context).updateOrganizerMap(
    context.request, firstParam(context.params.candidateId), firstParam(context.params.draftId),
  ));
