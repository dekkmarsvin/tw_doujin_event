import assert from "node:assert/strict";
import { previewRequestInit } from "../scripts/preview-transport.mjs";
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
const organizerClient = await environment.runner.import("/app/organizer-client.ts");
const { adminLoginEntry, adminLoginDestination, notificationParameters } = await environment.runner.import("/app/notification-navigation.ts");
const { requestedEventId, guard } = await environment.runner.import("/functions/_portal.ts");
const { readAdminRoute, adminHref } = await environment.runner.import("/app/admin/admin-navigation.ts");

test("Admin precise routes take precedence over legacy event links while old destinations remain reachable", () => {
  const route = path => readAdminRoute(new URL(path, "https://example.test"));
  assert.equal(route("/admin").section, "overview");
  assert.equal(route("/admin?event=sample").view, "claims");
  assert.equal(route("/admin?section=events&view=maps&event=sample&draft=chosen").draft, "chosen");
  assert.equal(route("/admin?section=events&view=maps&event=sample").view, "maps");
  for (const [hash, section, view] of [["#overview", "overview", ""], ["#admin", "circles", "claims"], ["#map-review", "events", "maps"], ["#takedown", "circles", "search"], ["#accounts", "accounts", "admins"], ["#review-notifications", "notifications", ""]]) {
    const result = route(`/admin?event=sample${hash}`);
    assert.deepEqual([result.section, result.view, result.event], [section, view, "sample"]);
  }
  assert.equal(route("/admin?section=references").section, "data");
  assert.equal(route("/admin?section=events&view=list").unavailable, false);
  assert.equal(route("/admin?section=events").view, "list");
  assert.equal(route("/admin?section=events&view=unsupported").unavailable, true);
  const search = route(adminHref("circles", { view: "search", event: "sample", q: "測試社團" }));
  assert.equal(search.q, "測試社團");
  const account = route(adminHref("accounts", { view: "search", email: "user@example.test" }));
  assert.equal(account.view, "search");
  assert.equal(account.email, "user@example.test");
});
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

