import { guard, portalHandlers } from "../../_portal";

// `?circle=` searches accounts by claimed circle name; `?email=` reads one account.
export const onRequestGet: PagesFunction<PortalEnv> = (context) =>
  guard(() => new URL(context.request.url).searchParams.has("circle")
    ? portalHandlers(context).adminSearchAccountsByCircle(context.request)
    : portalHandlers(context).adminAccountDetail(context.request));

export const onRequestPost: PagesFunction<PortalEnv> = (context) =>
  guard(() => portalHandlers(context).adminDisableAccount(context.request));
