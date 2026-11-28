import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
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
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite discovery environment is not runnable.");
  const { metadataHtml, PORTAL_DEMO_FILES, portalIntroPage, websiteSchemaHtml } = await environment.runner.import("/app/static-discovery.ts");
  const { accountHeaderAssets, publicHeaderHtml } = await environment.runner.import("/app/public-header.ts");
  const notFound = await readFile(resolve(root, "public", "404.html"), "utf8");
  await writeFile(resolve(dist, "404.html"), notFound.replace("</head>", accountHeaderAssets + "</head>").replace("<!-- public-header -->", publicHeaderHtml("/circle")));
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
  // Event and circle pages are built per request from the published data
  // (functions/events/[[path]].ts); they need these tags to load their scripts.
  await writeFile(resolve(dist, "discovery-assets.json"), `${JSON.stringify({ circlePageAssets, pageAssets })}\n`);
  // The intro page's demos share one size, so the page reserves their space
  // before they load. A missing or mismatched file fails the build.
  const demoSizes = await Promise.all(PORTAL_DEMO_FILES.map(async (file) => webpSize(await readFile(resolve(dist, "portal", "media", file)), file)));
  if (new Set(demoSizes.map(({ width, height }) => `${width}x${height}`)).size !== 1) throw new Error("Portal demos must share one size.");
  await mkdir(resolve(dist, "portal"), { recursive: true });
  await writeFile(resolve(dist, "portal", "index.html"), portalIntroPage(demoSizes[0], { pageAssets }));
  const indexPath = resolve(dist, "index.html");
  const index = await readFile(indexPath, "utf8");
  // No static canonical on the shared Reader document: query links resolve in JS.
  // The event summary inside #root is added per request with the published list.
  const html = index.replace(/<title>[\s\S]*?<\/title>/, metadataHtml(pageMetadata(), false) + websiteSchemaHtml())
    .replace(/\s*<meta name="description"[^>]*\/>/, "");
  await writeFile(indexPath, html);
  await rm(templatePath);
  await rm(publicTemplatePath);
  console.log("Wrote the portal introduction, homepage metadata and discovery asset tags.");
} finally { await vite.close(); }
