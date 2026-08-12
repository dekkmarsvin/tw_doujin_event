import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminListClaims(context.request));

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminDecideClaim(context.request));
