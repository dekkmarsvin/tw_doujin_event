import { guard, portalHandlers } from "../../_portal";

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).verify(context.request));
