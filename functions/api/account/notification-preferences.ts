import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).getAccountNotificationPreferences(context.request));

export const onRequestPut: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).saveAccountNotificationPreferences(context.request));
