import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distUrl = new URL("../dist/", import.meta.url);

async function readDist(path) {
  return readFile(new URL(path, distUrl), "utf8");
}

test("ships an offline shell covering the venue-critical artifact", async () => {
  const worker = await readDist("sw.js");

  assert.doesNotMatch(worker, /__CACHE_VERSION__|__PRECACHE_MANIFEST__/);
  const version = worker.match(/const CACHE_VERSION = "([^"]+)";/);
  assert.ok(version, "the generated worker must carry a build version");
  assert.match(version[1], /^[0-9a-f]{12}$/);

  const manifest = JSON.parse(worker.match(/const PRECACHE_MANIFEST = (\[[^\]]*\]);/)[1]);
  for (const required of ["/index.html", "/manifest.webmanifest", "/data/events/ff47/circles.json", "/data/events/ff47/map.json", "/app-icon.svg"]) {
    assert.ok(manifest.includes(required), `precache manifest is missing ${required}`);
  }
  assert.ok(manifest.some((path) => /^\/assets\/index-.+\.js$/.test(path)), "the application script must be precached");
  assert.ok(manifest.some((path) => /^\/assets\/index-.+\.css$/.test(path)), "the application stylesheet must be precached");
  assert.ok(manifest.some((path) => path.startsWith("/fonts/")), "self-hosted fonts must be precached");

  // Every precached path must exist in the artifact that is about to deploy.
  await Promise.all(manifest.map(async (path) => {
    await assert.doesNotReject(readDist(`.${path}`), `precached ${path} is missing from dist`);
  }));

  // The catalog must never be pinned: a stale snapshot at the venue is worse
  // than a slightly slower one, so data revalidates while rendering from cache.
  assert.match(worker, /url\.pathname\.startsWith\("\/data\/events\/"\)/);
  assert.match(worker, /event\.respondWith\(staleWhileRevalidate\(request\)\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /event\.respondWith\(networkFirstNavigation\(request\)\)/);
  assert.doesNotMatch(worker, /\/api\//);

  // Vite emits a `crossorigin` bundle, so cached responses carry `Vary: Origin`
  // that the precache fetch never sent. Every read must ignore it or the whole
  // page fails offline.
  assert.match(worker, /const MATCH_OPTIONS = \{ ignoreVary: true \};/);

  // The data namespace is JSON only; a 200 HTML fallback must never be stored
  // there and then served offline as if it were the catalog.
  assert.match(worker, /function isJson\(response\)/);
  assert.match(worker, /if \(isStorable\(response\) && isJson\(response\)\) await cache\.put\(request, response\.clone\(\)\);/);
  const matchCalls = worker.match(/cache\.match\([^)]*\)/g) ?? [];
  assert.equal(matchCalls.length, 3, "every caching strategy must read through the cache exactly once");

  // An expired Cloudflare Access session or a captive portal answers with a 200
  // login page after a redirect. Storing one would replace the shell or the
  // catalog with it, so every cache write is gated on the response being ours.
  assert.match(worker, /function isStorable\(response\) \{\s*return response\.ok && !response\.redirected && response\.type === "basic";/);
  const putCalls = worker.match(/^.*cache\.put\(.*$/gm) ?? [];
  assert.equal(putCalls.length, 4, "the worker writes to the cache in exactly four places");
  for (const call of putCalls) assert.match(call, /isStorable\(response\)/, `cache write is not guarded: ${call.trim()}`);
  assert.doesNotMatch(worker, /if \(response\.ok\) await cache\.put/);
  for (const call of matchCalls) assert.match(call, /MATCH_OPTIONS/, `cache lookup ignores Vary: ${call}`);
});

test("registers the worker only for the built site and declares an installable app", async () => {
  const entry = await readFile(new URL("../main.tsx", import.meta.url), "utf8");
  assert.match(entry, /import\.meta\.env\.PROD && "serviceWorker" in navigator/);
  assert.match(entry, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);

  const html = await readDist("index.html");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/app-icon\.svg"/);

  const manifest = JSON.parse(await readDist("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/?source=installed");
  assert.equal(manifest.theme_color, "#f6f1e7");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));

  const headers = await readDist("_headers");
  assert.match(headers, /\/sw\.js\r?\n\s+Cache-Control: no-cache/);
  assert.match(headers, /worker-src 'self'/);
  assert.match(headers, /manifest-src 'self'/);
});
