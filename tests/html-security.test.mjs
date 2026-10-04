import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { onRequest } = await environment.runner.import("/functions/_middleware.ts");
const { htmlPolicy } = await environment.runner.import("/functions/_html-security.ts");
after(() => vite.close());
const nonceOf = response => response.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
const body = '<script src="/assets/app.js"></script><script>untrusted()</script>';
const html = () => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", etag: '"asset"', "last-modified": "Mon, 28 Sep 2026 00:00:00 GMT", "cache-control": "public, max-age=300" } });

test("HTML responses get unique nonces without authorizing arbitrary inline scripts", async () => {
  const replies = [];
  for (const path of ["/", "/", "/circle", "/organizer.html", "/admin", "/events/example/", "/privacy/", "/s/example"]) {
    const response = await onRequest({ request: new Request(`https://example.com${path}`), next: async () => html() });
    const nonce = nonceOf(response);
    assert.equal(Buffer.from(nonce, "base64").length, 32);
    assert.equal(response.headers.get("content-security-policy"), htmlPolicy(path, nonce));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("last-modified"), null);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(await response.text(), body);
    if (/^\/(circle|organizer|admin)/.test(path)) assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    replies.push(nonce);
  }
  assert.equal(new Set(replies).size, replies.length);
});

test("dynamic policy preserves all three static policies apart from its nonce", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const policies = [...headers.matchAll(/Content-Security-Policy: ([^\r\n]+)/g)].map(m => m[1]);
  assert.deepEqual(["/", "/circle", "/organizer"].map(path => htmlPolicy(path)), policies);
});

test("conditional and range HTML requests fetch a complete document; HEAD stays bodyless", async () => {
  for (const method of ["GET", "HEAD"]) {
    const request = new Request("https://example.com/", { method, headers: { "if-none-match": '"asset"', "if-modified-since": "yesterday", range: "bytes=0-8", "if-range": '"asset"' } });
    const response = await onRequest({ request, next: async forwarded => {
      for (const h of ["if-none-match", "if-modified-since", "range", "if-range"]) assert.equal(forwarded.headers.get(h), null);
      assert.equal(forwarded.method, method);
      return method === "HEAD" ? new Response(null, { headers: { "content-type": "text/html" } }) : html();
    } });
    assert.equal(response.status, 200);
    assert.ok(nonceOf(response));
    if (method === "HEAD") assert.equal(await response.text(), "");
  }
});

test("API preview sandbox, JSON validators, redirects and CSRF gate are preserved", async () => {
  for (const path of ["/api/organizer/events/id/image", "/data/events/sample/overrides.json"]) {
    const original = new Response("image or json", { headers: { "content-type": "application/json", "content-security-policy": "default-src 'none'; sandbox", etag: '"v1"' } });
    const result = await onRequest({ request: new Request(`https://example.com${path}`), next: async () => original });
    assert.equal(result.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(result.headers.get("etag"), '"v1"');
  }
  const redirect = Response.redirect("https://example.com/privacy/", 301);
  assert.equal(await onRequest({ request: new Request("https://example.com/privacy"), next: async () => redirect }), redirect);
  const denied = await onRequest({ request: new Request("https://example.com/api/account", { method: "DELETE" }), next: () => { throw new Error("CSRF bypass"); } });
  assert.equal(denied.status, 403);
});

test("Pages routing includes HTML and existing APIs but bypasses bulk static assets", async () => {
  const routes = JSON.parse(await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"));
  const matches = (pattern, path) => new RegExp(`^${pattern.split("*").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(path);
  const invokes = path => routes.include.some(p => matches(p, path)) && !routes.exclude.some(p => matches(p, path));
  for (const path of ["/", "/index.html", "/circle.html", "/organizer", "/admin", "/privacy/", "/portal/", "/events/example/circles/id/", "/s/example", "/api/shares/example", "/api/auth/session", "/data/events/example/overrides.json"]) assert.equal(invokes(path), true, path);
  for (const path of ["/assets/app.js", "/fonts/geist.woff2", "/data/events/example/circles.json", "/data/events/example/maps/day1.json", "/sw.js", "/manifest.webmanifest", "/share-card.png", "/sitemap.xml", "/portal/media/circle-editor.webp"]) assert.equal(invokes(path), false, path);
});
