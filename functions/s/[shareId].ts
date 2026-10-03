import { firstParam, guard } from "../_portal";
import { planningShareHandlers } from "../_planning-shares";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => planningShareHandlers(context).page(context.request, firstParam(context.params.shareId)));
