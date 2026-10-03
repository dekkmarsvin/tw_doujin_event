import { guard } from "../../_portal";
import { planningShareHandlers } from "../../_planning-shares";

export const onRequestPost: PagesFunction<PortalEnv> = context =>
  guard(() => planningShareHandlers(context).create(context.request));
