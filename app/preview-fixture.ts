/** Reserved identities for one remote preview test; never real mailboxes. */
export function previewFixture(runId: unknown) {
  if (typeof runId !== "string" || !/^[a-z0-9][a-z0-9-]{7,43}$/.test(runId)) return null;
  return {
    runId,
    adminEmail: `preview-admin+e2e-${runId}@example.test`,
    circleEmail: `preview-circle+e2e-${runId}@example.test`,
  };
}

const reservedAddress = /^(preview-admin|preview-circle)\+e2e-([a-z0-9][a-z0-9-]{7,43})@example\.test$/;

export function previewFixtureAddressBase(address: string) {
  const match = reservedAddress.exec(address);
  return match ? `${match[1]}@example.test` : null;
}

/** The run that owns a reserved address; null for every other address. */
export function previewFixtureRunId(address: string) {
  return reservedAddress.exec(address)?.[2] ?? null;
}

export function localPreviewResetAllowed(env: PortalEnv, request: Request) {
  const url = new URL(request.url);
  return env.LOCAL_PORTAL_DISPOSABLE === "true" && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}
