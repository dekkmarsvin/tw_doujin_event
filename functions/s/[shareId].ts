import { firstParam, guard, sharesFor } from "../_portal";

export const onRequestGet: PagesFunction<PortalEnv> = context =>
  guard(() => sharesFor(context).page(context.request, firstParam(context.params.shareId)));
