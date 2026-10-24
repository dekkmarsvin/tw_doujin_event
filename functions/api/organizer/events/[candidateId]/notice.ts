import { guard, portalHandlers } from "../../../../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).readOrganizerNotice(context.request, String(context.params.candidateId)));

export const onRequestPut: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).saveOrganizerNotice(context.request, String(context.params.candidateId)));

export const onRequestDelete: PagesFunction<PortalEnv> = context =>
  guard(() => portalHandlers(context).clearOrganizerNotice(context.request, String(context.params.candidateId)));
