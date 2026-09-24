import { createGitHubPublicationAdapter, type GitHubAdapterOptions, type GitHubPull, type GitHubTreeEntry } from "./github-publication";
import { GITHUB_PUBLICATION_OWNER, GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import type { OrganizerAmendmentBaseline } from "./organizer-amendment-baseline";
import { PublicationFailure, type PublicationJob } from "./organizer-publication";

export type PublicationRecoveryAudit = (input: {
  job: PublicationJob; baseline: OrganizerAmendmentBaseline; restorationPullNumber: number;
}) => Promise<Record<string, string | number>>;
const shaPattern = /^[0-9a-f]{40}$/;
function refuse(): never { throw new PublicationFailure("publication_recovery_unverified", "還原紀錄或公開基準不符，尚不能終止這次修正。", false); }
const leaves = (tree: GitHubTreeEntry[]) => new Map(tree.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, `${entry.mode}/${entry.type}/${entry.sha}`]));
function same(a: Map<string, string>, b: Map<string, string>) {
  return a.size === b.size && [...a].every(([path, value]) => b.get(path) === value);
}

/** Read-only audit of a maintainer restoration PR. This is deliberately not a
 * rollback driver: published pins are never changed and old jobs never resume. */
export function createPublicationRecoveryAuditor(options: Pick<GitHubAdapterOptions, "tokenProvider" | "fetch">): PublicationRecoveryAudit {
  const adapter = createGitHubPublicationAdapter({ ...options, owner: GITHUB_PUBLICATION_OWNER,
    fetch: (url, init) => (options.fetch ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(8_000) }) });
  const [dataRepo, mainRepo] = GITHUB_PUBLICATION_REPOSITORIES;
  async function tree(repo: string, commit: string) { return adapter.readTree(repo, (await adapter.readCommit(repo, commit)).tree.sha); }
  function pullIdentity(pull: GitHubPull, repo: string, number: number) {
    if (pull?.number !== number || pull.base?.ref !== "main" || pull.base.repo?.full_name !== `${GITHUB_PUBLICATION_OWNER}/${repo}`
      || pull.head?.repo?.full_name !== `${GITHUB_PUBLICATION_OWNER}/${repo}` || !shaPattern.test(pull.head?.sha ?? "")) refuse();
  }
  async function originalPull(job: PublicationJob, stage: "data" | "main") {
    const repo = stage === "data" ? dataRepo : mainRepo;
    const branch = `organizer/${job.id}/${stage}`;
    const number = job[`${stage}_pr_number`];
    const head = job[`${stage}_head_sha`];
    // The branch has a fixed identity; an incomplete/ambiguous lookup cannot
    // turn an unknown remote side effect into permission to release the lock.
    const page = await adapter.listPullRequestsPage(repo, branch, 1);
    if (!Array.isArray(page.body) || page.headers.has("link") || page.body.length > 1) refuse();
    const ref = await adapter.readRef(repo, branch);
    // The data repository automatically deletes merged branches. Its exact
    // merged PR remains authoritative; the unmerged main branch must remain.
    if (number === null || head === null || page.body.length !== 1 || page.body[0].number !== number
      || (ref !== head && !(stage === "data" && ref === null))) refuse();
    const pull = await adapter.readPullRequest(repo, number);
    pullIdentity(pull, repo, number);
    if (pull.head.ref !== branch || pull.head.sha !== head || !pull.user?.login?.endsWith("[bot]")
      || pull.body !== `Organizer publication ${job.id}/${stage}\n\nApproval snapshot ${job.approval_hash}`
      || pull.state !== "closed" || (stage === "data" ? pull.merged !== true || pull.merge_commit_sha !== job.data_merge_sha : pull.merged !== false)) refuse();
  }
  return async ({ job, baseline, restorationPullNumber }) => {
    if (job.status !== "failed" || !job.data_merge_sha || job.main_merge_sha !== null || job.workflow_run_id !== null
      || !Number.isSafeInteger(restorationPullNumber) || restorationPullNumber <= 0 || restorationPullNumber === job.data_pr_number) refuse();
    await Promise.all([originalPull(job, "data"), originalPull(job, "main")]);
    const restoration = await adapter.readPullRequest(dataRepo, restorationPullNumber);
    pullIdentity(restoration, dataRepo, restorationPullNumber);
    if (restoration.state !== "closed" || restoration.merged !== true || !restoration.merge_commit_sha
      || !shaPattern.test(restoration.merge_commit_sha)) refuse();
    const checks = await adapter.readChecks(dataRepo, restoration.head.sha);
    const check = checks.filter((item) => item.name === "data / check").sort((a, b) => b.id - a.id)[0];
    if (!check || check.status !== "completed" || check.conclusion !== "success") refuse();
    const [dataMain, mainHead] = await Promise.all([adapter.readRef(dataRepo, "main"), adapter.readRef(mainRepo, "main")]);
    if (!dataMain || !mainHead) refuse();
    if (!await adapter.isAncestor(dataRepo, job.data_merge_sha, restoration.merge_commit_sha)
      || !await adapter.isAncestor(dataRepo, restoration.merge_commit_sha, dataMain)) refuse();
    const restoredCommit = await adapter.readCommit(dataRepo, restoration.merge_commit_sha);
    // Maintenance restoration uses a single-parent (squash) commit. This lets
    // the full-tree comparison prove it did not revert another event/reference.
    if (restoredCommit.parents.length !== 1) refuse();
    const [before, restored, current, baselineTree, mainTree] = await Promise.all([
      tree(dataRepo, restoredCommit.parents[0].sha), tree(dataRepo, restoration.merge_commit_sha), tree(dataRepo, dataMain),
      tree(dataRepo, baseline.pin.commit), tree(mainRepo, mainHead),
    ]);
    const prefix = `events/${baseline.event.id}/`;
    const expected = leaves(before);
    for (const path of expected.keys()) if (path.startsWith(prefix)) expected.delete(path);
    const eventLeaves = new Map([...leaves(baselineTree)].filter(([path]) => path.startsWith(prefix)));
    if (!eventLeaves.size) refuse();
    for (const [path, value] of eventLeaves) expected.set(path, value);
    if (!same(expected, leaves(restored)) || !same(eventLeaves, new Map([...leaves(current)].filter(([path]) => path.startsWith(prefix))))) refuse();
    // Shared references used by the original snapshot must also be restored;
    // recovery never reverts unrelated shared-reference changes on its behalf.
    for (const file of baseline.pin.files) {
      const original = baselineTree.find((entry) => entry.path === file.path);
      if (!original || leaves(current).get(file.path) !== `${original.mode}/${original.type}/${original.sha}`) refuse();
    }
    const pinEntry = mainTree.find((entry) => entry.path === `data/event-data-pins/${baseline.event.id}.json`);
    if (!pinEntry || pinEntry.type !== "blob" || pinEntry.mode !== "100644") refuse();
    const pin = JSON.parse(await adapter.readBlob(mainRepo, pinEntry.sha));
    if (JSON.stringify(pin) !== JSON.stringify(baseline.pin)) refuse();
    return { restorationPullNumber, restorationHeadSha: restoration.head.sha, restorationMergeSha: restoration.merge_commit_sha,
      auditedDataMain: dataMain, auditedMain: mainHead, sourceCandidateId: baseline.source.candidateId,
      sourceVersion: baseline.source.candidateVersion, sourceDataCommit: baseline.pin.commit };
  };
}
