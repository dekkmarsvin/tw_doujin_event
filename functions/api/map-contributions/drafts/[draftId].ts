import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestPut: PagesFunction<PortalEnv, "draftId"> = (context) =>
  guard(() => portalHandlers(context).updateMapDraft(context.request, firstParam(context.params.draftId)));
