import { guard, portalHandlers } from "../../_portal";

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminDisableAccount(context.request));
