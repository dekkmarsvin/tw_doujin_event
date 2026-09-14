import { createGitHubPublicationAdapter, type GitHubAdapterOptions, type GitHubCheck, type GitHubPull, type GitHubTreeEntry } from "./github-publication";
import { GITHUB_PUBLICATION_OWNER, GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import { buildApprovedPublicationArtifacts, buildPublicationDataStage, buildPublicationMainStage } from "./publication-artifacts";
import { PublicationFailure, type PublicationDriver } from "./organizer-publication";
import { PUBLICATION_REQUIRED_CHECKS } from "./publication-rollout";
import { parsePublishedEvents } from "./published-events.mjs";

type Adapter = ReturnType<typeof createGitHubPublicationAdapter>;
type Run = Parameters<PublicationDriver["run"]>[0];
type Stage = "data" | "main";
const repositories = { data: GITHUB_PUBLICATION_REPOSITORIES[0], main: GITHUB_PUBLICATION_REPOSITORIES[1] };
const publishedPath = "data/published-events.json";
const approvalName = "Organizer publication approval";
function fail(code: string, message: string, retryable = false): never { throw new PublicationFailure(code, message, retryable); }
function messageFor(input: Run, stage: Stage) { return `Organizer publication ${input.job.id}/${stage}\n\nApproval snapshot ${input.job.approval_hash}`; }
function latestCheck(checks: GitHubCheck[], name: string) { return checks.filter((check) => check.name === name).sort((a, b) => b.id - a.id)[0]; }

async function readFiles(adapter: Adapter, repository: string, tree: GitHubTreeEntry[], paths: string[]) {
  return new Map(await Promise.all(paths.map(async (path) => {
    const entry = tree.find((entry) => entry.path === path);
    if (!entry) return [path, null] as const;
    if (entry.type !== "blob" || entry.mode !== "100644") fail("publication_path_changed", `發布檔案不是一般文字檔：${path}`);
    return [path, await adapter.readBlob(repository, entry.sha)] as const;
  })));
}
function required(files: Map<string, string | null>, path: string) {
  const text = files.get(path);
  if (typeof text !== "string") fail("publication_file_missing", `固定版本缺少必要檔案：${path}`);
  return text;
}
async function readBase(adapter: Adapter, repository: string, sha?: string) {
  const commit = sha ?? await adapter.readRef(repository, "main");
  if (!commit) fail("publication_base_missing", "找不到發布 repository 的 main 分支。");
  const record = await adapter.readCommit(repository, commit);
  return { commit, record, tree: await adapter.readTree(repository, record.tree.sha) };
}
async function assertTree(base: GitHubTreeEntry[], actual: GitHubTreeEntry[], files: readonly { path: string; text: string }[]) {
  const leaves = (entries: GitHubTreeEntry[]) => new Map(entries.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, `${entry.mode}/${entry.type}/${entry.sha}`]));
  const expected = leaves(base);
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.text);
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const payload = new Uint8Array(header.length + bytes.length); payload.set(header); payload.set(bytes, header.length);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-1", payload))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expected.set(file.path, `100644/blob/${sha}`);
  }
  const observed = leaves(actual);
  if (observed.size !== expected.size || [...expected].some(([path, value]) => observed.get(path) !== value)) {
    fail("publication_tree_changed", "發布分支的檔案或內容與核准產物不符，拒絕覆寫或合併。");
  }
}
function assertPull(pull: GitHubPull, input: Run, stage: Stage, expectedSha?: string) {
  const repository = `${GITHUB_PUBLICATION_OWNER}/${repositories[stage]}`;
  if (!pull || !Number.isSafeInteger(pull.number) || pull.number <= 0
    || pull.base?.ref !== "main" || pull.base.repo?.full_name !== repository
    || pull.head?.ref !== `organizer/${input.job.id}/${stage}` || pull.head.repo?.full_name !== repository
    || !/^[0-9a-f]{40}$/.test(pull.head.sha) || !pull.user?.login?.endsWith("[bot]")
    || pull.body !== messageFor(input, stage) || (expectedSha && pull.head.sha !== expectedSha)) {
    fail("publication_pr_changed", "發布 PR 的身分、核准內容或固定 head SHA 已改變。");
  }
  if (pull.state !== "open" && !(pull.state === "closed" && pull.merged === true)) fail("publication_pr_closed", "發布 PR 已被關閉，不能自動重建。");
}
async function findPull(adapter: Adapter, repository: string, branch: string) {
  const response = await adapter.listPullRequestsPage(repository, branch, 1);
  if (!Array.isArray(response.body) || response.body.length >= 100 || response.headers.get("link")?.includes('rel="next"')) {
    fail("publication_pr_lookup", "無法完整確認此發布工作的 PR。", true);
  }
  if (response.body.length > 1) fail("publication_pr_ambiguous", "此發布工作已有多張 PR，停止自動處理。");
  const number = response.body[0]?.number;
  if (number === undefined && response.body.length === 0) return null;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) fail("publication_pr_lookup", "發布 PR 回應無效。", true);
  return adapter.readPullRequest(repository, number);
}
function checksReady(checks: GitHubCheck[], stage: Stage) {
  for (const name of PUBLICATION_REQUIRED_CHECKS[stage]) {
    const check = latestCheck(checks, name);
    if (!check || check.status !== "completed") return false;
    if (check.conclusion !== "success") fail("publication_check_failed", `必要檢查未通過：${name}`, true);
  }
  return true;
}

