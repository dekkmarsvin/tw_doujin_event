import { eventUsesScopedMaps, getPublishedEvent } from "./event-catalog";
import { parseEventMapManifest } from "./event-map-manifest";
import type { EventDayKey } from "./planning-store";

/** One published event day and, for a multi-space event, its chosen venue space. */
export type OfflineScope = { eventId: string; day: EventDayKey; venueSpaceId?: string };

/** Verified cache coverage; missing also includes a manifest whose scope cannot be resolved. */
export type OfflineStatus = { state: "unsupported" | "ready" | "missing"; required: string[]; missing: string[];
  /** Multiple worker versions hide the usable cache; reload before checking or preparing. */
  ambiguousCache?: boolean;
};

const CACHE_PREFIX = "event-catalog-";
const MATCH_OPTIONS = { ignoreVary: true };
const ASSET_SELECTOR = 'script[src], link[rel="stylesheet"], link[rel="modulepreload"]';

function supported() {
  return typeof caches !== "undefined" && typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
}

async function workerCacheNames() {
  try { return (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX)); }
  catch { return []; }
}

async function cachedResponse(path: string, names: string[]) {
  if (names.length !== 1) return undefined;
  for (const name of names) {
    try {
      const response = await (await caches.open(name)).match(path, MATCH_OPTIONS);
      if (response && accepts(new URL(path, location.origin).pathname, response)) return response;
    } catch { /* An unreadable cache is not evidence of offline coverage. */ }
  }
  return undefined;
}

function accepts(path: string, response: Response) {
  if (!response.ok || response.redirected || response.type !== "basic") return false;
  const contentType = response.headers.get("content-type") ?? "";
  if (path.startsWith("/data/events/")) return contentType.includes("json");
  if (path === "/index.html") return contentType.includes("text/html");
  if (path.endsWith(".css")) return contentType.includes("text/css");
  return contentType.includes("javascript") || contentType.includes("ecmascript");
}

async function resolveRequirements(scope: OfflineScope) {
  const event = getPublishedEvent(scope.eventId);
  if (!event || !event.days.some(({ id }) => String(id) === String(scope.day))) {
    throw new Error("Offline scope must name a published event day.");
  }
  const venueSpaceId = scope.venueSpaceId ?? (event.venueAssignments.length === 1 ? event.venueAssignments[0].venueSpaceId : undefined);
  if (!event.venueAssignments.some((assignment) => assignment.venueSpaceId === venueSpaceId)) {
    throw new Error("Offline scope must select an event venue space.");
  }
  const required = new Set(["/index.html"]);
  for (const element of document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(ASSET_SELECTOR)) {
    const source = element.getAttribute("src") ?? element.getAttribute("href");
    if (!source) continue;
    const url = new URL(source, document.baseURI);
    if (url.origin === location.origin && url.pathname.startsWith("/assets/")) required.add(url.pathname + url.search);
  }
  const base = `/data/events/${encodeURIComponent(event.id)}`;
  required.add(`${base}/circles.json`);
  if (!eventUsesScopedMaps(event)) {
    required.add(`${base}/map.json`);
    return { required: [...required], unresolved: [] as string[] };
  }

  const manifestPath = `${base}/map-manifest.json`;
  required.add(manifestPath);
  try {
    const cached = typeof caches === "undefined" ? undefined : await cachedResponse(manifestPath, await workerCacheNames());
    let response: Response;
    try {
      response = cached ?? await fetch(manifestPath, { headers: { accept: "application/json" } });
      if (response.type === "error") throw new TypeError("Failed to fetch map manifest.");
    } catch (error) {
      if (event.venueAssignments.length !== 1) throw error;
      // Match the Reader's network-error fallback, but require a usable shared
      // artifact before replacing the unresolved manifest requirement.
      const mapPath = `${base}/map.json`;
      const map = await cachedResponse(mapPath, await workerCacheNames())
        ?? await fetch(mapPath, { headers: { accept: "application/json" } });
      if (!accepts(mapPath, map)) throw new Error("Shared map response is not an artifact.");
      required.delete(manifestPath);
      required.add(mapPath);
      return { required: [...required], unresolved: [] as string[] };
    }
    // A reachable manifest still selects the shared map only on an actual 404.
    if (response.status === 404) {
      required.delete(manifestPath);
      required.add(`${base}/map.json`);
    } else {
      if (!accepts(manifestPath, response)) throw new Error("Map manifest response is not an artifact.");
      const manifest = parseEventMapManifest(await response.json(), event.id);
      const entry = manifest.maps.find((map) => map.periodKey === String(scope.day) && map.venueSpaceId === venueSpaceId);
      if (!entry) throw new Error("Map manifest has no map for the offline scope.");
      required.add(`${base}/${entry.path.split("/").map(encodeURIComponent).join("/")}`);
    }
    return { required: [...required], unresolved: [] as string[] };
  } catch {
    // Do not call a partial list ready when the manifest cannot tell us which map is needed.
    return { required: [...required], unresolved: [manifestPath] };
  }
}

