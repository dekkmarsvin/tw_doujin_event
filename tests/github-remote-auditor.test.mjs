import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createGitHubRemoteAuditor } = await environment.runner.import("/app/github-remote-auditor.ts");
after(() => vite.close());

const jobId = "a1b2c3d4";
const branches = {
  data: `organizer/${jobId}/data`,
  main: `organizer/${jobId}/main`,
};

function provider() {
  return { getToken: async () => "installation-token", invalidate: () => undefined };
}

function emptyRemoteFetch(calls) {
  return async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.includes("/branches/")) return new Response(null, { status: 404 });
    if (url.pathname.endsWith("/pulls")) return Response.json([]);
    throw new Error(`unexpected URL ${url}`);
  };
}

test("remote audit proves clear only for both fixed repositories and both exact job branches", async () => {
  const calls = [];
  const audit = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: emptyRemoteFetch(calls) });
  assert.deepEqual(await audit(jobId), { clear: true });
  assert.deepEqual(calls.map((url) => [url.pathname, url.searchParams.get("head"), url.searchParams.get("state")]), [
    [`/repos/dekkmarsvin/tw_doujin_event-data/branches/${encodeURIComponent(branches.data)}`, null, null],
    ["/repos/dekkmarsvin/tw_doujin_event-data/pulls", `dekkmarsvin:${branches.data}`, "all"],
    [`/repos/dekkmarsvin/tw_doujin_event/branches/${encodeURIComponent(branches.main)}`, null, null],
    ["/repos/dekkmarsvin/tw_doujin_event/pulls", `dekkmarsvin:${branches.main}`, "all"],
  ]);
});

test("an existing branch blocks reopen even when its PR listing is empty", async () => {
  const calls = [];
  const audit = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: async (input) => {
    calls.push(new URL(input));
    return calls.length === 1 ? Response.json({ name: branches.data }) : Response.json([]);
  }});
  await assert.rejects(audit(jobId), (error) => error.code === "github_remote_started");
  assert.equal(calls.length, 1);
});

test("a closed or merged PR remains remote evidence after its branch is deleted", async () => {
  let pullRequest = false;
  const audit = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("/branches/")) return new Response(null, { status: 404 });
    if (url.pathname.endsWith("/pulls")) {
      if (!pullRequest) { pullRequest = true; return Response.json([]); }
      return Response.json([{ state: "closed", merged_at: "2026-09-14T00:00:00Z", head: { ref: branches.main } }]);
    }
    throw new Error("unexpected URL");
  }});
  await assert.rejects(audit(jobId), (error) => error.code === "github_remote_started");
});

test("a non-200 empty PR page cannot prove that remote state is clear", async () => {
  for (const status of [202, 206]) {
    const audit = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes("/branches/")) return new Response(null, { status: 404 });
      if (url.pathname.endsWith("/pulls")) return new Response("[]", { status });
      throw new Error("unexpected URL");
    }});
    await assert.rejects(audit(jobId), (error) => error.code === "github_api_response");
  }
});

test("incomplete or failed remote responses refuse closed-state proof", async () => {
  const incomplete = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("/branches/")) return new Response(null, { status: 404 });
    return new Response(JSON.stringify([]), { headers: { link: `<https://api.github.com/repos/dekkmarsvin/tw_doujin_event-data/pulls?head=dekkmarsvin%3A${encodeURIComponent(branches.data)}&state=all&per_page=100&page=2>; rel="next"` } });
  }});
  await assert.rejects(incomplete(jobId), (error) => error.code === "github_remote_audit");

  const failed = createGitHubRemoteAuditor({ tokenProvider: provider(), fetch: async () => new Response(null, { status: 403 }) });
  await assert.rejects(failed(jobId), (error) => error.code === "github_api_response");
});

test("a token mint that exceeds the audit deadline refuses without a remote request", async () => {
  let remoteRequests = 0;
  const audit = createGitHubRemoteAuditor({
    timeoutMs: 20,
    tokenProvider: { getToken: () => new Promise(() => {}), invalidate: () => undefined },
    fetch: async () => { remoteRequests += 1; return Response.json([]); },
  });
  const startedAt = Date.now();
  await assert.rejects(audit(jobId), (error) => error.retryable === true);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(remoteRequests, 0);
});
