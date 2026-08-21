import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

/**
 * The two halves of one contract: the client shapes every mutating request, and
 * the middleware refuses anything that is not shaped that way. They were only
 * ever exercised together in a browser, so a bodyless DELETE that omitted the
 * content type reached production as a broken logout button.
 */

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { onRequest } = await environment.runner.import("/functions/_middleware.ts");
const client = await environment.runner.import("/app/circle-editor-client.ts");
after(() => vite.close());

const ORIGIN = "https://verify.kotoban.top";

/** Pass-through `next`, so a 200 means the gate allowed the request. */
function context(request) {
  return { request, next: async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }) };
}

function request(method, path, headers = {}) {
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD" && headers["content-type"]) init.body = "{}";
  return new Request(`${ORIGIN}${path}`, init);
}

test("reads pass through without an origin or a content type", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await onRequest(context(request(method, "/api/auth/session")));
    assert.equal(response.status, 200, `${method} must not be gated`);
  }
});

test("a mutating request must come from this origin", async () => {
  const missing = await onRequest(context(request("POST", "/api/claims", { "content-type": "application/json" })));
  assert.equal(missing.status, 403);

  const foreign = await onRequest(context(request("POST", "/api/claims", { "content-type": "application/json", origin: "https://evil.example" })));
  assert.equal(foreign.status, 403);

  const own = await onRequest(context(request("POST", "/api/claims", { "content-type": "application/json", origin: ORIGIN })));
  assert.equal(own.status, 200);
});

test("a mutating request must declare json, which no html form can send", async () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const response = await onRequest(context(request("POST", "/api/claims", { "content-type": contentType, origin: ORIGIN })));
    assert.equal(response.status, 415, `${contentType} must be refused`);
  }

  // A charset parameter is normal and must still be accepted.
  const withCharset = await onRequest(context(request("POST", "/api/claims", { "content-type": "application/json; charset=utf-8", origin: ORIGIN })));
  assert.equal(withCharset.status, 200);
});

test("multipart is admitted only for the same-origin thumbnail upload route", async () => {
  const accepted = await onRequest(context(request("POST", "/api/circle/ff47-demo/thumbnail", {
    "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
  })));
  assert.equal(accepted.status, 200);

  const wrongRoute = await onRequest(context(request("POST", "/api/claims", {
    "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
  })));
  assert.equal(wrongRoute.status, 415);
  const foreign = await onRequest(context(request("POST", "/api/circle/ff47-demo/thumbnail", {
    "content-type": "multipart/form-data; boundary=test", origin: "https://evil.example",
  })));
  assert.equal(foreign.status, 403);
});

test("a bodyless DELETE is allowed when it declares json", async () => {
  // This is the logout path. It carries no body, so a rule keyed on "has a
  // body" would have let it through untyped and a rule keyed on the header
  // rejects it unless the client sets one.
  const response = await onRequest(context(new Request(`${ORIGIN}/api/auth/session`, {
    method: "DELETE",
    headers: { origin: ORIGIN, "content-type": "application/json" },
  })));
  assert.equal(response.status, 200);

  const untyped = await onRequest(context(new Request(`${ORIGIN}/api/auth/session`, {
    method: "DELETE",
    headers: { origin: ORIGIN },
  })));
  assert.equal(untyped.status, 415);
});

test("identity responses are never stored by a cache", async () => {
  const api = await onRequest(context(request("GET", "/api/auth/session")));
  assert.equal(api.headers.get("cache-control"), "no-store");
  assert.equal(api.headers.get("x-content-type-options"), "nosniff");

  // The public overlay sets its own cacheable headers and must keep them.
  const data = await onRequest({
    request: request("GET", "/data/events/ff47/overrides.json"),
    next: async () => new Response("{}", { headers: { "cache-control": "public, max-age=60, must-revalidate" } }),
  });
  assert.equal(data.headers.get("cache-control"), "public, max-age=60, must-revalidate");
});

let captured = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  globalThis.fetch = async (path, init) => {
    captured.push({ path, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
});

after(() => { globalThis.fetch = originalFetch; });

test("the client declares json on every mutation, including bodyless ones", async () => {
  await client.signOut();
  const [logout] = captured;
  assert.equal(logout.init.method, "DELETE");
  assert.equal(logout.init.body, undefined, "logout carries no body");
  assert.equal(logout.init.headers["content-type"], "application/json", "and must still declare json");

  captured = [];
  await client.saveOverride("ff47-a", { saleInfo: "x" });
  assert.equal(captured[0].init.headers["content-type"], "application/json");

  captured = [];
  await client.manageAdmin("a@b.co", "add");
  assert.equal(captured[0].init.headers["content-type"], "application/json");
});

test("the client never declares a content type on a read", async () => {
  await client.readSession();
  assert.equal(captured[0].init.headers["content-type"], undefined);
  assert.equal(captured[0].init.headers.accept, "application/json");
});

test("every client call sends the session cookie", async () => {
  for (const run of [() => client.readSession(), () => client.listMyClaims(), () => client.signOut(), () => client.listAdmins()]) {
    captured = [];
    await run();
    assert.equal(captured[0].init.credentials, "same-origin");
  }
});

/**
 * The E2E script is the third party to this contract, and the one with no
 * browser filling in the blanks: it must state `Origin` itself, and it cannot
 * key the content type on having a body, because its first call is a bodyless
 * DELETE. It got both wrong and nobody noticed for weeks — the job that runs it
 * was skipped on every PR, so the script had never actually executed.
 *
 * Checked at the source level: the script runs the whole flow on import against
 * a live preview host, so a test cannot call into it. The headers it builds are
 * then replayed through the real middleware below, which is the part that
 * matters — agreement with the gate, not the presence of a string.
 */
test("the preview E2E script shapes mutations the way the gate demands", async () => {
  const source = await readFile(new URL("../scripts/preview-portal-e2e.mjs", import.meta.url), "utf8");

  const headerBlock = source.match(/const MUTATION_HEADERS = (\{[^}]*\});/)?.[1];
  assert.ok(headerBlock, "the script must build its mutation headers in one named place");
  // `new URL(baseUrl).origin` cannot be evaluated here; the assertion is that
  // whatever it resolves to is sent as `origin`, so substitute this test's.
  const headers = Object.fromEntries(
    [...headerBlock.matchAll(/(?:"([^"]+)"|([a-z-]+)):\s*(?:"([^"]+)"|[^,}]+)/g)]
      .map((match) => [match[1] ?? match[2], match[3] ?? ORIGIN]),
  );

  assert.deepEqual(Object.keys(headers).sort(), ["content-type", "origin"]);
  assert.equal(headers["content-type"], "application/json");

  // The gate itself is the judge.
  for (const method of ["POST", "DELETE"]) {
    const response = await onRequest(context(request(method, "/api/preview/mail", headers)));
    assert.equal(response.status, 200, `${method} shaped by the script must pass the gate`);
  }

  // And the reads must stay unshaped, or the script would send a content type
  // on a GET the client is tested never to send one on.
  assert.match(source, /method === "GET" \|\| method === "HEAD" \? \{\} : MUTATION_HEADERS/);
});
