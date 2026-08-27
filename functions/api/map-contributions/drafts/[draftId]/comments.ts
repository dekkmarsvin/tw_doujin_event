import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "draftId"> = (context) =>
  guard(() => portalHandlers(context).postMapDraftComment(context.request, firstParam(context.params.draftId)));
