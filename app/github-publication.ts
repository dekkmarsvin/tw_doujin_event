import { sha256Hex } from "./portal-crypto";
import { verifyGitHubWebhookSignature } from "./publication-bundle-assembler";
import { PublicationFailure } from "./organizer-publication";
import { GITHUB_USER_AGENT, type GitHubTokenProvider } from "./github-app-token";

export function createGitHubWebhookHandler(input: {
  secret: string;
  now: () => number;
  recordDelivery: (delivery: { deliveryId: string; event: string; payloadSha256: string; now: number }) => Promise<"recorded" | "duplicate" | "mismatch">;
  completeDelivery?: (delivery: { deliveryId: string; processed: boolean; result?: string; now: number }) => Promise<unknown>;
  onDelivery: (delivery: { deliveryId: string; event: string; payload: unknown }) => Promise<void>;
}) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const body = await request.text();
    if (!await verifyGitHubWebhookSignature(input.secret, body, request.headers.get("x-hub-signature-256"))) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
    const deliveryId = request.headers.get("x-github-delivery")?.trim() ?? "";
    const event = request.headers.get("x-github-event")?.trim() ?? "";
    if (!/^[A-Za-z0-9-]{1,100}$/u.test(deliveryId) || !/^[A-Za-z0-9_]{1,80}$/u.test(event)) {
      return Response.json({ error: "Missing GitHub delivery metadata." }, { status: 400 });
    }
    let payload: unknown;
    try { payload = JSON.parse(body) as unknown; } catch { return Response.json({ error: "Invalid JSON payload." }, { status: 400 }); }
    const recorded = await input.recordDelivery({ deliveryId, event, payloadSha256: await sha256Hex(body), now: input.now() });
    if (recorded === "mismatch") return Response.json({ error: "Delivery id was reused with different bytes." }, { status: 409 });
    if (recorded === "recorded") {
      try {
        await input.onDelivery({ deliveryId, event, payload });
        await input.completeDelivery?.({ deliveryId, processed: true, now: input.now() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.completeDelivery?.({ deliveryId, processed: false, result: message, now: input.now() });
        return Response.json({ error: "Webhook delivery processing failed." }, { status: 500 });
      }
    }
    return Response.json({ accepted: true, duplicate: recorded === "duplicate" }, { status: 202 });
  };
}

export type GitHubAdapterOptions = {
  owner: string;
  /** Kept for existing publication callers and tests. */
  installationToken?: string | GitHubTokenProvider;
  /** Runtime App authentication source. */
  tokenProvider?: GitHubTokenProvider;
  fetch?: typeof globalThis.fetch;
  /** Publication runtime persists intent and rechecks its lease at each write. */
  beforeWrite?: () => Promise<void>;
};

export type GitHubTreeEntry = { path: string; mode: string; type: string; sha: string };
export type GitHubCommit = { sha: string; tree: { sha: string }; parents: Array<{ sha: string }>; message: string };
export type GitHubWorkflowRun = { id: number; workflow_id: number; head_sha: string; head_branch: string; event: string;
  path: string; run_attempt: number; status: string; conclusion: string | null; repository: { full_name: string } };
export type GitHubWorkflowJob = { id: number; run_id: number; run_attempt: number; head_sha: string; name: string;
  status: string; conclusion: string | null; steps: Array<{ name: string; status: string; conclusion: string | null }> };
export type GitHubPull = { number: number; state: string; merged: boolean; merge_commit_sha: string | null;
  body: string | null; base: { ref: string; repo: { full_name: string } }; head: { ref: string; sha: string; repo: { full_name: string } }; user: { login: string } };
export type GitHubCheck = { id: number; name: string; status: string; conclusion: string | null; head_sha: string;
  external_id?: string | null; output?: { summary?: string | null } };
const GIT_SHA = /^[0-9a-f]{40}$/;
function invalidGitHubResponse(): never { throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true); }
function gitSha(value: unknown): string { if (typeof value !== "string" || !GIT_SHA.test(value)) invalidGitHubResponse(); return value; }

function safeTokenProviderFailure(error: unknown) {
  if (error instanceof PublicationFailure) {
    if (error.code === "github_app_config") {
      return new PublicationFailure("github_app_config", "GitHub App authentication is not configured.", false);
    }
    if (error.code === "github_app_key") {
      return new PublicationFailure("github_app_key", "GitHub App private key is invalid.", false);
    }
    if (error.code === "github_app_token") {
      return new PublicationFailure("github_app_token", "GitHub App token response is invalid.", error.retryable);
    }
    if (error.code === "github_app_request") {
      return new PublicationFailure("github_app_request", "GitHub App token request failed.", error.retryable);
    }
  }
  return new PublicationFailure("github_app_request", "GitHub App token request failed.", true);
}