test("middleware and exception envelopes add circle codes while organizer errors retain their shape", async () => {
  for (const [headers, status, code] of [[{ "content-type": "application/json" }, 403, "origin_mismatch"], [{ origin: ORIGIN, "content-type": "text/plain" }, 415, "invalid_content_type"]]) {
    const response = await onRequest(context(request("POST", "/api/claims", headers)));
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    const organizer = await onRequest(context(request("POST", "/api/organizer/events", headers)));
    assert.equal(organizer.status, status); assert.equal((await organizer.json()).code, undefined);
  }
  for (const [message, status, code] of [["D1 unavailable", 503, "service_unavailable"], ["unexpected failure", 500, "server_error"]]) {
    const run = async () => { throw new Error(message); };
    const response = await guard(run, true);
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    assert.equal((await (await guard(run)).json()).code, undefined);
  }
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

test("multipart is admitted only for the same-origin private upload routes", async () => {
  for (const [method, path] of [
    ["POST", "/api/circle/ff47-demo/thumbnail"],
    ["POST", "/api/circle/ff47-demo/catalog-image"],
    ["POST", "/api/map-contributions/files"],
    ["PUT", "/api/organizer/events/candidate-a/maps/draft-a/background"],
  ]) {
    const accepted = await onRequest(context(request(method, path, {
      "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
    })));
    assert.equal(accepted.status, 200, `${method} ${path} must pass the shared gate`);
  }

  const wrongRoute = await onRequest(context(request("POST", "/api/claims", {
    "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
  })));
  assert.equal(wrongRoute.status, 415);
  // The allowance is per method as well as per path: nothing else about a map
  // draft may arrive as a form.
  const wrongMethod = await onRequest(context(request("POST", "/api/organizer/events/candidate-a/maps/draft-a/background", {
    "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
  })));
  assert.equal(wrongMethod.status, 415);
  const nested = await onRequest(context(request("POST", "/api/circle/ff47-demo/catalog-image/extra", {
    "content-type": "multipart/form-data; boundary=test", origin: ORIGIN,
  })));
  assert.equal(nested.status, 415, "only the exact upload paths take a form");
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

test("admin login continuation keeps supported destinations separate from circle selectors", async () => {
  const source = new URL(`${ORIGIN}/admin?section=circles&view=claims&event=sample-two&claim=claim-one&circle=c-900001&draft=map-one&q=北風&notifications=1#review-notifications`);
  const entry = new URL(adminLoginEntry(source), ORIGIN);
  assert.equal(entry.pathname, "/circle");
  assert.equal(entry.searchParams.has("event"), false);
  assert.equal(entry.searchParams.has("circle"), false);
  assert.equal(adminLoginDestination(entry.searchParams), `${source.pathname}${source.search}${source.hash}`);
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: { search: entry.search } };
    await client.requestLoginLink("admin@example.test", "solved");
    const body = JSON.parse(captured.at(-1).init.body);
    assert.equal(body.audience, "circle");
    assert.equal(adminLoginDestination(new URLSearchParams(body.destination)), `${source.pathname}${source.search}${source.hash}`);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("continuation rejects caller URLs and retains legacy admin notifications and event links", () => {
  assert.equal(adminLoginDestination(new URLSearchParams("event=sample&circle=c-900001&returnTo=https://evil.test")), null);
  const selectors = notificationParameters({ admin: "1", adminEvent: "sample", adminClaim: "//evil.test", adminSection: "/other", adminHash: "javascript:alert(1)", returnTo: "https://evil.test", event: "wrong", circle: "wrong", login: "secret" }, "circle");
  assert.equal(adminLoginDestination(selectors), "/admin?event=sample");
  for (const path of ["/admin?event=sample", "/admin#review-notifications", "/admin?section=events&view=list", "/admin?section=events&view=maps&event=sample&draft=map-one"]) {
    assert.equal(adminLoginDestination(new URL(adminLoginEntry(path), ORIGIN).searchParams), path);
  }
  assert.equal(notificationParameters({ admin: "1", adminSearch: "x".repeat(101) }, "circle").has("adminSearch"), false);
});

test("organizer login preserves an unselected application panel without relaxing identifiers", async () => {
  assert.equal(notificationParameters({ application: "", section: "review", admin: "1", adminEvent: "sample", candidate: "//evil.test" }, "organizer").toString(), "application=&section=review");
  assert.equal(notificationParameters({ application: "request-one" }, "organizer").get("application"), "request-one");
  assert.equal(notificationParameters({ application: "/other", candidate: "" }, "organizer").toString(), "");
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: { search: "?application" } };
    await client.requestLoginLink("organizer@example.test", "solved", "organizer");
    assert.deepEqual(JSON.parse(captured.at(-1).init.body).destination, { application: "" });
  } finally {
    globalThis.window = previousWindow;
  }
});

test("organizer member destinations survive emailed login with a fixed candidate selector", async () => {
  assert.equal(notificationParameters({ candidate: "candidate-one", section: "members", returnUrl: "https://evil.test", email: "other@example.test" }, "organizer").toString(), "candidate=candidate-one&section=members");
  assert.equal(notificationParameters({ candidate: "candidate-one", section: "other-panel" }, "organizer").toString(), "candidate=candidate-one");
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: { search: "?candidate=candidate-one&section=members" } };
    await client.requestLoginLink("organizer@example.test", "solved", "organizer");
    assert.deepEqual(JSON.parse(captured.at(-1).init.body).destination, { candidate: "candidate-one", section: "members" });
  } finally {
    globalThis.window = previousWindow;
  }
});

test("admin account email continuation is namespaced and uses existing email normalization", () => {
  const entry = new URL(adminLoginEntry(`${ORIGIN}/admin?section=accounts&view=search&email=USER%40Example.test`), ORIGIN);
  assert.equal(entry.searchParams.get("adminEmail"), "user@example.test");
  assert.equal(entry.searchParams.has("email"), false);
  assert.equal(adminLoginDestination(entry.searchParams), "/admin?section=accounts&view=search&email=user%40example.test");
  assert.equal(notificationParameters({ admin: "1", adminEmail: "//evil.test" }, "circle").has("adminEmail"), false);
  assert.equal(notificationParameters({ adminEmail: "user@example.test" }, "organizer").has("adminEmail"), false);
});

test("JSON and map background API refusals expire a session only on 401, even without JSON", async () => {
  const originalWindow = globalThis.window;
  const window = new EventTarget();
  globalThis.window = window;
  let expired = 0;
  window.addEventListener(client.SESSION_EXPIRED_EVENT, () => { expired += 1; });
  try {
    for (const run of [
      () => client.readSession(),
      () => organizerClient.listOrganizerEvents(),
      () => organizerClient.readOrganizerMapBackground("candidate-a", "draft-a"),
    ]) for (const status of [401, 403]) for (const body of ['{"error":"refused"}', "Unauthorized"]) {
      globalThis.fetch = async () => new Response(body, { status });
      expired = 0;
      await assert.rejects(run, error => error instanceof client.PortalError && error.status === status);
      assert.equal(expired, status === 401 ? 1 : 0, `${status}: ${body}`);
    }
    globalThis.fetch = async () => new Response(null, { status: 404 });
    expired = 0;
    assert.equal(await organizerClient.readOrganizerMapBackground("candidate-a", "draft-a"), null);
    assert.equal(expired, 0, "an absent background does not expire the session");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

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

  captured = [];
  await client.uploadMapContributionEvidence({
    draftId: "draft-a", revision: 1, file: new File(["x"], "map.png", { type: "image/png" }),
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25",
  });
  assert.equal(captured[0].init.headers["content-type"], undefined, "the browser must add the multipart boundary");
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
 * key the content type on having a body. Exercise the same transport used by
 * the journey and its cleanup against the actual gate.
 */
test("the preview E2E script shapes mutations the way the gate demands", async () => {
  for (const method of ["POST", "DELETE"]) {
    for (const body of [undefined, { runId: "run-test-123" }]) {
      const init = previewRequestInit(ORIGIN, { method, body, e2eToken: "test-token", cookie: "session=test",
        accessHeaders: { "cf-access-client-id": "service-id" } });
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers["x-preview-e2e-token"], "test-token");
      assert.equal(init.headers.cookie, "session=test");
      assert.equal(init.headers["cf-access-client-id"], "service-id");
      assert.equal(init.body, body === undefined ? undefined : JSON.stringify(body));
      const response = await onRequest(context(new Request(`${ORIGIN}/api/preview/mail`, init)));
      assert.equal(response.status, 200, `${method} shaped by the script must pass the gate`);
    }
  }
  for (const method of ["GET", "HEAD"]) {
    const init = previewRequestInit(ORIGIN, { method });
    assert.equal(init.headers["content-type"], undefined);
    assert.equal(init.headers.origin, undefined);
    assert.equal(init.headers["x-preview-e2e-token"], undefined);
    assert.equal((await onRequest(context(new Request(`${ORIGIN}/api/preview/mail`, init)))).status, 200);
  }
});

/**
 * #136 / ADR-0043. The session says who; the request has to say which event.
 * One place sets it, so no call site can forget and write into whichever event
 * the deployment happens to default to.
 */
test("every control-plane call names the event it operates on", async () => {
  try {
    client.setPortalEventId("ff48");
    await client.listMyClaims();
    assert.equal(captured[0].path, "/api/claims?event=ff48");

    captured = [];
    await client.searchCircles("社團");
    assert.match(captured[0].path, /^\/api\/circle\/search\?q=[^&]+&event=ff48$/, "a path that already has a query keeps it");

    captured = [];
    await client.saveOverride("c-000001", { saleInfo: "x" });
    assert.equal(captured[0].path, "/api/circle/c-000001/overrides?event=ff48");

    // Links the browser follows itself get the same scope as the fetches.
    assert.equal(client.withEventScope("/api/map-contributions/files/file-a"), "/api/map-contributions/files/file-a?event=ff48");
  } finally {
    client.setPortalEventId("");
  }
});

test("a client that names no event is left alone, which is the single-event deployment", async () => {
  client.setPortalEventId("");
  await client.listMyClaims();
  assert.equal(captured[0].path, "/api/claims");
});

test("admin account lookup and map grant actions remain global when another panel chose an event", async () => {
  try {
    client.setPortalEventId("ff48");
    await client.readAdminAccountDetail("target@example.com");
    assert.equal(captured[0].path, "/api/admin/accounts?email=target%40example.com");
    captured = [];
    await client.manageMapContributor("target@example.com", "grant");
    assert.equal(captured[0].path, "/api/admin/map-contributors");
    assert.deepEqual(JSON.parse(captured[0].init.body), { email: "target@example.com", action: "grant" });
  } finally { client.setPortalEventId(""); }
});

test("the admin review queue uses its local event filter and never inherits another panel's event", async () => {
  try {
    client.setPortalEventId("ff47");
    await client.listReviewQueue();
    assert.equal(captured[0].path, "/api/admin/review-queue");
    await client.listReviewQueue("ff48", "claim-later");
    assert.equal(captured[1].path, "/api/admin/review-queue?claim=claim-later&event=ff48");
  } finally {
    client.setPortalEventId("");
  }
});

test("admin map requests use their explicit event while contributor callers retain the page scope", async () => {
  try {
    client.setPortalEventId("ff47");
    for (const run of [
      () => client.listAdminMapDrafts("ff48"),
      () => client.readMapDraft("map-one", true, "ff48"),
      () => client.postMapDraftComment({ draftId: "map-one", body: "請確認攤位位置。" }, "ff48"),
      () => client.reviewMapContributionDraft({ draftId: "map-one", expectedRevision: 2, decision: "changes_requested" }, "ff48"),
      () => client.exportMapContributionCandidate("map-one", 2, "ff48"),
    ]) {
      captured = [];
      await run();
      assert.equal(new URL(captured[0].path, ORIGIN).searchParams.get("event"), "ff48");
    }
    captured = [];
    await client.readMapDraft("map-own");
    assert.equal(captured[0].path, "/api/map-contributions/drafts/map-own?event=ff47");
  } finally {
    client.setPortalEventId("");
  }
});

test("the server reads the event the request named, and never substitutes the default", () => {
  const env = { EVENT_ID: "ff47" };
  const named = (search) => requestedEventId(new Request(`${ORIGIN}/api/claims${search}`), env);

  assert.equal(named("?event=ff48"), "ff48");
  // No event named at all is the migration path: an older client, and a
  // single-event deployment, still reach the configured one.
  assert.equal(named(""), "ff47");
  assert.equal(named("?q=x"), "ff47");
  // Naming one badly is not the same as naming none. Falling back here would
  // run a write meant for one event against another; these resolve to an id no
  // deployment serves, which the handlers answer with a 404.
  assert.equal(named("?event="), "");
  assert.equal(named("?event=%20"), "");
  assert.equal(named("?event=../ff47"), "../ff47");
});
