import type { IdentityRepository } from "../db/identity-repository";
import { createOrganizerPublicationExecutor, QUEUED_PUBLICATION_TIMEOUT_MS, type PublicationDriver } from "./organizer-publication";
import { GITHUB_PUBLICATION_OWNER, GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";

export const PUBLICATION_CRON = "* * * * *";
export const PUBLICATION_RETRY_BASE_MS = 60_000;
export const PUBLICATION_RETRY_MAX_MS = 5 * 60_000;

export function createScheduledPublicationDispatcher(repository: IdentityRepository, driver: PublicationDriver, now = Date.now) {
  // Schedule and checkpoint are committed together under the executor lease.
  return createOrganizerPublicationExecutor(repository, driver, now,
    (attempt) => Math.min(PUBLICATION_RETRY_BASE_MS * 2 ** (attempt - 1), PUBLICATION_RETRY_MAX_MS));
}

/** Each due job gets one transition; external waits are persisted, not polled. */
export async function runPublicationTick(input: { repository: IdentityRepository; driver: PublicationDriver; now?: () => number }) {
  const now = input.now ?? Date.now;
  const { expired } = await input.repository.expireStalledOrganizerPublicationJobs({ now: now(), timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS });
  const due = await input.repository.listDueOrganizerPublicationJobs(now());
  const dispatch = createScheduledPublicationDispatcher(input.repository, input.driver, now);
  const results: Array<{ jobId: string; result: string }> = [];
  for (const job of due) {
    try { results.push({ jobId: job.id, result: await dispatch(job.id) }); }
    catch { results.push({ jobId: job.id, result: "delivery_failed" }); }
  }
  return { expired, results };
}

/** GitHub delivery only wakes matching pinned work. Cron also finds jobs whose
 * matching webhook arrived before the checkpoint, or never arrived at all. */
export function createPublicationWebhookDelivery(repository: IdentityRepository, now = Date.now) {
  return async (delivery: { deliveryId: string; event: string; payload: unknown }) => {
    const payload = delivery.payload as {
      repository?: { full_name?: string }; check_run?: { head_sha?: string }; check_suite?: { head_sha?: string };
      pull_request?: { head?: { sha?: string } }; workflow_run?: { head_sha?: string };
    } | null;
    const repositoryName = payload?.repository?.full_name;
    const index = GITHUB_PUBLICATION_REPOSITORIES.findIndex((name) => repositoryName === `${GITHUB_PUBLICATION_OWNER}/${name}`);
    if (index < 0) return;
    const sha = delivery.event === "check_run" ? payload?.check_run?.head_sha
      : delivery.event === "check_suite" ? payload?.check_suite?.head_sha
        : delivery.event === "pull_request" ? payload?.pull_request?.head?.sha
          : delivery.event === "workflow_run" ? payload?.workflow_run?.head_sha : undefined;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return;
    await repository.wakeOrganizerPublications({ deliveryId: delivery.deliveryId, stage: index === 0 ? "data" : "main", sha, now: now() });
  };
}
