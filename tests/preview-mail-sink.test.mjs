import assert from "node:assert/strict";
import test, { after } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { portalHandlers, previewE2eAuthorized, previewMailRouteFor, previewSinkRecipientAllowed, repositoryFor } = await environment.runner.import("/functions/_portal.ts");
const { onRequestDelete, onRequestGet } = await environment.runner.import("/functions/api/preview/mail.ts");
const { SESSION_COOKIE } = await environment.runner.import("/app/circle-portal-handlers.ts");
const { hmacSign } = await environment.runner.import("/app/portal-crypto.ts");
const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "preview-mail-route-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const previewObjects = new Set(["events/ff47/circles/c-000001/published.webp", "events/ff47/circles/c-000001/draft.png"]);
const mapContributionObjects = new Set(["events/ff47/map-drafts/draft-1/file-1/source.png"]);

const env = {
  PREVIEW_MAIL_SINK: "d1",
  LOCAL_PORTAL_DISPOSABLE: "true",
  PREVIEW_TEST_RECIPIENTS: "preview-admin@example.test, preview-circle@example.test",
  PREVIEW_SANDBOX_RECIPIENTS: "maintainer@example.com",
  PREVIEW_E2E_TOKEN: "a-private-preview-token",
  ADMIN_EMAILS: "preview-admin@example.test",
  DB: database,
  THUMBNAILS: {
    list: async () => ({ objects: [...previewObjects].map((key) => ({ key })), truncated: false }),
    delete: async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => previewObjects.delete(key)); },
  },
  MAP_CONTRIBUTIONS: {
    list: async () => ({ objects: [...mapContributionObjects].map((key) => ({ key })), truncated: false }),
    delete: async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => mapContributionObjects.delete(key)); },
  },
};

test("preview mail sink accepts only explicit test recipients", () => {
  assert.equal(previewSinkRecipientAllowed(env, "PREVIEW-ADMIN@example.test"), true);
  assert.equal(previewSinkRecipientAllowed(env, "preview-circle@example.test"), true);
  assert.equal(previewSinkRecipientAllowed(env, "real-user@example.com"), false);
  assert.equal(previewSinkRecipientAllowed({ ...env, PREVIEW_MAIL_SINK: undefined }, "preview-admin@example.test"), false);
});

test("preview picks a mailbox by recipient, and refuses the addresses on neither list", () => {
  // The two lists are what keeps CI and a human out of each other’s way on
  // the same deployment: the E2E driver only ever signs in as a .test
  // address, so adding a real inbox cannot change what CI observes.
  assert.equal(previewMailRouteFor(env, "preview-circle@example.test"), "sink");
  assert.equal(previewMailRouteFor(env, " Maintainer@Example.com "), "sandbox");
  assert.equal(previewMailRouteFor(env, "someone-else@example.com"), null);
  assert.equal(previewMailRouteFor({ ...env, PREVIEW_MAIL_SINK: undefined }, "maintainer@example.com"), null);

  // Sandbox mail is delivered, never captured, so there is nothing for the
  // E2E reader to hand back for that address.
  assert.equal(previewSinkRecipientAllowed(env, "maintainer@example.com"), false);
});

test("mail retrieval requires the separate preview token and hides when disabled", () => {
  const request = (token) => new Request("https://preview.example/api/preview/mail", { headers: token ? { "x-preview-e2e-token": token } : {} });
  assert.equal(previewE2eAuthorized(env, request("a-private-preview-token")), true);
  assert.equal(previewE2eAuthorized(env, request("a-private-preview-tokee")), false);
  assert.equal(previewE2eAuthorized(env, request()), false);
  assert.equal(previewE2eAuthorized({ ...env, PREVIEW_MAIL_SINK: undefined }, request("a-private-preview-token")), false);
});

