import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

// Event and circle introductions, the sitemap and the homepage summary are
// built per request from the published data (#546). Serve them the way a
// deployment does: the built site as ASSETS, the staged fixture as the bucket.
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { discoveryResponse, sitemapResponse } = await environment.runner.import("/functions/_discovery.ts");
const { withPublishedEvents } = await environment.runner.import("/functions/_published-events-html.ts");
export const closePublishedSite = () => vite.close();

const built = (path) => readFile(new URL(`../../dist/${path}`, import.meta.url), "utf8");
const stage = JSON.parse(await readFile(new URL("../../.event-data-stage.json", import.meta.url), "utf8"));
const files = ["circles.json", "event.json", "map.json", "reference-records.json"];
const objects = new Map([["index.json", JSON.stringify({ schema: "event-index/1", events: await Promise.all(stage.events.map(async ({ eventId }) => ({
  eventId, version: "1", files,
  definition: JSON.parse(await built(`data/events/${eventId}/event.json`)),
  references: JSON.parse(await built(`data/events/${eventId}/reference-records.json`)),
}))) })]]);
for (const { eventId } of stage.events) for (const file of files) objects.set(`events/${eventId}/1/${file}`, await built(`data/events/${eventId}/${file}`));
const env = {
  EVENT_DATA: { get: async (key) => objects.has(key) ? { text: async () => objects.get(key) } : null },
  ASSETS: { fetch: async (request) => new Response(await built(new URL(request.url).pathname.slice(1)), { headers: { "content-type": "text/html" } }) },
};
/** A built page as a deployment serves it, or a plain file from `dist`. */
export async function readPublished(path) {
  const request = new Request(`https://map.kotoban.top/${path.replace(/index\.html$/, "")}`);
  if (path === "sitemap.xml") return (await sitemapResponse(env, request)).text();
  if (path.startsWith("events/")) return (await discoveryResponse(env, request)).text();
  if (path === "index.html") return (await withPublishedEvents(env, "/", new Response(await built(path), { headers: { "content-type": "text/html" } }))).text();
  return built(path);
}
