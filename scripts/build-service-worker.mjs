/**
 * Emit `dist/sw.js` from `app/service-worker-source.js`, injecting the built
 * asset list and a version hash derived from it. Running after `vite build`
 * means the precache manifest always matches the artifact being deployed.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const sourcePath = resolve(root, "app", "service-worker-source.js");
const outputPath = resolve(dist, "sw.js");

/** Entries worth holding for a full offline session at the venue. */
/**
 * Everything except the reader's own code, which is resolved from index.html
 * instead. The build has a second entry (the circle portal) whose chunks share
 * the same `/assets/` directory; a glob would precache that portal for every
 * reader, and would break the moment Rollup renamed a chunk.
 */
const PRECACHE_PATTERNS = [
  /^\/index\.html$/,
  /^\/404\.html$/,
  /^\/manifest\.webmanifest$/,
  /^\/fonts\/.+\.(?:css|woff2)$/,
  /^\/data\/events\/.+\.json$/,
  /^\/(?:favicon|app-icon)\.svg$/,
];

/** Exactly the assets index.html loads, including any shared chunk. */
function readerAssets(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) return collect(full);
    return [`/${relative(dist, full).split(sep).join(posix.sep)}`];
  }));
  return nested.flat();
}

const distStat = await stat(dist).catch(() => undefined);
if (!distStat?.isDirectory()) throw new Error("Run the Pages build before generating the service worker.");

const files = await collect(dist);
const readerHtml = await readFile(resolve(dist, "index.html"), "utf8");
const reader = readerAssets(readerHtml);
const precache = [...new Set([
  ...files.filter((path) => PRECACHE_PATTERNS.some((pattern) => pattern.test(path))),
  ...reader,
])].sort();

const required = ["/index.html", "/manifest.webmanifest", "/data/events/ff47/circles.json", "/data/events/ff47/map.json"];
const missing = required.filter((path) => !precache.includes(path));
if (missing.length > 0) throw new Error(`The build is missing offline-critical files: ${missing.join(", ")}`);
if (!reader.some((path) => path.endsWith(".js"))) throw new Error("index.html references no application script to precache.");

const missingAssets = reader.filter((path) => !files.includes(path));
if (missingAssets.length > 0) throw new Error(`index.html references missing assets: ${missingAssets.join(", ")}`);

// The portal is a separate entry that readers never load; precaching it would
// push its bundle onto every visitor.
const portalHtml = await readFile(resolve(dist, "circle.html"), "utf8").catch(() => "");
const portalOnly = readerAssets(portalHtml).filter((path) => !reader.includes(path));
const leaked = precache.filter((path) => portalOnly.includes(path));
if (leaked.length > 0) throw new Error(`Refusing to precache circle-portal assets: ${leaked.join(", ")}`);

const source = await readFile(sourcePath, "utf8");
// Hash the strategies as well as the file list: a caching fix must retire the
// cache written by the logic it replaces.
const version = createHash("sha256").update(source).update("\n").update(precache.join("\n")).digest("hex").slice(0, 12);
const worker = source
  .replace('const CACHE_VERSION = "__CACHE_VERSION__";', `const CACHE_VERSION = ${JSON.stringify(version)};`)
  .replace('const PRECACHE_MANIFEST = ["__PRECACHE_MANIFEST__"];', `const PRECACHE_MANIFEST = ${JSON.stringify(precache)};`);

if (worker.includes("__CACHE_VERSION__") || worker.includes("__PRECACHE_MANIFEST__")) {
  throw new Error("The service worker template placeholders changed; update scripts/build-service-worker.mjs.");
}

await writeFile(outputPath, worker, "utf8");
console.log(`Generated dist/sw.js (${version}) precaching ${precache.length} files.`);
