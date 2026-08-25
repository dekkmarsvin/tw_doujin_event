import { guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminListMapDrafts(context.request));
