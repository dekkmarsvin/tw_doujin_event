import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestPut: PagesFunction<PortalEnv, "candidateId"> = (context) =>
  guard(() => portalHandlers(context).putOrganizerImport(context.request, firstParam(context.params.candidateId)));
