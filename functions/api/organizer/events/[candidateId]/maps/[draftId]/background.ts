import { firstParam, guard, portalHandlers } from "../../../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "candidateId" | "draftId"> = (context) =>
  guard(() => portalHandlers(context).getOrganizerMapBackground(
    context.request, firstParam(context.params.candidateId), firstParam(context.params.draftId),
  ));

export const onRequestPut: PagesFunction<PortalEnv, "candidateId" | "draftId"> = (context) =>
  guard(() => portalHandlers(context).putOrganizerMapBackground(
    context.request, firstParam(context.params.candidateId), firstParam(context.params.draftId),
  ));
