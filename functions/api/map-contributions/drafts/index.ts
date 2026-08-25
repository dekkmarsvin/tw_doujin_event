import { guard, portalHandlers } from "../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).listMyMapDrafts(context.request));

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).createMapDraft(context.request));
