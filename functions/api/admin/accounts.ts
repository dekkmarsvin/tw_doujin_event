import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminAccountDetail(context.request));

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminDisableAccount(context.request));
