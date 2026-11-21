import { isCircleCatalogPayload } from "../app/circle-records";
import { parseEventDefinition } from "../app/event-catalog";
import { discoveryPages, PORTAL_INTRO_PATH, sitemapHtml } from "../app/static-discovery";
import { readEntryJson, readEventIndex, type EventIndexEntry } from "./_event-data";
import { eventDataUnavailable } from "./_published-events-html";

type Assets = { circlePageAssets: string; pageAssets: string };

/**
 * Event and circle pages, built from the published data on request (#546).
 * Each version is built once per isolate: a publication changes the version,
 * so the next request builds the new pages.
 */
const pagesCache = new Map<string, Promise<Map<string, string>>>();
let assetsCache: Promise<Assets> | null = null;

function discoveryAssets(env: Pick<PortalEnv, "ASSETS">, request: Request): Promise<Assets> {
  assetsCache ??= (async () => {
    const response = await env.ASSETS.fetch(new Request(new URL("/discovery-assets.json", request.url)));
    if (!response.ok) throw new Error(`Discovery asset tags unavailable (${response.status}).`);
    return await response.json() as Assets;
  })().catch((error: unknown) => { assetsCache = null; throw error; });
  return assetsCache;
}

function eventPages(env: Pick<PortalEnv, "ASSETS" | "EVENT_DATA">, request: Request, entry: EventIndexEntry) {
  const key = `${entry.eventId}@${entry.version}`;
  let pending = pagesCache.get(key);
  if (!pending) {
    pending = (async () => {
      const [catalog, assets] = await Promise.all([readEntryJson(env, entry, "circles.json"), discoveryAssets(env, request)]);
      if (!isCircleCatalogPayload(catalog)) throw new Error(`Published ${entry.eventId} catalog is invalid.`);
      return discoveryPages(parseEventDefinition(entry.definition, entry.references), catalog, assets);
    })().catch((error: unknown) => { pagesCache.delete(key); throw error; });
    for (const stale of pagesCache.keys()) if (stale.startsWith(`${entry.eventId}@`)) pagesCache.delete(stale);
    pagesCache.set(key, pending);
  }
  return pending;
}

async function notFound(env: Pick<PortalEnv, "ASSETS">, request: Request) {
  const page = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
  return new Response(page.ok ? page.body : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** `GET /events/<eventId>/…` */
export async function discoveryResponse(env: Pick<PortalEnv, "ASSETS" | "EVENT_DATA">, request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/index\.html$/, "");
  const eventId = path.split("/")[2] ?? "";
  let pages: Map<string, string>;
  try {
    const entry = (await readEventIndex(env)).events.find((item) => item.eventId === eventId);
    if (!entry) return notFound(env, request);
    pages = await eventPages(env, request, entry);
  } catch (error) {
    return eventDataUnavailable(error);
  }
  const page = pages.get(path);
  if (page !== undefined) return new Response(request.method === "HEAD" ? null : page, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (!path.endsWith("/") && pages.has(`${path}/`)) return Response.redirect(new URL(`${path}/${url.search}`, url).toString(), 308);
  return notFound(env, request);
}

/** `GET /sitemap.xml`: the homepage, every published event's pages, the portal introduction. */
export async function sitemapResponse(env: Pick<PortalEnv, "ASSETS" | "EVENT_DATA">, request: Request) {
  const paths = ["/"];
  for (const entry of (await readEventIndex(env)).events) paths.push(...(await eventPages(env, request, entry)).keys());
  paths.push(PORTAL_INTRO_PATH);
  return new Response(sitemapHtml(paths), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
