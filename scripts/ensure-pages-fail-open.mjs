import path from "node:path";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";

async function cloudflareRequest(fetchImpl, url, token, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const messages = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare Pages project request failed with HTTP ${response.status}${messages ? `: ${messages}` : "."}`);
  }
  return body.result;
}

export async function ensurePagesFailOpen({ accountId, projectName, token, fetchImpl = fetch }) {
  if (!accountId || !projectName || !token) throw new Error("accountId, projectName and token are required.");
  const url = `${API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
  let project = await cloudflareRequest(fetchImpl, url, token);
  const configured = project?.deployment_configs?.production?.fail_open === true
    && project?.deployment_configs?.preview?.fail_open === true;
  if (!configured) {
    project = await cloudflareRequest(fetchImpl, url, token, {
      method: "PATCH",
      body: JSON.stringify({
        deployment_configs: {
          production: { fail_open: true },
          preview: { fail_open: true },
        },
      }),
    });
  }
  if (project?.deployment_configs?.production?.fail_open !== true
      || project?.deployment_configs?.preview?.fail_open !== true) {
    throw new Error("Cloudflare Pages did not confirm fail_open for both production and preview.");
  }
  return { changed: !configured };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await ensurePagesFailOpen({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    projectName: process.env.CLOUDFLARE_PAGES_PROJECT ?? "tw-catalog",
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  process.stdout.write(result.changed
    ? "Configured Pages Functions fail-open for production and preview.\n"
    : "Pages Functions fail-open is already configured for production and preview.\n");
}
