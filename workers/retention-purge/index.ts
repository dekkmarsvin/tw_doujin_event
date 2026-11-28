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
 * The same Worker runs the hourly service check (#580) on a second cron. It
 * only reads, so it does not bring notification delivery back here.
 *
 * This Worker has no fetch handler and answers no requests.
 */
import { EmailMessage } from "cloudflare:email";
import { purgeExpiredRecords, RETENTION_WINDOWS } from "../../db/retention-purge";
import { ALERT_SENDER, alertMime, runScheduledServiceCheck, SERVICE_CHECK_CRON } from "../../db/scheduled-service-check";

export default {
  async scheduled(controller: ScheduledController, env: RetentionEnv) {
    if (controller.cron === SERVICE_CHECK_CRON) {
      const recipient = env.ALERT_RECIPIENT, binding = env.ALERT_EMAIL;
      const summary = await runScheduledServiceCheck({ db: env.DB, env, now: controller.scheduledTime,
        sendAlert: recipient && binding
          ? letter => binding.send(new EmailMessage(ALERT_SENDER, recipient, alertMime(letter, recipient, controller.scheduledTime)))
          : undefined });
      console.log(JSON.stringify({ event: "service_check.scheduled", cron: controller.cron, ...summary }));
      return;
    }
    // The scheduled time, not the wall clock: a firing delayed by a minute
    // should still delete against the window it was scheduled for.
    const summary = await purgeExpiredRecords(
      env.DB, controller.scheduledTime, RETENTION_WINDOWS, env.THUMBNAILS, env.MAP_CONTRIBUTIONS,
    );
    // Also in `audit_log`; this copy is for `wrangler tail` during a deploy.
    console.log(JSON.stringify({ event: "retention.purged", cron: controller.cron, ...summary }));
  },
};
