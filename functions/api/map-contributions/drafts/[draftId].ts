import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "draftId"> = (context) =>
  guard(() => portalHandlers(context).getMapDraft(context.request, firstParam(context.params.draftId)));

export const onRequestPut: PagesFunction<PortalEnv, "draftId"> = (context) =>
  guard(() => portalHandlers(context).updateMapDraft(context.request, firstParam(context.params.draftId)));
