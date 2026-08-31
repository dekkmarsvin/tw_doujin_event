import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestPatch: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).updateOrganizerWorkspacePreference(
    context.request,
    firstParam(context.params.candidateId),
  ));
