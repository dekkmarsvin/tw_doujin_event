import type { IdentityRepository } from "../db/identity-repository";
import { sha256Hex } from "./portal-crypto";

export const PUBLICATION_STEPS = [
  "preparing_data", "waiting_data_checks", "merging_data", "preparing_main",
  "waiting_main_checks", "merging_main", "waiting_deployment", "verifying_production", "completed",
] as const;
export type PublicationStep = typeof PUBLICATION_STEPS[number];
export type PublicationJob = NonNullable<Awaited<ReturnType<IdentityRepository["getOrganizerPublicationJob"]>>>;
export type PublicationMetadata = Partial<Pick<PublicationJob,
  "data_pr_number" | "data_head_sha" | "data_merge_sha" | "main_pr_number" | "main_head_sha" | "main_merge_sha" | "workflow_run_id"
>>;

/**
 * Whether this publication has left any record of remote work. `preparing_data`
 * is the first step a new job can complete and `missing_checkpoint` refuses to
 * let it pass without `data_pr_number` and `data_head_sha`; every later step is
 * unreachable until then, `preparing_main` onwards additionally guarded by
 * `missing_data_commit`. So a job with none of these columns has reached
 * nothing — not every step declares a required checkpoint, but the only one a
 * created job can pass through does.
 *
 * A pending delivery also records metadata without advancing the step, so this
 * is "something ran", not "a stage completed". That is the distinction the
 * timeout wording needs: it separates a job nobody ever dispatched from one
 * whose remote work is already pinned and waiting.
 *
 * The step cannot answer this. Approval creates a job on `preparing_data` and
 * retry keeps the step it failed on, so one step name covers both a
 * publication that was never dispatched and one that stopped part-way.
 */
export function publicationHasStarted(job: PublicationMetadata & { remote_write_intent_at?: number | null }) {
  return Boolean(job.data_pr_number || job.data_head_sha || job.data_merge_sha
    || job.main_pr_number || job.main_head_sha || job.main_merge_sha || job.workflow_run_id
    || (job.remote_write_intent_at !== null && job.remote_write_intent_at !== undefined));
}

export class PublicationFailure extends Error {
  constructor(public code: string, message: string, public retryable: boolean) { super(message); }
}

/**
 * How long a job may stay `queued` before the wait itself is the failure.
 * Only dispatch moves a job out of `queued`, so one whose dispatch never
 * happened waits forever; past this bound it becomes an ordinary retryable
 * failure and the existing retry path takes it over. Waiting on CI is
 * `publishing`, never `queued`, so no in-flight step is affected. The value is
 * the contract's — `docs/contracts/organizer-workspace.md`, 發布邊界 — and
 * changing it changes that document too.
 */
export const QUEUED_PUBLICATION_TIMEOUT_MS = 15 * 60 * 1000;

/** A runtime adapter must reconcile remote effects by job/stage and pinned SHA
 * before creating anything. Returning pending never advances the durable step.
 * This seam is intentionally not a fake production GitHub implementation. */
export interface PublicationDriver {
  eventExists(eventId: string): Promise<boolean>;
  run(input: {
    job: PublicationJob; step: Exclude<PublicationStep, "completed">;
    snapshot: unknown; snapshotJson: string; idempotencyKey: string; assertLease: () => Promise<void>;
    /** Persist remote-write intent before the first mutating API call. */
    beginRemoteWrite: () => Promise<void>;
  }): Promise<{ pending?: boolean; metadata?: PublicationMetadata; productionVerified?: boolean }>;
}