export function createGitHubPublicationAdapter(options: GitHubAdapterOptions) {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const tokenProvider = options.tokenProvider
    ?? (typeof options.installationToken === "object" ? options.installationToken : undefined);
  const staticToken = typeof options.installationToken === "string" ? options.installationToken : undefined;

  function tokenConfigurationFailure() {
    return new PublicationFailure("github_app_config", "GitHub App authentication is not configured.", false);
  }

  async function tokenForRequest() {
    if (tokenProvider) {
      try {
        const token = await tokenProvider.getToken();
        if (typeof token !== "string" || token.length === 0 || token.trim() !== token) throw tokenConfigurationFailure();
        return token;
      } catch (error) {
        throw safeTokenProviderFailure(error);
      }
    }
    if (staticToken && staticToken.trim() === staticToken) return staticToken;
    throw tokenConfigurationFailure();
  }

  const requestRaw = async (repository: string, path: string, init?: RequestInit,
    acceptedStatuses: readonly number[] = []): Promise<Response> => {
    let retriedUnauthorized = false;
    while (true) {
      const token = await tokenForRequest();
      if (init?.method && !["GET", "HEAD"].includes(init.method)) await options.beforeWrite?.();
      let response: Response;
      try {
        response = await requestFetch(`https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(repository)}${path}`, {
          ...init,
          headers: {
            ...init?.headers,
            accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
            "user-agent": GITHUB_USER_AGENT, "x-github-api-version": "2022-11-28",
          },
        });
      } catch {
        throw new PublicationFailure("github_api_request", "GitHub API request failed.", true);
      }
      let status: number;
      let ok: boolean;
      try {
        status = response.status;
        ok = response.ok;
      } catch {
        throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true);
      }
      if (status === 401 && tokenProvider && !retriedUnauthorized) {
        retriedUnauthorized = true;
        try { tokenProvider.invalidate(token); } catch { throw new PublicationFailure("github_app_request", "GitHub App token request failed.", true); }
        continue;
      }
      if (!ok && !acceptedStatuses.includes(status)) {
        const retryable = status === 409 || status === 422 || status === 429 || status >= 500;
        throw new PublicationFailure("github_api_response", "GitHub API request was rejected.", retryable);
      }
      return response;
    }
  };

  const request = async <T>(repository: string, path: string, init?: RequestInit,
    expectedStatus?: number | readonly number[]): Promise<T> => {
    const expected = expectedStatus === undefined ? undefined
      : Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const response = await requestRaw(repository, path, init, expected);
    const status = response.status;
    if (expected && !expected.includes(status)) {
      throw new PublicationFailure("github_api_response", "GitHub API request was rejected.", status === 429 || status >= 500);
    }
    if (status === 204) return undefined as T;
    if (status === 404 && expected?.includes(404)) return null as T;
    try { return await response.json() as T; }
    catch { throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true); }
  };

  const parseResponse = async <T>(response: Response): Promise<T> => {
    try { return await response.json() as T; } catch { return invalidGitHubResponse(); }
  };

  const requestPage = async <T>(repository: string, path: string, init?: RequestInit) => {
    const response = await requestRaw(repository, path, init);
    if (response.status !== 200) {
      throw new PublicationFailure("github_api_response", "GitHub API request was rejected.", response.status === 429 || response.status >= 500);
    }
    let body: T;
    try { body = await response.json() as T; }
    catch { throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true); }
    return { body, headers: response.headers };
  };

  const readBranch = async (repository: string, branch: string) => {
    const response = await requestRaw(repository, `/branches/${encodeURIComponent(branch)}`, undefined, [200, 404]);
    if (response.status === 404) return null;
    let body: unknown;
    try { body = await response.json() as unknown; }
    catch { throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true); }
    if (!body || typeof body !== "object" || typeof (body as { name?: unknown }).name !== "string") {
      throw new PublicationFailure("github_api_response", "GitHub API response is invalid.", true);
    }
    return { name: (body as { name: string }).name };
  };

  const listPullRequestsPage = (repository: string, branch: string, page: number) =>
    requestPage<Array<{ number?: unknown; state?: unknown; merged_at?: unknown; head?: unknown }>>(
      repository,
      `/pulls?head=${encodeURIComponent(`${options.owner}:${branch}`)}&state=all&per_page=100&page=${page}`,
    );

  const readPullRequest = (repository: string, number: number) => request<GitHubPull>(repository, `/pulls/${number}`);
  const readChecks = async (repository: string, sha: string) => {
    gitSha(sha);
    const checks: GitHubCheck[] = [];
    for (let page = 1; page <= 20; page++) {
      const response = await requestPage<{ check_runs: GitHubCheck[] }>(repository, `/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`);
      if (!Array.isArray(response.body?.check_runs)) invalidGitHubResponse();
      for (const check of response.body.check_runs) {
        if (!check || !Number.isSafeInteger(check.id) || typeof check.name !== "string" || typeof check.status !== "string"
          || check.head_sha !== sha || !(check.conclusion === null || typeof check.conclusion === "string")) invalidGitHubResponse();
        checks.push(check);
      }
      if (!response.headers.get("link")?.includes('rel="next"')) return checks;
    }
    invalidGitHubResponse();
  };

  return {
    readBranch,
    listPullRequestsPage,
    readPullRequest,
    readChecks,
    async isAncestor(repository: string, ancestor: string, currentMain: string) {
      gitSha(ancestor); gitSha(currentMain);
      if (ancestor === currentMain) return true;
      const value = await request<{ status: string; base_commit: { sha: string }; merge_base_commit: { sha: string } }>(
        repository, `/compare/${ancestor}...${currentMain}`,
      );
      if (value?.base_commit?.sha !== ancestor || !["ahead", "behind", "diverged", "identical"].includes(value.status)) invalidGitHubResponse();
      gitSha(value.merge_base_commit?.sha);
      return value.status === "ahead" && value.merge_base_commit.sha === ancestor;
    },
    async readRef(repository: string, branch: string) {
      const value = await request<{ ref: string; object: { sha: string; type: string } } | null>(repository, `/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, undefined, [200, 404]);
      if (value === null) return null;
      if (value.ref !== `refs/heads/${branch}` || value.object?.type !== "commit") invalidGitHubResponse();
      return gitSha(value.object.sha);
    },
    async readCommit(repository: string, sha: string) {
      const value = await request<GitHubCommit>(repository, `/git/commits/${gitSha(sha)}`);
      if (value?.sha !== sha || !Array.isArray(value.parents) || typeof value.message !== "string") invalidGitHubResponse();
      gitSha(value.tree?.sha); value.parents.forEach((parent) => gitSha(parent?.sha));
      return value;
    },
    async readTree(repository: string, sha: string) {
      const value = await request<{ sha: string; tree: GitHubTreeEntry[]; truncated: boolean }>(repository, `/git/trees/${gitSha(sha)}?recursive=1`);
      if (value?.sha !== sha || value.truncated !== false || !Array.isArray(value.tree)) invalidGitHubResponse();
      const seen = new Set<string>();
      for (const entry of value.tree) {
        if (!entry || typeof entry.path !== "string" || !entry.path || seen.has(entry.path)
          || typeof entry.mode !== "string" || !["blob", "tree", "commit"].includes(entry.type)) invalidGitHubResponse();
        gitSha(entry.sha); seen.add(entry.path);
      }
      return value.tree;
    },
    async readBlob(repository: string, sha: string) {
      const value = await request<{ sha: string; encoding: string; content: string }>(repository, `/git/blobs/${gitSha(sha)}`);
      if (value?.sha !== sha || value.encoding !== "base64" || typeof value.content !== "string") invalidGitHubResponse();
      try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.content.replace(/\s/g, "")), (char) => char.charCodeAt(0))); }
      catch { return invalidGitHubResponse(); }
    },
    async createTree(repository: string, baseTree: string, files: readonly { path: string; text: string }[]) {
      const value = await request<{ sha: string }>(repository, "/git/trees", { method: "POST", body: JSON.stringify({
        base_tree: gitSha(baseTree), tree: files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.text })),
      }) });
      return gitSha(value?.sha);
    },
    async createCommit(repository: string, parent: string, tree: string, message: string) {
      const value = await request<{ sha: string }>(repository, "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: gitSha(tree), parents: [gitSha(parent)] }) });
      return gitSha(value?.sha);
    },
    async createRef(repository: string, branch: string, sha: string) {
      await request(repository, "/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: gitSha(sha) }) });
    },
    async createPullRequest(repository: string, branch: string, title: string, body: string) {
      const value = await request<GitHubPull>(repository, "/pulls", { method: "POST", body: JSON.stringify({ title, body, head: branch, base: "main" }) });
      if (!Number.isSafeInteger(value?.number) || value.number <= 0) invalidGitHubResponse();
      return value.number;
    },
    createApprovalCheck(repository: string, headSha: string, jobId: string, approvalHash: string) {
      return request(repository, "/check-runs", {
        method: "POST", body: JSON.stringify({
          name: "Organizer publication approval", head_sha: headSha, status: "completed", conclusion: "success",
          external_id: jobId,
          output: { title: "Organizer revision approved", summary: `Approval snapshot ${approvalHash}` },
        }),
      });
    },
    async mergeOwnedPullRequest(input: {
      repository: string; pullNumber: number; jobId: string; stage: "data" | "main";
      expectedHeadSha: string; requiredChecks: readonly string[];
      approvalHash?: string;
    }) {
      const pull = await readPullRequest(input.repository, input.pullNumber);
      const expectedRef = `organizer/${input.jobId}/${input.stage}`;
      if (pull.state !== "open" || pull.base?.ref !== "main" || pull.head?.ref !== expectedRef) throw new PublicationFailure("publication_pr_changed", "Publication PR identity changed.", false);
      if (pull.head.sha !== input.expectedHeadSha) throw new PublicationFailure("publication_pr_changed", "Publication PR head SHA changed.", false);
      if (!pull.user?.login?.endsWith("[bot]")) throw new PublicationFailure("publication_pr_changed", "Publication PR is not App-owned.", false);
      const checks = await readChecks(input.repository, input.expectedHeadSha);
      for (const required of ["Organizer publication approval", ...input.requiredChecks]) {
        const latest = checks.filter((check) => check.name === required).sort((a, b) => b.id - a.id)[0];
        if (!latest || latest.status !== "completed" || latest.conclusion !== "success") {
          throw new PublicationFailure("publication_check_failed", `Required check is not successful: ${required}`, true);
        }
        if (required === "Organizer publication approval" && input.approvalHash
          && (latest.external_id !== input.jobId || latest.output?.summary !== `Approval snapshot ${input.approvalHash}`)) {
          throw new PublicationFailure("publication_approval_changed", "Publication approval check changed.", false);
        }
      }
      return request<{ merged: boolean; sha: string }>(input.repository, `/pulls/${input.pullNumber}/merge`, {
        method: "PUT", body: JSON.stringify({ sha: input.expectedHeadSha, merge_method: "squash" }),
      });
    },
    async rerunWorkflow(repository: string, runId: number) {
      const response = await requestRaw(repository, `/actions/runs/${runId}/rerun`, { method: "POST" });
      if (response.status !== 201) invalidGitHubResponse();
      // GitHub acknowledges this mutation with an empty 201 response.
    },
    async listWorkflowRuns(repository: string, workflowId: number, headSha: string) {
      const response = await requestRaw(repository, `/actions/workflows/${workflowId}/runs?branch=main&event=push&head_sha=${gitSha(headSha)}&per_page=100`);
      if (response.status !== 200 || response.headers.get("link")?.includes('rel="next"')) invalidGitHubResponse();
      const body = await parseResponse<{ total_count: number; workflow_runs: GitHubWorkflowRun[] }>(response);
      if (!Array.isArray(body.workflow_runs) || body.total_count !== body.workflow_runs.length) invalidGitHubResponse();
      return body.workflow_runs;
    },
    readWorkflowRun(repository: string, runId: number) {
      return request<GitHubWorkflowRun>(repository, `/actions/runs/${runId}`, undefined, 200);
    },
    async readWorkflowAttemptJobs(repository: string, runId: number, attempt: number) {
      const response = await requestRaw(repository, `/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
      if (response.status !== 200 || response.headers.get("link")?.includes('rel="next"')) invalidGitHubResponse();
      const body = await parseResponse<{ total_count: number; jobs: GitHubWorkflowJob[] }>(response);
      if (!Array.isArray(body.jobs) || body.total_count !== body.jobs.length) invalidGitHubResponse();
      return body.jobs;
    },
    readRepositoryMetadata(repository: string) {
      return request<{ full_name?: unknown }>(repository, "", undefined, 200);
    },
  };
}
