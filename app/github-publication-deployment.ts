import { createGitHubPublicationAdapter, type GitHubAdapterOptions, type GitHubWorkflowRun, type GitHubWorkflowJob } from "./github-publication";
import { PublicationFailure, type PublicationDriver } from "./organizer-publication";
import { GITHUB_PUBLICATION_OWNER, GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import { parsePublishedEvents } from "./published-events.mjs";
import { DEPLOYMENT_MANIFEST_PATH, PAGES_PRODUCTION_ORIGIN, verifyPublicationOrigin } from "./publication-origin";

export const PUBLICATION_WORKFLOW_ID = 331570396;
const repository = GITHUB_PUBLICATION_REPOSITORIES[1];
const workflowPath = ".github/workflows/deploy-pages.yml";
function fail(code: string, message: string, retryable = false): never { throw new PublicationFailure(code, message, retryable); }
function assertRun(run: GitHubWorkflowRun, sha: string, id?: number | null) {
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || (id && run.id !== id)
    || run.workflow_id !== PUBLICATION_WORKFLOW_ID || run.path !== workflowPath
    || run.head_sha !== sha || run.head_branch !== "main" || run.event !== "push"
    || run.repository?.full_name !== `${GITHUB_PUBLICATION_OWNER}/${repository}`
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
    || !["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(run.status)) {
    fail("publication_deployment_identity", "部署的 repository、workflow、版本或執行識別不符。");
  }
}
function deployJob(jobs: GitHubWorkflowJob[], run: GitHubWorkflowRun) {
  const matches = jobs.filter((job) => job.name === "Verify and deploy");
  if (!matches.length && run.status !== "completed") return null;
  if (matches.length !== 1) fail("publication_deployment_identity", "找不到唯一的正式部署工作。");
  const job = matches[0];
  if (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || !Array.isArray(job.steps)) {
    fail("publication_deployment_identity", "部署工作不是目前固定的 workflow attempt。");
  }
  return job;
}
function successfulStep(job: GitHubWorkflowJob, name: string) {
  const steps = job.steps.filter((step) => step.name === name);
  return steps.length === 1 && steps[0].status === "completed" && steps[0].conclusion === "success";
}

export function createGitHubPublicationDeployment(options: Omit<GitHubAdapterOptions, "owner" | "beforeWrite"> & {
  originFetch?: typeof globalThis.fetch;
}): Pick<PublicationDriver, "run"> {
  return { async run(input) {
    const sha = input.job.main_merge_sha;
    if (!sha || !input.job.data_merge_sha) fail("missing_main_commit", "部署需要已完成的 data 與 main commit。");
    const adapter = createGitHubPublicationAdapter({ ...options, owner: GITHUB_PUBLICATION_OWNER,
      beforeWrite: async () => {
        await input.beginRemoteWrite();
        // Rerun deploys the old checkout: refuse if main has moved on.
        if (await adapter.readRef(repository, "main") !== sha) fail("publication_deployment_superseded", "main 已有較新的版本，不能重跑舊版本部署。");
        await input.assertLease();
      } });
    let run: GitHubWorkflowRun;
    if (!input.job.workflow_run_id) {
      const runs = await adapter.listWorkflowRuns(repository, PUBLICATION_WORKFLOW_ID, sha);
      if (!runs.length) return { pending: true };
      if (runs.length !== 1) fail("publication_deployment_identity", "同一 main commit 有多個部署 run，停止自動選擇。");
      run = runs[0];
      assertRun(run, sha);
      // Persist identity before interpreting failures, so retry retains it.
      return { pending: true, metadata: { workflow_run_id: run.id, workflow_run_attempt: run.run_attempt } };
    }
    run = await adapter.readWorkflowRun(repository, input.job.workflow_run_id);
    assertRun(run, sha, input.job.workflow_run_id);
    if (run.run_attempt !== input.job.workflow_run_attempt) {
      if (input.job.workflow_run_attempt === null || (run.run_attempt === input.job.workflow_retry_attempt
        && run.run_attempt === input.job.workflow_run_attempt + 1)) {
        return { pending: true, metadata: { workflow_run_attempt: run.run_attempt } };
      }
      fail("publication_deployment_identity", "部署 attempt 已改變，沒有對應的重試核准。");
    }
    const target = input.job.workflow_retry_attempt;
    if (target && target > run.run_attempt) {
      if (target !== run.run_attempt + 1) fail("publication_deployment_identity", "部署重試 attempt 不連續。");
      if (run.status !== "completed") return { pending: true };
      await adapter.rerunWorkflow(repository, run.id);
      return { pending: true };
    }
    const job = deployJob(await adapter.readWorkflowAttemptJobs(repository, run.id, run.run_attempt), run);
    if (!job) return { pending: true };
    if (job.status === "completed" && job.conclusion !== "success") {
      if (await adapter.readRef(repository, "main") !== sha) {
        fail("publication_deployment_superseded", "main 已有較新的版本，不能重跑舊版本部署。");
      }
      fail("publication_deployment_failed", "正式部署或其必要 smoke 失敗，可重試同一發布工作。", true);
    }
    if (input.step === "waiting_deployment") {
      if (!successfulStep(job, "Deploy to Cloudflare Pages")) {
        if (job.status === "completed") fail("publication_deployment_failed", "正式部署步驟沒有成功完成。", true);
        return { pending: true };
      }
      return {};
    }
    if (input.step !== "verifying_production") fail("unknown_step", "部署 adapter 不接受此發布階段。");
    if (job.status !== "completed") return { pending: true };
    if (!successfulStep(job, "Deploy to Cloudflare Pages") || !successfulStep(job, "Smoke test production deployment")) {
      fail("publication_deployment_failed", "目前 attempt 的 Pages production smoke 沒有成功完成。", true);
    }
    const commit = await adapter.readCommit(repository, sha);
    const tree = await adapter.readTree(repository, commit.tree.sha);
    const entry = tree.find((file) => file.path === "data/published-events.json" && file.type === "blob" && file.mode === "100644");
    if (!entry) fail("publication_deployment_identity", "固定 main commit 缺少公開活動清單。");
    let eventIds: string[];
    try { eventIds = [...parsePublishedEvents(JSON.parse(await adapter.readBlob(repository, entry.sha)))]; }
    catch { fail("publication_deployment_identity", "固定 main commit 的公開活動清單無效。"); }
    const eventId = (input.snapshot as { eventId: string }).eventId;
    let proof;
    try {
      proof = await verifyPublicationOrigin({ mainSha: sha, dataSha: input.job.data_merge_sha, eventId, eventIds, fetch: options.originFetch });
    } catch (error) {
      // A queued or cached older artifact is still retryable. Only a confirmed
      // newer main-line commit already at the origin makes retry futile. A later
      // docs-only main may legitimately leave that deployed commit unchanged.
      const latestMain = await adapter.readRef(repository, "main");
      if (latestMain !== sha) {
        const response = await (options.originFetch ?? fetch)(`${PAGES_PRODUCTION_ORIGIN}${DEPLOYMENT_MANIFEST_PATH}`, {
          redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        const current = response?.status === 200 ? await response.json().catch(() => null) as { schema?: string; commit?: string } | null : null;
        if (current?.schema === "publication-deployment/1" && /^[a-f0-9]{40}$/.test(current.commit ?? "")
          && current.commit !== sha && latestMain
          && await adapter.isAncestor(repository, sha, current.commit!)
          && await adapter.isAncestor(repository, current.commit!, latestMain)) {
          fail("publication_deployment_superseded", "main 已有較新的版本，不能重跑舊版本部署。");
        }
      }
      throw error;
    }
    return { productionVerified: true, metadata: { production_manifest_sha256: proof.manifestSha256 } };
  } };
}
