import { firstParam, guard, portalHandlers } from "../../../../../_portal";

export const onRequestPost: PagesFunction<PortalEnv, "jobId"> = (context) =>
  guard(() => portalHandlers(context).adminRetryOrganizerPublication(
    context.request,
    firstParam(context.params.jobId),
  ));
