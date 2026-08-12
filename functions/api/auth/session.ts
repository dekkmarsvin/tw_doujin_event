import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).session(context.request));

export const onRequestDelete: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).signOut(context.request));
