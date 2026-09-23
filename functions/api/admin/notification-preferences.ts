import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).adminGetNotificationPreferences(context.request));

export const onRequestPut: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).adminSaveNotificationPreferences(context.request));
