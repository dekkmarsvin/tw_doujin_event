/**
 * Work that follows a write request, run after its response is sent (#546).
 * It replaces the scheduled publication-dispatch Worker: notices leave the
 * outbox and an admin's requested service check runs. Each part is
 * independent, and a failure is logged and left for the next write request.
 */
import { deliverNotifications } from "../app/notification-delivery";
import { runRequestedServiceCheck } from "../app/site-service-check";
import { sendPortalMail } from "../app/portal-mail";
import { repositoryFor } from "./_portal";

export async function afterWrite(env: PortalEnv, requestOrigin: string) {
  const repository = repositoryFor(env);
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
