import { PublicationFailure } from "./organizer-publication";
import { createGitHubPublicationAdapter } from "./github-publication";
import {
  createGitHubAppTokenProvider,
  type GitHubAppTokenProviderOptions,
  type GitHubTokenProvider,
} from "./github-app-token";

export const GITHUB_PROBE_OWNER = "dekkmarsvin";
export const GITHUB_PROBE_REPOSITORY = "tw_doujin_event-data";
export const GITHUB_PROBE_FULL_NAME = `${GITHUB_PROBE_OWNER}/${GITHUB_PROBE_REPOSITORY}`;

export type GitHubInstallationProbeOptions = {
  tokenProvider: GitHubTokenProvider;
  fetch?: typeof globalThis.fetch;
};

export type ConfiguredGitHubInstallationProbeOptions = Omit<GitHubAppTokenProviderOptions, "repositories" | "permissions"> & {
  /** Checked separately because the probe proves all production credentials are configured. */
  webhookSecret: string;
};

function configurationFailure() {
  return new PublicationFailure("github_app_config", "GitHub App authentication is not configured.", false);
}

function probeFailure() {
  return new PublicationFailure("github_probe_response", "GitHub installation probe response is invalid.", false);
}

/**
 * Uses only the token provider supplied by the server-side caller and reads
 * the one repository whose installation is part of the rollout contract.
 */
export async function probeGitHubInstallation(options: GitHubInstallationProbeOptions): Promise<{ ok: true }> {
  try {
    const adapter = createGitHubPublicationAdapter({
      owner: GITHUB_PROBE_OWNER,
      tokenProvider: options.tokenProvider,
      fetch: options.fetch,
    });
    const metadata = await adapter.readRepositoryMetadata(GITHUB_PROBE_REPOSITORY);
    if (!metadata || typeof metadata !== "object" || metadata.full_name !== GITHUB_PROBE_FULL_NAME) throw probeFailure();
    return { ok: true };
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    throw new PublicationFailure("github_probe", "GitHub installation probe failed.", true);
  }
}

/**
 * Builds the fixed-scope probe used by the admin route. The scope is kept here,
 * beside the fixed repository assertion, so an HTTP caller cannot widen it.
 */
export function createGitHubInstallationProbe(options: ConfiguredGitHubInstallationProbeOptions) {
  const tokenProvider = createGitHubAppTokenProvider({
    appId: options.appId,
    installationId: options.installationId,
    privateKey: options.privateKey,
    repositories: [GITHUB_PROBE_REPOSITORY],
    permissions: { metadata: "read" },
    fetch: options.fetch,
    now: options.now,
  });
  return async () => {
    if (typeof options.webhookSecret !== "string" || !options.webhookSecret.trim()) throw configurationFailure();
    return probeGitHubInstallation({ tokenProvider, fetch: options.fetch });
  };
}
