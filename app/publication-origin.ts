import { PublicationFailure } from "./organizer-publication";
import { sha256Hex } from "./portal-crypto";

export const PAGES_PRODUCTION_ORIGIN = "https://tw-catalog.pages.dev";
export const DEPLOYMENT_MANIFEST_PATH = "/deployment-manifest.json";
export type DeploymentManifest = { schema: "publication-deployment/1"; commit: string;
  events: Array<{ eventId: string; dataCommit: string }>;
  files: Array<{ path: string; sha256: string }> };

/** Exact deployed artifact bytes, including the already published events. */
export async function verifyPublicationOrigin(input: { mainSha: string; dataSha: string; eventId: string; eventIds: string[];
  fetch?: typeof globalThis.fetch }) {
  const requestFetch = input.fetch ?? globalThis.fetch;
  const read = async (path: string) => {
    const response = await requestFetch(`${PAGES_PRODUCTION_ORIGIN}${path}`, {
      // workerd accepts only follow/manual. Exact status checks reject redirects.
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (response.status !== 200) throw new Error("response");
    return response;
  };
  try {
    const text = await (await read(DEPLOYMENT_MANIFEST_PATH)).text();
    const manifest = JSON.parse(text) as DeploymentManifest;
    if (manifest.schema !== "publication-deployment/1" || manifest.commit !== input.mainSha
      || !Array.isArray(manifest.events) || !Array.isArray(manifest.files)
      || manifest.events.length !== input.eventIds.length
      || new Set(manifest.events.map((event) => event.eventId)).size !== input.eventIds.length
      || manifest.events.some((event) => !input.eventIds.includes(event.eventId) || !/^[0-9a-f]{40}$/.test(event.dataCommit))
      || !manifest.events.some((event) => event.eventId === input.eventId && event.dataCommit === input.dataSha)) throw new Error("identity");
    const paths = new Set<string>();
    for (const file of manifest.files) {
      if (!file || typeof file.path !== "string" || !/^\/data\/events\/[a-z0-9][a-z0-9-]*\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.json$/.test(file.path)
        || !input.eventIds.includes(file.path.split("/")[3]) || !/^[0-9a-f]{64}$/.test(file.sha256) || paths.has(file.path)) throw new Error("path");
      paths.add(file.path);
    }
    for (const id of input.eventIds) {
      for (const name of ["event.json", "circles.json", "reference-records.json"]) if (!paths.has(`/data/events/${id}/${name}`)) throw new Error("missing");
      if (!paths.has(`/data/events/${id}/map.json`) && !(paths.has(`/data/events/${id}/map-manifest.json`)
        && [...paths].some((path) => path.startsWith(`/data/events/${id}/maps/`)))) throw new Error("map");
    }
    // Bound concurrent origin requests; every listed artifact must match.
    for (let offset = 0; offset < manifest.files.length; offset += 4) {
      await Promise.all(manifest.files.slice(offset, offset + 4).map(async (file) => {
        const bytes = await (await read(file.path)).arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
        if (digest !== file.sha256) throw new Error("content");
      }));
    }
    const reader = await read(`/?event=${encodeURIComponent(input.eventId)}`);
    if (!(reader.headers.get("content-type") ?? "").includes("text/html")) throw new Error("reader");
    const session = await requestFetch(`${PAGES_PRODUCTION_ORIGIN}/api/auth/session`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (session.status !== 401) throw new Error("functions");
    // A deployment switching during verification cannot certify the old bytes.
    if (await (await read(DEPLOYMENT_MANIFEST_PATH)).text() !== text) throw new Error("deployment_changed");
    return { manifestSha256: await sha256Hex(text) };
  } catch { throw new PublicationFailure("production_smoke_failed", "Pages 正式來源的版本或活動檔案尚未通過驗證，請稍後重試。", true); }
}
