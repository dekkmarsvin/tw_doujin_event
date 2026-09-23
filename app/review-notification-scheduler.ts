import type { IdentityRepository } from "../db/identity-repository";
import { MailDeliveryError, type PortalMail } from "./portal-mail";
import { reviewDigest } from "./review-notifications";

export async function runReviewNotificationTick(input: {
  repository: IdentityRepository; origin: string; sendMail: (message: PortalMail) => Promise<string>; now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const results: Array<{ batchId?: string; result: string; errorCode?: string }> = [];
  for (const { recipient } of await input.repository.listDueNotificationRecipients(now())) {
    let batch: Awaited<ReturnType<IdentityRepository["claimNotificationBatch"]>> = null;
    try {
      batch = await input.repository.claimNotificationBatch(recipient, now());
      if (!batch) continue;
      const groups = await input.repository.readNotificationBatch(batch, now());
      if (groups === null) { await input.repository.releaseNotificationBatch(batch); continue; }
      if (groups.length === 0) {
        await input.repository.completeNotificationBatch(batch, null, now());
        results.push({ batchId: batch.id, result: "cancelled" });
        continue;
      }
      const providerId = await input.sendMail({ to: recipient, ...reviewDigest(input.origin, groups, now()) });
      await input.repository.completeNotificationBatch(batch, providerId, now());
      results.push({ batchId: batch.id, result: "accepted" });
    } catch (error) {
      const errorCode = error instanceof MailDeliveryError ? error.code : "delivery_failed";
      if (batch) await input.repository.failNotificationBatch(batch, errorCode, now()).catch(() => { /* Lease expiry recovers D1 failures. */ });
      results.push({ batchId: batch?.id, result: "retry", errorCode });
    }
  }
  return results;
}