/** One bounded transition per delivery; never wait for CI in a Pages request. */
export function createOrganizerPublicationExecutor(repository: IdentityRepository, driver: PublicationDriver, now = Date.now,
  pendingBackoff?: (attempt: number) => number) {
  return async (jobId: string) => {
    let job = await repository.getOrganizerPublicationJob(jobId);
    if (!job || job.status === "published" || job.status === "failed") return "skipped" as const;
    const lease = await repository.claimOrganizerPublicationLease({ jobId, now: now(), ttlMs: 30_000 });
    if (!lease.ok) return "skipped" as const;
    const assertLease = async () => {
      if (!await repository.hasOrganizerPublicationLease(jobId, lease.token, now())) {
        throw new PublicationFailure("lease_lost", "Publication lease expired.", true);
      }
    };
    try {
      job = await repository.getOrganizerPublicationJob(jobId);
      if (!job) return "skipped" as const;
      const candidate = await repository.getOrganizerCandidate(job.candidate_id);
      const snapshot = await repository.getOrganizerSubmissionSnapshot(job.candidate_id, job.candidate_version);
      if (!candidate || !snapshot || snapshot.id !== job.snapshot_id || snapshot.sha256 !== job.approval_hash
        || await sha256Hex(snapshot.snapshot_json) !== job.approval_hash
        || candidate.current_version !== job.candidate_version || !candidate.approved_at
        || !["approved", "publishing"].includes(candidate.status)) {
        throw new PublicationFailure("snapshot_mismatch", "Approved snapshot no longer matches the publication.", false);
      }
      const input = JSON.parse(snapshot.snapshot_json) as { eventId?: string; candidateId?: string; candidateVersion?: number };
      if (!input.eventId || input.candidateId !== job.candidate_id || input.candidateVersion !== job.candidate_version) {
        throw new PublicationFailure("snapshot_mismatch", "Snapshot identity does not match the publication.", false);
      }
      const step = job.step === "assemble" ? "preparing_data" : job.step;
      if (!(PUBLICATION_STEPS as readonly string[]).includes(step) || step === "completed") {
        throw new PublicationFailure("unknown_step", "Unknown publication step.", false);
      }
      if (step === "preparing_data" && await driver.eventExists(input.eventId)) {
        throw new PublicationFailure("event_id_collision", "CREATE cannot overwrite a published event.", false);
      }
      if (PUBLICATION_STEPS.indexOf(step as PublicationStep) >= 3 && !job.data_merge_sha) {
        throw new PublicationFailure("missing_data_commit", "Main publication requires the data merge commit.", false);
      }
      if (PUBLICATION_STEPS.indexOf(step as PublicationStep) >= 6 && !job.main_merge_sha) {
        throw new PublicationFailure("missing_main_commit", "Deployment requires the main merge commit.", false);
      }
      await assertLease();
      const beginRemoteWrite = async () => {
        await assertLease();
        if (!await repository.markOrganizerPublicationRemoteWriteIntent({ jobId, leaseToken: lease.token, now: now() })) {
          throw new PublicationFailure("remote_write_intent", "Publication remote-write intent could not be recorded.", true);
        }
      };
      const result = await driver.run({ job, snapshot: input, snapshotJson: snapshot.snapshot_json, step: step as Exclude<PublicationStep, "completed">,
        idempotencyKey: `${job.id}/${step}/${job.approval_hash}`, assertLease,
        beginRemoteWrite });
      await assertLease();
      const metadata = Object.fromEntries(Object.entries(result.metadata ?? {}).filter(([, value]) => value != null)) as PublicationMetadata;
      const checkpoint = { ...job, ...metadata };
      if (!result.pending) {
        const required = step === "preparing_data" ? [checkpoint.data_pr_number, checkpoint.data_head_sha]
          : step === "merging_data" ? [checkpoint.data_merge_sha]
            : step === "preparing_main" ? [checkpoint.main_pr_number, checkpoint.main_head_sha]
              : step === "merging_main" ? [checkpoint.main_merge_sha]
                : step === "waiting_deployment" ? [checkpoint.workflow_run_id] : [];
        if (required.some((value) => !value)) throw new PublicationFailure("missing_checkpoint", "Publication adapter did not supply the required checkpoint.", false);
      }
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== null && job[key as keyof PublicationMetadata] !== null && job[key as keyof PublicationMetadata] !== value) {
          throw new PublicationFailure("checkpoint_mismatch", "Pinned publication metadata changed.", false);
        }
      }
      if (step === "verifying_production" && !result.pending && result.productionVerified !== true) {
        throw new PublicationFailure("production_smoke_failed", "Pages production origin smoke has not passed.", true);
      }
      const next = result.pending ? step : PUBLICATION_STEPS[PUBLICATION_STEPS.indexOf(step as PublicationStep) + 1];
      const pendingAttempts = result.pending ? Math.min(job.pending_attempts + 1, 32) : 0;
      const completedAt = now();
      if (!await repository.updateOrganizerPublicationJob({ jobId, leaseToken: lease.token,
        expectedStep: job.step, nextStep: next, status: next === "completed" ? "published" : "publishing",
        metadata, productionVerified: result.productionVerified, now: completedAt,
        ...(pendingBackoff ? { pendingAttempts, nextAttemptAt: completedAt + (result.pending ? pendingBackoff(pendingAttempts) : 0) } : {}),
      })) throw new Error("Publication checkpoint conflict.");
      return result.pending ? "pending" as const : "advanced" as const;
    } catch (error) {
      const failure = error instanceof PublicationFailure ? error
        : new PublicationFailure("infrastructure_error", error instanceof Error ? error.message : String(error), true);
      if (job && !await repository.updateOrganizerPublicationJob({ jobId, leaseToken: lease.token,
        expectedStep: job.step, nextStep: job.step, status: "failed", error: failure.message,
        failureCode: failure.code, retryable: failure.retryable, now: now(),
        allowExpiredFailure: true })) {
        // A newer lease/step owns the job now. Do not overwrite it, but let the
        // dispatcher record this delivery as unprocessed rather than successful.
        throw failure;
      }
      return "failed" as const;
    } finally {
      await repository.releaseOrganizerPublicationLease(jobId, lease.token);
    }
  };
}
