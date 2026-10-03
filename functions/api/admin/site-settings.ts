import { guard, portalHandlers } from "../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context => guard(() => portalHandlers(context).adminGetSiteSettings(context.request));
export const onRequestPut: PagesFunction<PortalEnv> = context => guard(() => portalHandlers(context).adminUpdateSiteSettings(context.request));