/** List same-origin Reader shell/assets, official catalog and this scope's resolved map.
 * Rejects if the manifest cannot resolve the map; never includes overlays or external images.
 */
export async function offlineRequirements(scope: OfflineScope): Promise<string[]> {
  const { required, unresolved } = await resolveRequirements(scope);
  if (unresolved.length) throw new Error(`Cannot resolve offline map requirements: ${unresolved.join(", ")}`);
  return required;
}

/** Check guarded entries in event-catalog caches, ignoring Vary like the worker.
 * Unsupported environments return empty lists without requesting resources.
 */
export async function checkOfflineReadiness(scope: OfflineScope): Promise<OfflineStatus> {
  if (!supported()) return { state: "unsupported", required: [], missing: [] };
  const { required, unresolved } = await resolveRequirements(scope);
  const names = await workerCacheNames();
  if (names.length > 1) return { state: "missing", required, missing: required, ambiguousCache: true };
  const missing: string[] = [];
  for (const path of required) {
    if (unresolved.includes(path) || !await cachedResponse(path, names)) missing.push(path);
  }
  return { state: missing.length ? "missing" : "ready", required, missing };
}

/** Repair missing artifacts with guarded reload fetches, then report the verified result.
 * Progress counts attempted missing URLs; its total can grow after repairing a manifest.
 * Writes only when one worker cache exists: the worker exposes no active-cache identifier.
 */
export async function prepareOffline(scope: OfflineScope, onProgress?: (done: number, total: number) => void): Promise<OfflineStatus & { failed: string[] }> {
  let status = await checkOfflineReadiness(scope);
  if (status.state === "unsupported") return { ...status, failed: [] };
  if (status.ambiguousCache) return { ...status, failed: status.missing };
  const attempted = new Set<string>();
  const failed = new Set<string>();
  let pending = status.missing;
  onProgress?.(0, pending.length);
  const names = await workerCacheNames();
  // Activation removes older versions. During an install, multiple versions can
  // coexist; choosing one by ordering or creating a new cache would guess wrong.
  if (pending.length && names.length !== 1) {
    return { ...await checkOfflineReadiness(scope), failed: pending };
  }
  let cache: Cache | undefined;
  if (pending.length) {
    try { cache = await caches.open(names[0]); }
    catch { return { ...await checkOfflineReadiness(scope), failed: pending }; }
  }
  while (pending.length) {
    const total = attempted.size + pending.length;
    for (const path of pending) {
      attempted.add(path);
      try {
        // cacheFirst ignores Request.cache: an old HTML fallback would otherwise
        // be returned again instead of repaired. Remove only this rejected entry.
        const existing = await cache!.match(path, MATCH_OPTIONS);
        if (existing) await cache!.delete(path, MATCH_OPTIONS);
        const response = await fetch(path, { cache: "reload" });
        // Use the pathname for MIME classification while preserving query cache keys.
        if (!accepts(new URL(path, location.origin).pathname, response)) throw new Error("Response is not an offline artifact.");
        await cache!.put(path, response);
      } catch { failed.add(path); }
      onProgress?.(attempted.size, total);
    }
    status = await checkOfflineReadiness(scope);
    // A repaired manifest may reveal a map that was not knowable in the first check.
    pending = status.missing.filter((path) => !attempted.has(path));
    if (pending.length) onProgress?.(attempted.size, attempted.size + pending.length);
  }
  status = await checkOfflineReadiness(scope);
  return { ...status, failed: [...new Set([...failed, ...status.missing])] };
}
