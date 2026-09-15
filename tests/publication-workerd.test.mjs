import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after } from "node:test";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const mainSha = "d".repeat(40);
const dataSha = "b".repeat(40);
const files = new Map(["event", "circles", "reference-records", "map"].map((name) =>
  [`/data/events/ch-20/${name}.json`, JSON.stringify({ id: "ch-20", name })]));
const digest = (text) => createHash("sha256").update(text).digest("hex");
const manifest = { schema: "publication-deployment/1", commit: mainSha,
  events: [{ eventId: "ch-20", dataCommit: dataSha }],
  files: [...files].map(([path, text]) => ({ path, sha256: digest(text) })) };
const bundle = await build({ bundle: true, format: "esm", write: false, stdin: {
  resolveDir: process.cwd(), contents: `
    import { verifyPublicationOrigin } from './app/publication-origin';
    import { readPublishedEventAtOrigin } from './app/publication-runtime';
    export default { async fetch(request) {
      try {
        const value = new URL(request.url).pathname === '/lookup'
          ? await readPublishedEventAtOrigin('ch-20')
          : await verifyPublicationOrigin(${JSON.stringify({ mainSha, dataSha, eventId: "ch-20", eventIds: ["ch-20"] })});
        return Response.json({ value });
      } catch (error) { return Response.json({ code: error.code, retryable: error.retryable }); }
    } };
  `,
} });
let redirectPath;
let seen = [];
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-22",
  // Actual workerd fetch validates RequestInit before this isolated origin stub.
  // No request in this suite can reach the internet.
  outboundService: async (request) => {
    const url = new URL(request.url);
    seen.push(url.href);
    assert.equal(url.origin, "https://tw-catalog.pages.dev");
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("cookie"), null);
    if (url.pathname === redirectPath) return new Response(null, { status: 302, headers: { location: "https://unexpected.example/" } });
    if (url.pathname === "/deployment-manifest.json") return Response.json(manifest);
    if (files.has(url.pathname)) return new Response(files.get(url.pathname));
    if (url.pathname === "/") return new Response("Reader", { headers: { "content-type": "text/html" } });
    if (url.pathname === "/api/auth/session") return new Response("anonymous", { status: 401 });
    assert.fail(`Unexpected origin path ${url.pathname}`);
  },
}));
after(() => runtime.dispose());

test("publication verifier and CREATE lookup run with actual workerd fetch", async () => {
  const proof = await (await runtime.dispatchFetch("http://localhost/verify")).json();
  assert.deepEqual(proof, { value: { manifestSha256: digest(JSON.stringify(manifest)) } });
  const lookup = await (await runtime.dispatchFetch("http://localhost/lookup")).json();
  assert.deepEqual(lookup, { value: { id: "ch-20", name: "event" } });
});

test("workerd refuses redirects at manifest, artifact, Reader, session and CREATE lookup", async () => {
  for (const [path, endpoint, code] of [
    ["/deployment-manifest.json", "/verify", "production_smoke_failed"],
    ["/data/events/ch-20/map.json", "/verify", "production_smoke_failed"],
    ["/", "/verify", "production_smoke_failed"],
    ["/api/auth/session", "/verify", "production_smoke_failed"],
    ["/data/events/ch-20/event.json", "/lookup", "published_collection_unavailable"],
  ]) {
    redirectPath = path;
    seen = [];
    const result = await (await runtime.dispatchFetch(`http://localhost${endpoint}`)).json();
    assert.deepEqual(result, { code, retryable: true }, path);
    assert.ok(seen.every((url) => new URL(url).origin === "https://tw-catalog.pages.dev"), "redirect target was never contacted");
  }
});
