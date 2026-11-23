/**
 * Work that follows a write request, run after its response is sent (#546).
 * It replaces the scheduled publication-dispatch Worker: notices leave the
 * outbox, an admin's requested service check runs, and a publication whose
 * approving request stopped part-way is finished. Each part is independent,
 * and a failure is logged and left for the next write request.
 */
import { deliverNotifications } from "../app/notification-delivery";
import { createFakePublicationDriver, createR2PublicationDriver } from "../app/publication-dispatch";
import { runPublicationTick } from "../app/publication-scheduler";
import { runRequestedServiceCheck } from "../app/site-service-check";
import { sendPortalMail } from "../app/portal-mail";
import { repositoryFor } from "./_portal";

export async function afterWrite(env: PortalEnv, requestOrigin: string) {
  const repository = repositoryFor(env);
  // A publication finished here records its result notice; running it first
  // lets that notice leave in this same pass.
  try {
    const r2 = env.ORGANIZER_PUBLICATION_MODE === "r2";
    if (r2 || (env.ORGANIZER_PUBLICATION_MODE === "fake" && env.PREVIEW_MAIL_SINK === "d1")) {
      const driver = r2 ? createR2PublicationDriver(env.EVENT_DATA) : createFakePublicationDriver(async () => false);
      const summary = await runPublicationTick({ repository, driver });
      if (summary.expired.length || summary.results.length) console.log(JSON.stringify({ event: "publication.tick", ...summary }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "publication.tick_failed", message: error instanceof Error ? error.message : String(error) }));
  }
  const parts = [
    async () => {
      const origin = env.NOTIFICATION_ORIGIN || requestOrigin;
      const results = await deliverNotifications({ repository, origin,
        sendMail: message => sendPortalMail(env, message,
          mail => repository.storePreviewMail({ email: mail.to, subject: mail.subject, text: mail.text, now: Date.now() })) });
      if (results.length) console.log(JSON.stringify({ event: "notifications.delivered", results }));
    },
    () => runRequestedServiceCheck(repository, env),
  ];
  const names = ["notifications.delivery_failed", "service_check.failed"];
  const outcomes = await Promise.allSettled(parts.map(part => part()));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      console.error(JSON.stringify({ event: names[index], message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }));
    }
  });
}
