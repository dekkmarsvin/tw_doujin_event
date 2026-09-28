import runtimeVersion from "../db/identity-runtime-version.json" with { type: "json" };

/** Exercise initialization and a subsequent read against the deployed Function.
 * No fixture writes, auth cookies, or timing threshold: request counts are
 * verified in isolated D1 tests, while this proves deployment wiring/readiness.
 */
export async function verifyOverlayReadiness(baseUrl, eventId, { fetchImpl = fetch, headers = {} } = {}) {
  const url = new URL(`/data/events/${encodeURIComponent(eventId)}/overrides.json`, baseUrl);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, {
      redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { ...headers, accept: "application/json", "cache-control": "no-cache" },
    });
    if (response.status !== 200) throw new Error(`${eventId} overlay readiness returned ${response.status}.`);
    if (response.headers.get("x-identity-runtime-version") !== String(runtimeVersion.version)) {
      throw new Error(`${eventId} overlay does not confirm runtime version ${runtimeVersion.version}.`);
    }
    const doc = await response.json();
    if (doc.schema !== "circle-overrides/1" || doc.eventId !== eventId || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.overrides)) {
      throw new Error(`${eventId} overlay readiness returned an invalid document.`);
    }
  }
}
