import type { IdentityRepository } from "../db/identity-repository";
import { accountNotificationLetter } from "./account-notifications";
import { MailDeliveryError, type PortalMail } from "./portal-mail";
import { reviewDigest, type ReviewKind } from "./review-notifications";

/**
 * Sends what the outbox holds, one email per notice (#546). Pages runs this
 * after each write request, so a notice leaves within that request's lifetime
 * and a failed send is tried again by a later one.
 */
export async function deliverNotifications(input: {
  repository: IdentityRepository;
  origin: string;
  sendMail: (message: PortalMail) => Promise<string>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const results: Array<{ id: string; result: "accepted" | "failed" | "retry" }> = [];
  for (const item of await input.repository.claimDueNotifications(now())) {
    try {
      const letter = item.kind === "review.pending"
        ? reviewDigest(input.origin, [{ kind: item.detail as ReviewKind, event_id: item.event_id, total: 1 }], item.occurred_at)
        : accountNotificationLetter(input.origin, [item], item.locale ?? "zh-Hant");
      await input.sendMail({ purpose: "account_notification", to: item.to, ...letter });
      await input.repository.finishNotification(item, "accepted", now());
      results.push({ id: item.id, result: "accepted" });
    } catch (error) {
      const code = error instanceof MailDeliveryError ? error.code : "delivery_unknown";
      // A configuration or recipient refusal will fail the same way next time.
      const permanent = code === "Missing Mailgun configuration." || code === "preview_recipient_denied" || /^mailgun_4(?!08|29)\d\d$/.test(code);
      if (permanent) await input.repository.finishNotification(item, "failed", now());
      else await input.repository.retryNotification(item, now());
      console.log(JSON.stringify({ event: "notification.delivery_failed", id: item.id, kind: item.kind, errorCode: code, permanent }));
      results.push({ id: item.id, result: permanent ? "failed" : "retry" });
    }
  }
  return results;
}
