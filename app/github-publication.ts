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
};

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
        const retryable = status === 429 || status >= 500;
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

  return {
    readBranch,
    listPullRequestsPage,
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
    }) {
      const pull = await request<{
        state: string; base: { ref: string }; head: { ref: string; sha: string }; user: { login: string };
      }>(input.repository, `/pulls/${input.pullNumber}`);
      const expectedRef = `organizer/${input.jobId}/${input.stage}`;
      if (pull.state !== "open" || pull.base.ref !== "main" || pull.head.ref !== expectedRef) throw new Error("Publication PR identity changed.");
      if (pull.head.sha !== input.expectedHeadSha) throw new Error("Publication PR head SHA changed.");
      if (!pull.user.login.endsWith("[bot]")) throw new Error("Publication PR is not App-owned.");
      const checks = await request<{ check_runs: Array<{ name: string; conclusion: string | null; head_sha: string }> }>(
        input.repository, `/commits/${input.expectedHeadSha}/check-runs?per_page=100`,
      );
      for (const required of ["Organizer publication approval", ...input.requiredChecks]) {
        if (!checks.check_runs.some((check) => check.name === required && check.head_sha === input.expectedHeadSha && check.conclusion === "success")) {
          throw new Error(`Required check is not successful: ${required}`);
        }
      }
      return request<{ merged: boolean; sha: string }>(input.repository, `/pulls/${input.pullNumber}/merge`, {
        method: "PUT", body: JSON.stringify({ sha: input.expectedHeadSha, merge_method: "squash" }),
      });
    },
    rerunWorkflow(repository: string, runId: number) {
      return request<void>(repository, `/actions/runs/${runId}/rerun`, { method: "POST" });
    },
    readRepositoryMetadata(repository: string) {
      return request<{ full_name?: unknown }>(repository, "", undefined, 200);
    },
  };
}
