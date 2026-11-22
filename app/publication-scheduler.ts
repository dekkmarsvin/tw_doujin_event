import type { IdentityRepository } from "../db/identity-repository";
import { createOrganizerPublicationExecutor, QUEUED_PUBLICATION_TIMEOUT_MS, type PublicationDriver } from "./organizer-publication";

export const PUBLICATION_CRON = "* * * * *";
export const PUBLICATION_RETRY_BASE_MS = 60_000;
export const PUBLICATION_RETRY_MAX_MS = 5 * 60_000;
export const PUBLICATION_TICK_MAX_TRANSITIONS = 16;
export const PUBLICATION_JOB_MAX_TRANSITIONS = 8;
export const PUBLICATION_TICK_START_BUDGET_MS = 20_000;

export function createScheduledPublicationDispatcher(repository: IdentityRepository, driver: PublicationDriver, now = Date.now) {
  // Schedule and checkpoint are committed together under the executor lease.
  return createOrganizerPublicationExecutor(repository, driver, now,
    (attempt, reason) => reason === "deployment_metadata" ? PUBLICATION_RETRY_BASE_MS
      : Math.min(PUBLICATION_RETRY_BASE_MS * 2 ** (attempt - 1), PUBLICATION_RETRY_MAX_MS));
}

/** Continue only durable progress. Never poll pending work inside an invocation.
 * The time budget stops admitting transitions; an admitted transition retains
 * its existing lease/remote-call bounds and must finish its checkpoint. */
export async function runPublicationTick(input: { repository: IdentityRepository; driver: PublicationDriver; now?: () => number }) {
  if (!(await input.repository.getSiteSettings())?.publicationEnabled) return { expired: [], results: [] };
  const now = input.now ?? Date.now;
  const deadline = now() + PUBLICATION_TICK_START_BUDGET_MS;
  const { expired } = await input.repository.expireStalledOrganizerPublicationJobs({ now: now(), timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS });
  const due = await input.repository.listDueOrganizerPublicationJobs(now());
  const dispatch = createScheduledPublicationDispatcher(input.repository, input.driver, now);
  const results: Array<{ jobId: string; result: string; transitions: number; elapsedMs: number }> = [];
  let totalTransitions = 0;
  const canStart = () => totalTransitions < PUBLICATION_TICK_MAX_TRANSITIONS && now() < deadline;
  for (const job of due) {
    if (!canStart()) break;
    const startedAt = now();
    let result = "skipped";
    let transitions = 0;
    try {
      while (canStart() && transitions < PUBLICATION_JOB_MAX_TRANSITIONS) {
        if (!(await input.repository.getSiteSettings())?.publicationEnabled) break;
        transitions++; totalTransitions++;
        result = await dispatch(job.id);
        if (result !== "advanced") break;
        const current = await input.repository.getOrganizerPublicationJob(job.id);
        if (!current || current.status !== "publishing" || (current.next_attempt_at ?? 0) > now()) break;
      }
    } catch { result = "delivery_failed"; }
    results.push({ jobId: job.id, result, transitions, elapsedMs: now() - startedAt });
  }
  return { expired, results };
}
