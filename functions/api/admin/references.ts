import { guard, portalHandlers } from '../../_portal';
export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).adminListReferences(context.request));
export const onRequestPost: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).adminCreateReference(context.request));
