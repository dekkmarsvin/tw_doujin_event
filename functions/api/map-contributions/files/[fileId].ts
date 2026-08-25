import { firstParam, guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv, "fileId"> = (context) =>
  guard(() => portalHandlers(context).readMapDraftFile(context.request, firstParam(context.params.fileId), false));