test("preview route reads and clears captured mail only with its dedicated token", async () => {
  const repository = repositoryFor(env);
  await repository.storePreviewMail({ email: "preview-circle@example.test", subject: "login", text: "one-time link", now: 1_786_500_000_000 });

  const authorized = new Request("https://preview.example/api/preview/mail?email=preview-circle%40example.test", {
    headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN },
  });
  const read = await onRequestGet({ request: authorized, env });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).message.text, "one-time link");

  const hidden = await onRequestGet({ request: new Request(authorized.url), env });
  assert.equal(hidden.status, 404);

  const cleared = await onRequestDelete({ request: new Request("http://127.0.0.1/api/preview/mail", {
    method: "DELETE",
    headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN },
  }), env });
  assert.equal(cleared.status, 200);
  assert.deepEqual([...previewObjects], [], "preview reset removes published and staged-only objects");
  assert.deepEqual([...mapContributionObjects], [], "preview reset removes private map-contribution evidence");
  assert.equal(await repository.latestPreviewMail("preview-circle@example.test"), null);
  assert.equal(await repository.isAdminEmail("preview-admin@example.test"), true);
});

test("preview reset fails before deleting anything when private map storage is missing", async () => {
  previewObjects.add("events/ff47/circles/c-000001/keep.png");
  await repositoryFor(env).storePreviewMail({ email: "preview-circle@example.test", subject: "login", text: "keep", now: 1_786_500_000_001 });
  const response = await onRequestDelete({
    request: new Request("http://127.0.0.1/api/preview/mail", {
      method: "DELETE", headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN },
    }),
    env: { ...env, MAP_CONTRIBUTIONS: undefined },
  });
  assert.equal(response.status, 503);
  assert.deepEqual([...previewObjects], ["events/ff47/circles/c-000001/keep.png"]);
  assert.equal((await repositoryFor(env).latestPreviewMail("preview-circle@example.test")).text, "keep");
  previewObjects.clear();
});

for (const scenario of ["sink", "sandbox", "denied", "production", "sandbox-rejected", "production-rejected",
  "production-no-id", "production-empty-id", "production-timeout", "production-network"]) {
  test(`Pages mail adapter: ${scenario}`, async (t) => {
    const email = "route-test@example.com";
    const repository = repositoryFor(env);
    await database.batch(["login_tokens", "preview_mail_sink"].map(table => database.prepare(`DELETE FROM ${table}`)));
    const production = scenario.startsWith("production");
    const runtime = { ...env, EVENT_ID: "sample", SESSION_SECRET: "fixture-session", HASH_PEPPER: "fixture-pepper",
      TURNSTILE_SECRET: "fixture-turnstile", MAILGUN_API_KEY: "fixture-key", MAILGUN_DOMAIN: "fixture.example",
      PREVIEW_MAIL_SINK: production ? undefined : "d1",
      PREVIEW_TEST_RECIPIENTS: scenario === "sink" ? email : "",
      // Intentionally overlap sink and retain a stale allowlist in production.
      PREVIEW_SANDBOX_RECIPIENTS: scenario === "denied" ? "" : email };
    const errors = [], mail = [], logs = [];
    t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
    t.mock.method(console, "log", value => logs.push(JSON.parse(value)));
    const rejection = `${email}: rejected ` + "x".repeat(400);
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return Response.json({ success: true });
      assert.equal(url, "https://api.mailgun.net/v3/fixture.example/messages");
      assert.ok(init.signal instanceof AbortSignal);
      const form = init.body;
      assert.equal(form.get("to"), email);
      const link = form.get("text").split("\n").find(line => line.startsWith("https://preview.example/circle?login="));
      assert.ok(link, "plain-text action URL stays alone on its line");
      assert.ok(form.get("html").includes(`href="${link}"`), "the same HTML action URL reaches the transport");
      mail.push(form);
      if (scenario.endsWith("timeout")) throw new DOMException(`${email} ${link} fixture-key`, "TimeoutError");
      if (scenario.endsWith("network")) throw new TypeError(`${email} ${link} fixture-key`);
      if (scenario.endsWith("no-id")) return Response.json({ message: "Queued. private response" });
      if (scenario.endsWith("empty-id")) return Response.json({ id: " " });
      return scenario.endsWith("rejected") ? new Response(rejection, { status: 403 }) : Response.json({ id: "pages-provider-id" });
    });
    const request = new Request("https://preview.example/api/auth/request-link", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ email, turnstileToken: "fixture" }) });
    const sending = portalHandlers({ env: runtime, request }).requestLink(request);
    if (scenario.endsWith("rejected")) await assert.rejects(sending, error => error.code === "mailgun_403" && error.message === "mailgun_403");
    else if (scenario.endsWith("timeout") || scenario.endsWith("network")) await assert.rejects(sending);
    else {
      const response = await sending;
      assert.equal(response.status, scenario === "denied" ? 400 : 202);
      if (scenario !== "denied") assert.deepEqual(await response.json(), { ok: true }, "diagnostics do not enter the anonymous response");
    }
    assert.equal(mail.length, scenario === "sink" || scenario === "denied" ? 0 : 1);
    const captured = await repository.latestPreviewMail(email);
    if (scenario === "sink") assert.match(captured.text, /^https:\/\/preview.example\/circle\?login=\S+$/m);
    else assert.equal(captured, null);
    assert.deepEqual(errors, scenario === "sandbox-rejected" ? [`Mailgun rejected the message (403). ${rejection.slice(0, 300)}`] : []);
    const result = scenario === "sink" ? { result: "preview_sink", providerId: null }
      : scenario.endsWith("rejected") ? { result: "failed", errorCode: "mailgun_403" }
        : scenario.endsWith("timeout") ? { result: "unknown", errorCode: "delivery_timeout" }
          : scenario.endsWith("network") ? { result: "unknown", errorCode: "delivery_unknown" }
            : { result: "accepted", providerId: scenario.endsWith("no-id") || scenario.endsWith("empty-id") ? null : "pages-provider-id" };
    assert.deepEqual(logs, scenario === "denied" ? [] : [{ event: "portal.mail", mailType: "login_link", ...result }]);
    assert.doesNotMatch(JSON.stringify(logs), /route-test|login=|登入|private response|fixture-key/);
  });
}

