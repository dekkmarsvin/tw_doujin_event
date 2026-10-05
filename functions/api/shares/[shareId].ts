import { firstParam, guard } from "../../_portal";
import { planningShareHandlers } from "../../_planning-shares";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => planningShareHandlers(context).get(firstParam(context.params.shareId)), true);
