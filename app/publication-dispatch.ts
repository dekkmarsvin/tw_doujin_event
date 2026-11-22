import type { IdentityRepository } from "../db/identity-repository";
import { createOrganizerPublicationExecutor, type PublicationDriver, type PublicationMetadata } from "./organizer-publication";
import { publishApprovedSnapshot } from "./event-data-publisher";
import { readEventIndexObject, type EventDataBucket } from "./event-data-store";

/** The checkpoints the shared executor requires after each Git-era step. */
const PLACEHOLDER_CHECKPOINTS: Record<string, PublicationMetadata> = {
  preparing_data: { data_pr_number: 1, data_head_sha: "a".repeat(40) },
  merging_data: { data_merge_sha: "b".repeat(40) },
  preparing_main: { main_pr_number: 2, main_head_sha: "c".repeat(40) },
  merging_main: { main_merge_sha: "d".repeat(40) },
  waiting_deployment: { workflow_run_id: 3 },
};

/** Preview-only driver: it never contacts GitHub or certifies a public origin. */
export function createFakePublicationDriver(eventExists: PublicationDriver["eventExists"]): PublicationDriver {
  return { eventExists, async run({ step }) {
    return { metadata: PLACEHOLDER_CHECKPOINTS[step], productionVerified: step === "verifying_production" };
  } };
}

/**
 * Publishes to the event data bucket (#546). The whole publication happens in
 * the first step; the remaining steps only satisfy the shared executor, which
 * #546 phase 4b removes together with the Git pipeline.
 */
export function createR2PublicationDriver(bucket: EventDataBucket): PublicationDriver {
  return {
    async eventExists(eventId) {
      return (await readEventIndexObject(bucket))?.index.events.some((entry) => entry.eventId === eventId) ?? false;
    },
    async run({ job, step, snapshotJson, beginRemoteWrite }) {
      if (step === "preparing_data") {
        await beginRemoteWrite();
        await publishApprovedSnapshot(bucket, { snapshotJson, approvalHash: job.approval_hash, candidateId: job.candidate_id, candidateVersion: job.candidate_version });
      }
      return { metadata: PLACEHOLDER_CHECKPOINTS[step], productionVerified: step === "verifying_production" };
    },
  };
}

export function createPublicationDispatcher(input: {
  repository: IdentityRepository; mode: string; allowFake: boolean;
  eventExists: PublicationDriver["eventExists"]; now?: () => number;
  /** Required for `r2`, which publishes within the approving request. */
  eventData?: EventDataBucket;
}) {
  if (input.mode === "r2" && input.eventData) return runToCompletion(input.repository, createR2PublicationDriver(input.eventData), input.now);
  if (input.mode !== "github" && !(input.mode === "fake" && input.allowFake)) return undefined;
  if (input.mode === "github") {
    // Approval/retry already committed a due job. Only the independent Worker
    // executes it, so a Pages runtime defect cannot consume a requested retry
    // before a repaired Worker can resume the pinned publication.
    return async () => {};
  }
  return runToCompletion(input.repository, createFakePublicationDriver(input.eventExists), input.now);
}

/** Neither fake nor R2 waits on anything external, so all eight transitions run in the request. */
function runToCompletion(repository: IdentityRepository, driver: PublicationDriver, now?: () => number) {
  const execute = createOrganizerPublicationExecutor(repository, driver, now);
  return async (jobId: string) => {
    for (let index = 0; index < 8; index++) {
      await execute(jobId);
      const job = await repository.getOrganizerPublicationJob(jobId);
      if (!job || job.status === "failed" || job.status === "published") break;
    }
  };
}
