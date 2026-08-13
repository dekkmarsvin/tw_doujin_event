import { firstParam, guard, portalHandlers } from "../../../_portal";

/**
 * Render a draft through the reader's own projection. Read-only: nothing is
 * stored, so a circle can look before committing to an edit that goes live
 * immediately.
 */
export const onRequestPost: PagesFunction<PortalEnv, "circleId"> = (context) =>
  guard(() => portalHandlers(context).previewOverride(context.request, firstParam(context.params.circleId)));
