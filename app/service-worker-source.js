/**
 * Public offline shell for the FF47 Pages site.
 *
 * The venue is a dense hall on congested mobile networks, so a reload there
 * must not cost the user their map. `scripts/build-service-worker.mjs` injects
 * the built asset list and a version derived from it, then writes `dist/sw.js`.
 *
 * Strategies:
 *   navigations    network-first, cached shell on failure
 *   /data/events   stale-while-revalidate — instant catalog, refreshed in place
 *   hashed assets  cache-first — the filename already carries the version
 */

const CACHE_VERSION = "__CACHE_VERSION__";
const PRECACHE_MANIFEST = ["__PRECACHE_MANIFEST__"];

const CACHE_NAME = `ff47-catalog-${CACHE_VERSION}`;
const SHELL_URL = "/index.html";
const NAVIGATION_TIMEOUT_MS = 3500;

/**
 * Entries are keyed by URL alone. Vite marks its bundle `crossorigin`, so the
 * browser sends an `Origin` header the precache fetch never had; honouring the
 * `Vary: Origin` on those responses would miss the cache and, offline, fail the
 * whole page.
 */
const MATCH_OPTIONS = { ignoreVary: true };

/**
 * A redirected response is not our artifact. An expired Cloudflare Access
 * session, a captive portal or a hotel wifi gateway all answer with a 200 login
 * page after a redirect; caching one would replace the shell or the catalog
 * with it and break the site offline. Serve it, never store it.
 */
function isStorable(response) {
  return response.ok && !response.redirected && response.type === "basic";
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fetch explicitly so one unavailable entry cannot fail the whole install.
    await Promise.all(PRECACHE_MANIFEST.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (isStorable(response)) await cache.put(url, response);
      } catch {
        // A missing entry degrades offline coverage; it must not block install.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (name.startsWith("ff47-catalog-") && name !== CACHE_NAME ? caches.delete(name) : undefined)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (isStorable(response)) await cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    return (await cache.match(SHELL_URL, MATCH_OPTIONS)) ?? Response.error();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Everything under `/data/events/` is JSON. A captive portal, an SPA fallback
 * or a preview server answering an unknown path with a 200 HTML page would
 * otherwise be stored under a data URL and served offline in its place.
 */
function isJson(response) {
  return (response.headers.get("content-type") ?? "").includes("json");
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, MATCH_OPTIONS);
  const network = fetch(request).then(async (response) => {
    if (isStorable(response) && isJson(response)) await cache.put(request, response.clone());
    return response;
  }).catch(() => undefined);
  if (cached) {
    // Refresh in the background; the current view renders from cache at once.
    return cached;
  }
  return (await network) ?? Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, MATCH_OPTIONS);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isStorable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/data/events/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(cacheFirst(request));
  }
});
