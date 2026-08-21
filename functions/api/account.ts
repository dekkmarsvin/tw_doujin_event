import { guard, portalHandlers } from "../_portal";

export const onRequestDelete: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).deleteMyAccount(context.request));