/** Reconciles fixed job branches and their complete trees before any mutation.
 * Deployment evidence is supplied by the separate #212 Phase 4 adapter. */
export function createGitHubPublicationDriver(options: Pick<GitHubAdapterOptions, "tokenProvider" | "fetch"> & {
  publishedEvent: (eventId: string) => Promise<unknown | null>;
  deployment?: Pick<PublicationDriver, "run">;
}): PublicationDriver {
  const adapterFor = (beforeWrite?: () => Promise<void>) => createGitHubPublicationAdapter({
    owner: GITHUB_PUBLICATION_OWNER, tokenProvider: options.tokenProvider, beforeWrite,
    fetch: (url, init) => (options.fetch ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(8_000) }),
  });
  return {
    async eventExists(eventId) {
      if (await options.publishedEvent(eventId)) return true;
      // The current remote collection also covers merged publications not yet
      // served by this Pages deployment. Read failure is never absence.
      const adapter = adapterFor();
      const base = await readBase(adapter, repositories.main);
      const files = await readFiles(adapter, repositories.main, base.tree, [publishedPath]);
      try { return parsePublishedEvents(JSON.parse(required(files, publishedPath))).includes(eventId); }
      catch (error) { if (error instanceof PublicationFailure) throw error; return fail("published_collection_invalid", "已發布活動清單無法驗證。"); }
    },
    async run(input) {
      const { job, step } = input;
      if (!/^[a-z0-9-]{1,100}$/i.test(job.id) || input.idempotencyKey !== `${job.id}/${step}/${job.approval_hash}`) fail("publication_identity", "發布工作識別不符。");
      if (step === "waiting_deployment" || step === "verifying_production") {
        if (!options.deployment) fail("publication_deployment_unavailable", "正式部署驗證尚未接線，發布維持鎖定。");
        return options.deployment.run(input);
      }
      const stage: Stage = step.endsWith("_data") || step === "waiting_data_checks" ? "data" : "main";
      const repository = repositories[stage];
      const branch = `organizer/${job.id}/${stage}`;
      const pinnedHead = job[`${stage}_head_sha`];
      const pinnedPull = job[`${stage}_pr_number`];
      const adapter = adapterFor(async () => { await input.beginRemoteWrite(); await input.assertLease(); });
      if (step === "preparing_data" || step === "preparing_main") {
        const source = { snapshotJson: input.snapshotJson, approvalHash: job.approval_hash };
        const artifacts = await buildApprovedPublicationArtifacts(source);
        if (artifacts.snapshot.candidateId !== job.candidate_id || artifacts.snapshot.candidateVersion !== job.candidate_version) fail("snapshot_mismatch", "核准 snapshot 與工作版本不符。");
        let pull = await findPull(adapter, repository, branch);
        if (pull) assertPull(pull, input, stage, pinnedHead ?? undefined);
        const ref = await adapter.readRef(repository, branch);
        let head = pull?.head.sha ?? ref;
        if (ref && head !== ref) fail("publication_pr_changed", "發布分支與 PR 的 head 不符。");
        if (pinnedHead && pinnedHead !== head) fail("checkpoint_mismatch", "固定發布 head 已改變或消失。");
        if (pinnedPull && pinnedPull !== pull?.number) fail("checkpoint_mismatch", "固定發布 PR 已改變或消失。");
        const existing = head ? await adapter.readCommit(repository, head) : null;
        if (existing && (existing.message !== messageFor(input, stage) || existing.parents.length !== 1)) fail("publication_commit_changed", "發布 commit 的工作記錄或 parent 不符。");
        const base = await readBase(adapter, repository, existing?.parents[0].sha);
        let files: Awaited<ReturnType<typeof buildPublicationDataStage>>["files"];
        if (stage === "data") {
          const references = await readFiles(adapter, repository, base.tree, artifacts.files.filter((file) => file.path.startsWith("references/")).map((file) => file.path));
          files = (await buildPublicationDataStage(source, { commit: base.commit, references,
            eventDirectoryExists: base.tree.some((entry) => entry.path === `events/${artifacts.snapshot.eventId}` || entry.path.startsWith(`events/${artifacts.snapshot.eventId}/`)),
          })).files;
        } else {
          if (!job.data_merge_sha) fail("missing_data_commit", "Main 發布缺少已固定的 data merge commit。");
          const dataBase = await readBase(adapter, repositories.data, job.data_merge_sha);
          const data = await readFiles(adapter, repositories.data, dataBase.tree, artifacts.files.map((file) => file.path));
          const pinPath = `data/event-data-pins/${artifacts.snapshot.eventId}.json`;
          const main = await readFiles(adapter, repository, base.tree, [publishedPath, pinPath, "data/circle-identities/allocations.json", "data/circle-identities/evidence.json"]);
          files = (await buildPublicationMainStage(source, { dataCommit: job.data_merge_sha, dataFiles: new Map([...data].filter((entry): entry is [string, string] => entry[1] !== null)),
            mainCommit: base.commit, publishedEventsJson: required(main, publishedPath), existingPinJson: main.get(pinPath) ?? null,
            allocationsJson: required(main, "data/circle-identities/allocations.json"), evidenceJson: required(main, "data/circle-identities/evidence.json"),
          })).files;
        }
        if (!head) {
          const tree = await adapter.createTree(repository, base.record.tree.sha, files);
          head = await adapter.createCommit(repository, base.commit, tree, messageFor(input, stage));
          await adapter.createRef(repository, branch, head);
        }
        const commit = existing ?? await adapter.readCommit(repository, head);
        await assertTree(base.tree, await adapter.readTree(repository, commit.tree.sha), files);
        if (!pull) {
          const number = await adapter.createPullRequest(repository, branch, `Publish ${artifacts.snapshot.eventId} (${stage})`, messageFor(input, stage));
          pull = await adapter.readPullRequest(repository, number);
        }
        assertPull(pull, input, stage, head);
        const approval = latestCheck(await adapter.readChecks(repository, head), approvalName);
        if (approval) {
          if (approval.external_id !== job.id || approval.output?.summary !== `Approval snapshot ${job.approval_hash}`
            || approval.status !== "completed" || approval.conclusion !== "success") fail("publication_approval_changed", "既有核准 check 與本工作不符。");
        } else {
          if (pull.merged) fail("publication_approval_missing", "已合併 PR 缺少本次核准 check。");
          await adapter.createApprovalCheck(repository, head, job.id, job.approval_hash);
        }
        return { metadata: stage === "data" ? { data_pr_number: pull.number, data_head_sha: head } : { main_pr_number: pull.number, main_head_sha: head } };
      }
      if (!pinnedHead || !pinnedPull) fail("missing_checkpoint", "發布尚未固定 PR 與 head SHA。");
      const pull = await adapter.readPullRequest(repository, pinnedPull);
      assertPull(pull, input, stage, pinnedHead);
      const checks = await adapter.readChecks(repository, pinnedHead);
      const approval = latestCheck(checks, approvalName);
      if (approval && (approval.external_id !== job.id || approval.output?.summary !== `Approval snapshot ${job.approval_hash}`)) fail("publication_approval_changed", "核准 check 與本次工作不符。");
      if (!checksReady(checks, stage)) return { pending: true };
      if (step === "waiting_data_checks" || step === "waiting_main_checks") return {};
      let mergeSha = pull.merged ? pull.merge_commit_sha : null;
      if (!pull.merged) {
        const result = await adapter.mergeOwnedPullRequest({ repository, pullNumber: pinnedPull, jobId: job.id, stage,
          expectedHeadSha: pinnedHead, requiredChecks: PUBLICATION_REQUIRED_CHECKS[stage], approvalHash: job.approval_hash });
        if (!result.merged) fail("publication_merge_failed", "GitHub 尚未完成發布 PR 合併。", true);
        mergeSha = result.sha;
      }
      if (!mergeSha || !/^[0-9a-f]{40}$/.test(mergeSha)) fail("publication_merge_invalid", "GitHub 合併結果缺少固定 commit SHA。", true);
      return { metadata: stage === "data" ? { data_merge_sha: mergeSha } : { main_merge_sha: mergeSha } };
    },
  };
}
