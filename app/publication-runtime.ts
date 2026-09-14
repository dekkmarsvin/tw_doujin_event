import { createGitHubAppTokenProvider } from "./github-app-token";
import { createGitHubPublicationDriver } from "./github-publication-driver";
import { GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import { PublicationFailure } from "./organizer-publication";
import { createGitHubPublicationDeployment } from "./github-publication-deployment";
import { PAGES_PRODUCTION_ORIGIN } from "./publication-origin";
export { PAGES_PRODUCTION_ORIGIN } from "./publication-origin";

type Credentials = Pick<PortalEnv, "GITHUB_APP_ID" | "GITHUB_APP_INSTALLATION_ID" | "GITHUB_APP_PRIVATE_KEY">;

export function createRuntimePublicationDriver(env: Credentials, publishedEvent: (id: string) => Promise<unknown | null>) {
  const tokenProvider = createGitHubAppTokenProvider({
    appId: env.GITHUB_APP_ID ?? "", installationId: env.GITHUB_APP_INSTALLATION_ID ?? "", privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "",
    repositories: GITHUB_PUBLICATION_REPOSITORIES,
    permissions: { contents: "write", pull_requests: "write", checks: "write", actions: "write", metadata: "read" }, now: Date.now,
  });
  return createGitHubPublicationDriver({ publishedEvent, tokenProvider, deployment: createGitHubPublicationDeployment({ tokenProvider }) });
}

/** Cron has no ASSETS binding; query the fixed public origin without cookies. */
export async function readPublishedEventAtOrigin(id: string, requestFetch = globalThis.fetch) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new PublicationFailure("publication_identity", "活動識別無效。", false);
  try {
    const response = await requestFetch(`${PAGES_PRODUCTION_ORIGIN}/data/events/${id}/event.json`, { redirect: "error", signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("unavailable");
    const event = await response.json() as { id?: unknown };
    if (event?.id !== id) throw new Error("mismatch");
    return event;
  } catch { throw new PublicationFailure("published_collection_unavailable", "目前無法確認 Pages 已發布活動。", true); }
}
