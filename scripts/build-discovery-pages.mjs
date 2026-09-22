import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer, isRunnableDevEnvironment } from "vite";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const stage = JSON.parse(await readFile(resolve(root, ".event-data-stage.json"), "utf8"));
const entries = stage.events ?? [{ eventId: stage.eventId, source: stage.source }];
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite discovery environment is not runnable.");
  const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
  const { isCircleCatalogPayload } = await environment.runner.import("/app/circle-records.ts");
  const { discoveryPages, homepageSummary, metadataHtml, sitemapHtml } = await environment.runner.import("/app/static-discovery.ts");
  const { pageMetadata } = await environment.runner.import("/app/seo.ts");
  const paths = ["/"];
  const events = [];
  for (const { eventId } of entries) {
    // Staging has already validated exactly this published set before Vite builds.
    const data = resolve(dist, "data", "events", eventId);
    const read = async (file) => JSON.parse(await readFile(resolve(data, file), "utf8"));
    const event = parseEventDefinition(await read("event.json"), await read("reference-records.json"));
    const catalog = await read("circles.json");
    if (event.id !== eventId || !isCircleCatalogPayload(catalog)) throw new Error(`Invalid discovery input: ${eventId}`);
    events.push(event);
    for (const [path, html] of discoveryPages(event, catalog)) {
      const file = resolve(dist, `.${path}`, "index.html");
      if (!file.startsWith(dist + "/") && !file.startsWith(dist + "\\")) throw new Error("Discovery output escapes dist.");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      paths.push(path);
    }
  }
  const indexPath = resolve(dist, "index.html");
  const index = await readFile(indexPath, "utf8");
  // No static canonical on the shared Reader document: query links resolve in JS.
  const html = index.replace(/<title>[\s\S]*?<\/title>/, metadataHtml(pageMetadata(), false))
    .replace(/\s*<meta name="description"[^>]*\/>/, "")
    .replace('<div id="root"></div>', `<div id="root">${homepageSummary(events)}</div>`);
  await writeFile(indexPath, html);
  await writeFile(resolve(dist, "sitemap.xml"), sitemapHtml(paths));
  console.log(`Generated ${paths.length - 1} static discovery pages and sitemap.`);
} finally { await vite.close(); }
