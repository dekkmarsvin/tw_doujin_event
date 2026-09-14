import { createGitHubWebhookHandler } from "../../../../app/github-publication";
import { repositoryFor } from "../../../_portal";
import { createPublicationWebhookDelivery } from "../../../../app/publication-scheduler";

export const onRequestPost: PagesFunction<PortalEnv> = async (context) => {
  if (context.env.ORGANIZER_PUBLICATION_MODE !== "github") {
    return Response.json({ error: "GitHub publication is disabled." }, { status: 503 });
  }
  const secret = context.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "GitHub publication is not configured." }, { status: 503 });
  const repository = repositoryFor(context.env);
  return createGitHubWebhookHandler({
    secret, now: Date.now,
    recordDelivery: (delivery) => repository.recordGitHubWebhookDelivery(delivery),
    completeDelivery: (delivery) => repository.completeGitHubWebhookDelivery(delivery),
    onDelivery: createPublicationWebhookDelivery(repository),
  })(context.request);
};