test("Pages logs one invitation event for creation, each role's invitation and resend", async (t) => {
  const repository = repositoryFor(env), now = Date.now();
  const admin = "preview-admin@example.test";
  const account = await repository.upsertAccount(admin, now);
  const session = "invitation-log-session";
  await repository.createSession(account, now, now + 3600000, session);
  const cookie = `${SESSION_COOKIE}=${session}.${await hmacSign("fixture-session", session)}`;
  const runtime = { ...env, PREVIEW_MAIL_SINK: undefined, EVENT_ID: "sample", SESSION_SECRET: "fixture-session",
    HASH_PEPPER: "fixture-pepper", MAILGUN_API_KEY: "fixture-key", MAILGUN_DOMAIN: "fixture.example" };
  const request = (path, body) => new Request(`https://preview.example${path}`, { method: "POST",
    headers: { "content-type": "application/json", origin: "https://preview.example", cookie }, body: JSON.stringify(body) });
  const logs = [], mail = [];
  t.mock.method(console, "log", value => logs.push(JSON.parse(value)));
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    mail.push(init.body);
    return Response.json({ id: `invitation-provider-${mail.length}` });
  });
  const creation = request("/api/admin/organizer/events", { tentativeName: "Private invitation name", ownerEmail: admin });
  const handlers = portalHandlers({ request: creation, env: runtime });
  const created = await handlers.adminCreateOrganizerCandidate(creation);
  assert.equal(created.status, 201, await created.clone().text());
  const { candidateId } = await created.json();
  for (const role of ["editor", "owner"]) {
    for (const action of ["invite", "resend"]) {
      const response = await handlers.manageOrganizerCollaborators(request(`/api/organizer/events/${candidateId}/collaborators`, {
        role, action, email: `invitation-${role}@example.test`,
      }), candidateId);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).invitationSent, true);
    }
  }
  assert.equal(mail.length, 5);
  assert.deepEqual(logs, mail.map((_, index) => ({ event: "portal.mail", mailType: "organizer_invitation",
    result: "accepted", providerId: `invitation-provider-${index + 1}` })));
  for (const message of mail) {
    assert.ok(!JSON.stringify(logs).includes(message.get("to")));
    assert.ok(!JSON.stringify(logs).includes(message.get("subject")));
    const token = message.get("text").match(/login=(\S+)/)[1];
    assert.ok(!JSON.stringify(logs).includes(token));
  }
  assert.doesNotMatch(JSON.stringify(logs), /Private invitation name|fixture-key/);
});
