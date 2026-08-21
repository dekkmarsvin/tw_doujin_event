/**
 * The scheduled purge: expired credentials, and circle content whose retention
 * deadline has passed.
 *
 * A Worker of its own rather than a Pages Function: Cron Triggers exist on
 * Workers and not on Pages, and an opportunistic purge riding on user requests
 * would make retention a function of traffic — in a month with no logins the
 * expired credentials, the things most worth deleting, would simply stay
 * (ADR-0022).
 *
 * Not to be confused with `worker/index.ts`, which serves the map-authoring
 * editor. This one has no fetch handler and answers no requests.
 */
import { purgeExpiredRecords, RETENTION_WINDOWS } from "../../db/retention-purge";

export default {
  async scheduled(controller: ScheduledController, env: RetentionEnv) {
    // The scheduled time, not the wall clock: a firing delayed by a minute
    // should still delete against the window it was scheduled for.
    const summary = await purgeExpiredRecords(env.DB, controller.scheduledTime, RETENTION_WINDOWS, env.THUMBNAILS);
    // Also in `audit_log`; this copy is for `wrangler tail` during a deploy.
    console.log(JSON.stringify({ event: "retention.purged", cron: controller.cron, ...summary }));
  },
};
