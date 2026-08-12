import { guard, portalHandlers } from "../../_portal";

/**
 * Static route, so it wins over the sibling `[circleId]` directory.
 * Session-gated: the reader's catalog stays private while circles can still
 * find themselves to claim.
 */
export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).searchCatalog(context.request));
