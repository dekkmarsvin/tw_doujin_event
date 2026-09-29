import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { selectedCircleShareImage, circleShareImageOptions } = await environment.runner.import("/app/circle-share-image.ts");
const { isCircleOverrideFields } = await environment.runner.import("/app/circle-overrides.ts");
const { rewriteCircleShareImage, applyCircleShareImage } = await environment.runner.import("/functions/_circle-share-image.ts");
const miniflare = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: "2026-04-01", script: `
  ${rewriteCircleShareImage.toString()}
  export default { async fetch(request) {
    const { image, html } = await request.json();
    return rewriteCircleShareImage(new Response(html, { headers: { "content-type": "text/html" } }), image);
  } };
` }));
after(async () => { await miniflare.dispose(); await vite.close(); });

const brand = "https://map.kotoban.top/share-card.png";
const thumbnail = { url: "https://pictures.test/representative.png", sourceUrl: "", provider: "" };
const pages = [1, 2].map(n => ({ url: `https://media.test/${n}.jpg`, previewUrl: `https://media.test/${n}-small.jpg`, width: 1800, height: 2500 }));

test("existing circles keep the brand card; choices come only from this circle's current media", () => {
  assert.equal(selectedCircleShareImage({ thumbnail, catalogImages: pages }).image.url, brand);
  assert.deepEqual(circleShareImageOptions({ thumbnail, catalogImages: pages }).map(option => option.label), ["場刊 Map 通用圖", "社團代表圖", "品書第 1 張", "品書第 2 張"]);
  assert.deepEqual(selectedCircleShareImage({ thumbnail, shareImage: "thumbnail" }).image, { url: thumbnail.url });
  assert.deepEqual(selectedCircleShareImage({ catalogImages: pages, shareImage: pages[1].url }).image, { url: pages[1].url, width: 1800, height: 2500 });
});

test("reordering retains the selected page; removed or foreign images fall back without fetching them", () => {
  assert.equal(selectedCircleShareImage({ catalogImages: [...pages].reverse(), shareImage: pages[1].url }).image.url, pages[1].url);
  for (const fields of [
    { thumbnail: null, shareImage: "thumbnail" },
    { catalogImages: [pages[0]], shareImage: pages[1].url },
    { thumbnail, catalogImages: pages, shareImage: "https://other.test/foreign.jpg" },
  ]) assert.equal(selectedCircleShareImage(fields).image.url, brand);
});

test("share settings use the existing bounded override validation", () => {
  for (const shareImage of ["brand", "thumbnail", pages[0].url]) assert.ok(isCircleOverrideFields({ shareImage }));
  for (const shareImage of [null, 1, {}, "", "javascript:alert(1)", "http://media.test/image.jpg"]) assert.equal(isCircleOverrideFields({ shareImage }), false);
});

test("real HTMLRewriter replaces the image, escapes attributes and removes unknown dimensions", async () => {
  const html = '<html><head><meta property="og:image" content="brand"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"></head><body><script>untouched()</script></body></html>';
  for (const image of [{ url: 'https://pictures.test/a?x="&y=<tag>' }, { url: pages[0].url, width: 1800, height: 2500 }]) {
    const response = await miniflare.dispatchFetch("https://example.test/", { method: "POST", body: JSON.stringify({ html, image }) });
    const result = await response.text();
    assert.match(result, /<script>untouched\(\)<\/script>/);
    if (image.width) {
      assert.match(result, /property="og:image:width" content="1800"/);
      assert.match(result, /property="og:image:height" content="2500"/);
    } else {
      assert.doesNotMatch(result, /property="og:image:(width|height)"/);
      assert.match(result, /&quot;/);
      assert.doesNotMatch(result, /content="https:\/\/pictures.test\/a\?x="/);
    }
  }
});

test("unrelated routes, redirects, errors and HEAD never read public identity data", async () => {
  for (const [path, method, status, type] of [
    ["/events/sample/", "GET", 200, "text/html"],
    ["/data/events/sample/circles.json", "GET", 200, "application/json"],
    ["/events/sample/circles/c-900001/", "HEAD", 200, "text/html"],
    ["/events/sample/circles/c-900001/", "GET", 404, "text/html"],
    ["/events/sample/circles/c-900001/", "GET", 301, "text/html"],
  ]) {
    const response = new Response(null, { status, headers: { "content-type": type } });
    const env = new Proxy({}, { get() { throw new Error("unexpected binding read"); } });
    assert.equal(await applyCircleShareImage({ request: new Request(`https://example.test${path}`, { method }), env }, response), response);
  }
});
