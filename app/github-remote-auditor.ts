import { PublicationFailure } from "./organizer-publication";
import { createGitHubPublicationAdapter } from "./github-publication";
import type { GitHubTokenProvider } from "./github-app-token";

/** The publication repositories are selected by the server, never by a form. */
export const GITHUB_PUBLICATION_OWNER = "dekkmarsvin";
export const GITHUB_PUBLICATION_REPOSITORIES = ["tw_doujin_event-data", "tw_doujin_event"] as const;

type PullRequestPage = {
  number?: unknown;
  state?: unknown;
  merged_at?: unknown;
  head?: unknown;
};

function auditFailure() {
  return new PublicationFailure("github_remote_audit", "GitHub remote publication state could not be verified.", true);
}

function parseNextPage(link: string | null, repository: string, branch: string, page: number) {
  if (link === null) return null;
  let next: number | null = null;
  for (const part of link.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*$/u.exec(part);
    if (!match) throw auditFailure();
    const relations = match[2].split(/\s+/u);
    if (!relations.includes("next")) continue;
    let url: URL;
    try { url = new URL(match[1]); } catch { throw auditFailure(); }
    if (url.origin !== "https://api.github.com"
      || url.pathname !== `/repos/${GITHUB_PUBLICATION_OWNER}/${repository}/pulls`
      || url.searchParams.get("head") !== `${GITHUB_PUBLICATION_OWNER}:${branch}`
      || url.searchParams.get("state") !== "all"
      || url.searchParams.get("per_page") !== "100") throw auditFailure();
    const value = Number(url.searchParams.get("page"));
    if (!Number.isSafeInteger(value) || value <= page || next !== null) throw auditFailure();
    next = value;
  }
  return next;
}

function validPullRequest(row: PullRequestPage, branch: string) {
  if (!row || typeof row !== "object" || !row.head || typeof row.head !== "object") return false;
  const head = row.head as { ref?: unknown };
  return typeof head.ref === "string" && head.ref === branch;
}

/**
 * Proves that both publication repositories contain no branch or PR for the
 * failed job. A deleted branch is not enough: the all-state PR search catches
 * closed and merged evidence that remains after the branch is removed. Every
 * malformed response or pagination inconsistency fails closed.
 */
export function createGitHubRemoteAuditor(options: {
  tokenProvider: GitHubTokenProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}) {
  return async (jobId: string): Promise<{ clear: true }> => {
    if (typeof jobId !== "string" || !/^[0-9a-f-]{1,100}$/iu.test(jobId)) throw auditFailure();
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw auditFailure();
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestFetch = options.fetch ?? globalThis.fetch;
    const tokenProvider: GitHubTokenProvider = {
      getToken: async () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw auditFailure();
        let tokenTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            Promise.resolve().then(() => options.tokenProvider.getToken()),
            new Promise<never>((_, reject) => {
              tokenTimer = setTimeout(() => reject(auditFailure()), remaining);
            }),
          ]);
        } finally {
          if (tokenTimer !== undefined) clearTimeout(tokenTimer);
        }
      },
      invalidate: (rejectedToken) => options.tokenProvider.invalidate(rejectedToken),
    };
    const boundedFetch: typeof globalThis.fetch = async (input, init) => {
      if (Date.now() >= deadline) throw auditFailure();
      return requestFetch(input, { ...init, signal: controller.signal });
    };
    const adapter = createGitHubPublicationAdapter({
      owner: GITHUB_PUBLICATION_OWNER,
      tokenProvider,
      fetch: boundedFetch,
    });
    try {
      for (const [repository, stage] of [
        [GITHUB_PUBLICATION_REPOSITORIES[0], "data"],
        [GITHUB_PUBLICATION_REPOSITORIES[1], "main"],
      ] as const) {
        const branch = `organizer/${jobId}/${stage}`;
        const branchRecord = await adapter.readBranch(repository, branch);
        if (branchRecord !== null) {
          if (!branchRecord || branchRecord.name !== branch) throw auditFailure();
          throw new PublicationFailure("github_remote_started", "GitHub remote publication state already exists.", false);
        }

        let page = 1;
        for (;;) {
          const result = await adapter.listPullRequestsPage(repository, branch, page);
          if (!Array.isArray(result.body)) throw auditFailure();
          for (const row of result.body) {
            if (!validPullRequest(row, branch)) throw auditFailure();
            // Any matching PR, regardless of state or merge result, is remote
            // evidence and therefore makes reopening unsafe.
            throw new PublicationFailure("github_remote_started", "GitHub remote publication state already exists.", false);
          }
          const next = parseNextPage(result.headers.get("link"), repository, branch, page);
          if (next === null) {
            // A full page without a next link cannot prove that no later page
            // exists. Refuse rather than treating an incomplete listing as an
            // empty audit.
            if (result.body.length >= 100) throw auditFailure();
            break;
          }
          if (result.body.length < 100) throw auditFailure();
          page = next;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return { clear: true };
  };
}
