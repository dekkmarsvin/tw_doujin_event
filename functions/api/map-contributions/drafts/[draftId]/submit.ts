import { firstParam, guard, portalHandlers } from "../../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "draftId"> = (context) =>
  guard(() => portalHandlers(context).submitMapDraft(context.request, firstParam(context.params.draftId)));
