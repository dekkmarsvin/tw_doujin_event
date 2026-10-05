import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer, isRunnableDevEnvironment } from "vite";

const root = resolve(import.meta.dirname, "..");

/** Canvas size from a WebP's VP8X header, which every animated WebP has. */
function webpSize(bytes, file) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`${file} is not a WebP.`);
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === "VP8L") { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  throw new Error(`${file} has no readable size.`);
}
const dist = resolve(root, "dist");
const stage = JSON.parse(await readFile(resolve(root, ".event-data-stage.json"), "utf8"));
const entries = stage.events ?? [{ eventId: stage.eventId, source: stage.source }];
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite discovery environment is not runnable.");
  const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
  const { isCircleCatalogPayload } = await environment.runner.import("/app/circle-records.ts");
  const { discoveryPages, homepageSummary, metadataHtml, PORTAL_DEMO_FILES, PORTAL_INTRO_PATH, portalIntroPage, sitemapHtml, websiteSchemaHtml } = await environment.runner.import("/app/static-discovery.ts");
  const { pageMetadata } = await environment.runner.import("/app/seo.ts");
  // Vite built the circle page's script from a template; its tags are all the
  // template is for. Every circle page carries them, and the template itself is
  // removed so it is never served as a page of its own.
  const templatePath = resolve(dist, "circle-page.html");
  const assetTags = (html) => [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g)].map(([tag]) => tag).join("");
  const circlePageAssets = assetTags(await readFile(templatePath, "utf8"));
  if (!/<script\b[^>]*type="module"/.test(circlePageAssets)) throw new Error("circle-page.html references no module script.");
  // Event introductions and /portal/ load only the interface-language script (#525).
  const publicTemplatePath = resolve(dist, "public-page.html");
  const pageAssets = assetTags(await readFile(publicTemplatePath, "utf8"));
  if (!/<script\b[^>]*type="module"/.test(pageAssets)) throw new Error("public-page.html references no module script.");
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
    for (const [path, html] of discoveryPages(event, catalog, { circlePageAssets, pageAssets })) {
      const file = resolve(dist, `.${path}`, "index.html");
      if (!file.startsWith(dist + "/") && !file.startsWith(dist + "\\")) throw new Error("Discovery output escapes dist.");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      paths.push(path);
    }
  }
  // The intro page's demos share one size, so the page reserves their space
  // before they load. A missing or mismatched file fails the build.
  const demoSizes = await Promise.all(PORTAL_DEMO_FILES.map(async (file) => webpSize(await readFile(resolve(dist, "portal", "media", file)), file)));
  if (new Set(demoSizes.map(({ width, height }) => `${width}x${height}`)).size !== 1) throw new Error("Portal demos must share one size.");
  await mkdir(resolve(dist, "portal"), { recursive: true });
  await writeFile(resolve(dist, "portal", "index.html"), portalIntroPage(demoSizes[0], { pageAssets }));
  paths.push(PORTAL_INTRO_PATH);
  const indexPath = resolve(dist, "index.html");
  const index = await readFile(indexPath, "utf8");
  // No static canonical on the shared Reader document: query links resolve in JS.
  const html = index.replace(/<title>[\s\S]*?<\/title>/, metadataHtml(pageMetadata(), false) + websiteSchemaHtml())
    .replace(/\s*<meta name="description"[^>]*\/>/, "")
    .replace('<div id="root"></div>', `<div id="root">${homepageSummary(events)}</div>`);
  await writeFile(indexPath, html);
  await writeFile(resolve(dist, "sitemap.xml"), sitemapHtml(paths));
  await rm(templatePath);
  await rm(publicTemplatePath);
  console.log(`Generated ${paths.length - 1} static discovery pages and sitemap.`);
} finally { await vite.close(); }
