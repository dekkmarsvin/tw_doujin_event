import { guard, portalHandlers } from "../../_portal";

/** One-time cutover endpoint. Fresh-admin auth and an explicit confirm are required. */
export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminMigrateCircleIds(context.request));
