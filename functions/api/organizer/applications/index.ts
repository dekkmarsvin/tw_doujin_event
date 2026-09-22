import { guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).listEventApplications(context.request));

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).submitEventApplication(context.request));
