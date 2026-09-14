import type { IdentityRepository } from "../db/identity-repository";
import { createOrganizerPublicationExecutor, type PublicationDriver, type PublicationMetadata } from "./organizer-publication";

/** Preview-only driver: it never contacts GitHub or certifies a public origin. */
export function createFakePublicationDriver(eventExists: PublicationDriver["eventExists"]): PublicationDriver {
  return { eventExists, async run({ step }) {
    const checkpoints: Record<string, PublicationMetadata> = {
      preparing_data: { data_pr_number: 1, data_head_sha: "a".repeat(40) },
      merging_data: { data_merge_sha: "b".repeat(40) },
      preparing_main: { main_pr_number: 2, main_head_sha: "c".repeat(40) },
      merging_main: { main_merge_sha: "d".repeat(40) },
      waiting_deployment: { workflow_run_id: 3 },
    };
    return { metadata: checkpoints[step], productionVerified: step === "verifying_production" };
  } };
}

export function createPublicationDispatcher(input: {
  repository: IdentityRepository; mode: string; allowFake: boolean;
  github: () => PublicationDriver; eventExists: PublicationDriver["eventExists"]; now?: () => number;
}) {
  if (input.mode !== "github" && !(input.mode === "fake" && input.allowFake)) return undefined;
  const execute = createOrganizerPublicationExecutor(input.repository,
    input.mode === "fake" ? createFakePublicationDriver(input.eventExists) : input.github(), input.now);
  return async (jobId: string) => {
    // GitHub performs one bounded transition. #246 supplies durable deliveries;
    // fake has no external wait and completes all eight transitions in preview.
    const deliveries = input.mode === "fake" ? 8 : 1;
    for (let index = 0; index < deliveries; index++) {
      await execute(jobId);
      if (input.mode !== "fake") break;
      const job = await input.repository.getOrganizerPublicationJob(jobId);
      if (!job || job.status === "failed" || job.status === "published") break;
    }
  };
}
