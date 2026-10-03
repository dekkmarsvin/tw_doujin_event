import { runRequestedServiceCheck } from "../../app/site-service-check";
import { runAccountNotificationTick } from "../../app/account-notification-scheduler";
import { createIdentityRepository, type IdentityRepository } from "../../db/identity-repository";
import { runPublicationTick } from "../../app/publication-scheduler";
import { createRuntimePublicationDriver, readPublishedEventAtOrigin } from "../../app/publication-runtime";
import { createFakePublicationDriver } from "../../app/publication-dispatch";
import { runReviewNotificationTick } from "../../app/review-notification-scheduler";
import { sendPortalMail, type MailEnvironment } from "../../app/portal-mail";

type Env = MailEnvironment & Pick<PortalEnv, "DB" | "ORGANIZER_PUBLICATION_MODE" | "GITHUB_APP_ID" | "GITHUB_APP_INSTALLATION_ID" | "GITHUB_APP_PRIVATE_KEY" | "NOTIFICATION_ORIGIN">;

/**
 * One repository per isolate, not per tick — the same reason `repositoryFor`
 * exists in `functions/_portal.ts`. `ensureTables()` memoizes its bootstrap on
 * the instance, so a fresh repository each minute re-ran the whole thing: the
 * `CREATE TABLE IF NOT EXISTS` batch, all twenty-two `ADD COLUMN` migrations —
 * which necessarily fail with `duplicate column name` once the columns exist,
 * and cost ~150ms each in sequence — the index batch, and the venue catalog
 * seed. A warm isolate's trace showed 7.6s of that ahead of two SELECTs of
 * actual work.
 *
 * Keyed on the binding rather than held in a plain module variable so the
 * preview environment's separate D1 never reuses production's memo.
 */
const repositories = new WeakMap<D1Database, IdentityRepository>();

function repositoryFor(env: Env) {
  const database = env.DB;
  const existing = repositories.get(database);
  if (existing) return existing;
  // Only Pages seeds from its authoritative legacy configuration. A Worker arriving first waits for that row.
  const created = createIdentityRepository(database, { initializeSiteSettings: false });
  repositories.set(database, created);
  return created;
}

/** No HTTP entry point. This Worker shares only the environment's identity D1. */
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    const repository = repositoryFor(env);
    const settings = await repository.getSiteSettings();
    if (!settings) { console.warn(JSON.stringify({ event: "site_settings.uninitialized" })); return; }
    const outcomes = await Promise.allSettled([
      runRequestedServiceCheck(repository, env),
      (async () => {
        if (env.ORGANIZER_PUBLICATION_MODE !== "github" && !(env.ORGANIZER_PUBLICATION_MODE === "fake" && env.PREVIEW_MAIL_SINK === "d1")) return;
        const driver = env.ORGANIZER_PUBLICATION_MODE === "fake" ? createFakePublicationDriver(async () => false)
          : createRuntimePublicationDriver(env, readPublishedEventAtOrigin);
        const summary = await runPublicationTick({ repository: repositoryFor(env), driver });
        console.log(JSON.stringify({ event: "publication.tick", ...summary }));
      })(),
      (async () => {
        if (!settings.adminReviewNotificationsEnabled) return;
        const repository = repositoryFor(env);
        const results = await runReviewNotificationTick({ repository, origin: env.NOTIFICATION_ORIGIN ?? "",
          sendMail: message => sendPortalMail(env, message,
            mail => repository.storePreviewMail({ email: mail.to, subject: mail.subject, text: mail.text, now: Date.now() })) });
        if (results.length) console.log(JSON.stringify({ event: "review_notifications.tick", results }));
      })(),
      (async () => {
        if (!settings.accountNotificationsEnabled) return;
        const repository = repositoryFor(env);
        const results = await runAccountNotificationTick({ repository, origin: env.NOTIFICATION_ORIGIN ?? "",
          sendMail: message => sendPortalMail(env, message,
            mail => repository.storePreviewMail({ email: mail.to, subject: mail.subject, text: mail.text, now: Date.now() })) });
        if (results.length) console.log(JSON.stringify({ event: "account_notifications.tick", results }));
      })(),
    ]);
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") console.error(JSON.stringify({ event: ["service_check.failed", "publication.tick_failed", "review_notifications.tick_failed", "account_notifications.tick_failed"][index] }));
    });
  },
};
