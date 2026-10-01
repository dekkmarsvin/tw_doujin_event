import type { IdentityRepository } from "../db/identity-repository";
import { accountNotificationLetter } from "./account-notifications";
import { MailDeliveryError, type PortalMail } from "./portal-mail";

export async function runAccountNotificationTick(input: { repository: IdentityRepository; origin: string; sendMail: (message: PortalMail) => Promise<string>; now?: () => number }) {
  const now = input.now ?? Date.now;
  const results: Array<{ batchId: string; result: string }> = [];
  for (const due of await input.repository.listDueAccountNotifications(now())) {
    const batch = await input.repository.claimAccountNotificationBatch(due.account_id, due.lane, now());
    if (!batch) continue;
    try {
      if (now() - batch.first_attempt_at >= 48 * 3600000) {
        await input.repository.finishAccountNotificationBatch(batch, "failed", now(), null, "retry_expired");
        results.push({ batchId: batch.id, result: "failed" });
        continue;
      }
      const message = await input.repository.readAccountNotificationBatch(batch, now());
      if (!message) continue;
      if (!message.items.length || !message.to) {
        await input.repository.finishAccountNotificationBatch(batch, "cancelled", now());
        results.push({ batchId: batch.id, result: "cancelled" });
        continue;
      }
      const id = await input.sendMail({ purpose: "account_notification", to: message.to, ...accountNotificationLetter(input.origin, message.items) });
      await input.repository.finishAccountNotificationBatch(batch, "accepted", now(), id === "accepted" || id === "preview-sink" ? null : id);
      results.push({ batchId: batch.id, result: "accepted" });
    } catch (error) {
      const code = error instanceof MailDeliveryError ? error.code : "delivery_unknown";
      const permanent = code === "Missing Mailgun configuration." || code === "preview_recipient_denied" || /^mailgun_4(?!08|29)\d\d$/.test(code);
      await input.repository.failAccountNotificationBatch(batch, code === "Missing Mailgun configuration." ? "mail_configuration" : code, permanent, now());
      results.push({ batchId: batch.id, result: permanent ? "failed" : "retry" });
    }
  }
  return results;
}
