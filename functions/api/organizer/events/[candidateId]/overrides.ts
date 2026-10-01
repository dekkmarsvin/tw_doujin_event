import { guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).organizerSearchTakedownCircles(context.request, String(context.params.candidateId)));

export const onRequestPost: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).organizerTakedown(context.request, String(context.params.candidateId)));
