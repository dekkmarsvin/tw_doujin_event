import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import test, { after, before } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const probe = await environment.runner.import("/app/github-installation-probe.ts");
const publication = await environment.runner.import("/app/organizer-publication.ts");
const handlersModule = await environment.runner.import("/app/circle-portal-handlers.ts");
const cryptoModule = await environment.runner.import("/app/portal-crypto.ts");
after(() => vite.close());

let privateKey;
let now = 1_790_000_000_000;

function pem(label, bytes) {
  const encoded = Buffer.from(bytes).toString("base64").replace(/(.{64})/gu, "$1\n");
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----`;
}

function response(body, status = 200) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

before(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pkcs8Pem = pem("PRIVATE KEY", pkcs8);
  privateKey = { pkcs8Pem, pkcs1Pem: pem("RSA PRIVATE KEY", createPrivateKey({ key: pkcs8Pem, format: "pem", type: "pkcs8" }).export({ format: "der", type: "pkcs1" })) };
});

function configuredProbe(fetch) {
  return probe.createGitHubInstallationProbe({
    appId: "4931208", installationId: "161391064", privateKey: privateKey.pkcs8Pem,
    webhookSecret: "WEBHOOK_SECRET_SENTINEL", fetch, now: () => now,
  });
}

test("fixed installation probe mints metadata-only scope and verifies exact repository metadata", async () => {
  const calls = [];
  const run = configuredProbe(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        repositories: ["tw_doujin_event-data"], permissions: { metadata: "read" },
      });
      assert.match(init.headers.authorization, /^Bearer /u);
      assert.equal(init.headers["user-agent"], "tw-doujin-event-publication/1");
      return response({ token: "INSTALLATION_TOKEN_SENTINEL", expires_at: new Date(now + 3_600_000).toISOString() }, 201);
    }
    assert.equal(init.method ?? "GET", "GET");
    assert.equal(init.headers.authorization, "Bearer INSTALLATION_TOKEN_SENTINEL");
    assert.equal(init.headers["user-agent"], "tw-doujin-event-publication/1");
    return response({ full_name: "dekkmarsvin/tw_doujin_event-data", private: false }, 200);
  });
  assert.deepEqual(await run(), { ok: true });
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://api.github.com/app/installations/161391064/access_tokens",
    "https://api.github.com/repos/dekkmarsvin/tw_doujin_event-data",
  ]);
});

test("probe rejects a successful response for the wrong or malformed repository", async () => {
  for (const metadata of [{ full_name: "dekkmarsvin/another-repository" }, { private: false }, null]) {
    const provider = { getToken: async () => "INSTALLATION_TOKEN_SENTINEL", invalidate: () => {} };
    await assert.rejects(probe.probeGitHubInstallation({
      tokenProvider: provider, fetch: async () => response(metadata),
    }), (error) => {
      assert.equal(error instanceof publication.PublicationFailure, true);
      assert.equal(error.code, "github_probe_response");
      assert.doesNotMatch(error.message, /INSTALLATION_TOKEN_SENTINEL/u);
      return true;
    });
  }
});

test("probe requires the repository metadata request to return exactly 200", async () => {
  let calls = 0;
  const run = configuredProbe(async () => {
    calls += 1;
    return calls === 1
      ? response({ token: "INSTALLATION_TOKEN_SENTINEL", expires_at: new Date(now + 3_600_000).toISOString() }, 201)
      : response({ full_name: "dekkmarsvin/tw_doujin_event-data" }, 201);
  });
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, "github_api_response");
    assert.doesNotMatch(error.message, /INSTALLATION_TOKEN_SENTINEL/u);
    return true;
  });
  assert.equal(calls, 2);
});

test("probe requires webhook secret before any outbound request", async () => {
  let calls = 0;
  const run = probe.createGitHubInstallationProbe({
    appId: "4931208", installationId: "161391064", privateKey: privateKey.pkcs1Pem,
    webhookSecret: "", fetch: async () => { calls += 1; return response({}); }, now: () => now,
  });
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, "github_app_config");
    assert.doesNotMatch(error.message, /WEBHOOK_SECRET_SENTINEL/u);
    return true;
  });
  assert.equal(calls, 0);
});

function request(body, cookie) {
  return new Request("https://verify.kotoban.top/api/admin/integrations/github/probe", {
    method: "POST", headers: {
      origin: "https://verify.kotoban.top", "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    }, body,
  });
}

function makeHandlers({ probeRun, session, onAudit = () => {} }) {
  const repository = {
    getSession: async () => session,
    isAdminEmail: async (email) => email === "admin@example.test",
    writeAudit: async (...args) => onAudit(...args),
  };
  return handlersModule.createCirclePortalHandlers({
    repository, githubInstallationProbe: probeRun,
    sendMail: async () => {}, lookupCircle: async () => null, searchCircles: async () => [],
    fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "sitekey",
    projectCircle: async () => null,
    config: {
      eventId: "ff47", origin: "https://verify.kotoban.top", sessionSecret: "session-secret", hashPepper: "pepper",
      adminEmails: ["admin@example.test"], dataUpdatedAt: "2026-08-01T00:00:00.000Z",
      eventEndsAt: "2026-12-31T00:00:00.000Z", now: () => now,
    },
  });
}

async function sessionCookie(sessionId = "session-1") {
  return `__Host-ff47_session=${sessionId}.${await cryptoModule.hmacSign("session-secret", sessionId)}`;
}

test("admin probe handler gates valid admin, exact empty body, and safe failures", async () => {
  const adminSession = { accountId: "admin-id", email: "admin@example.test", sessionCreatedAt: now };
  let calls = 0;
  let auditCalls = 0;
  const handlers = makeHandlers({
    probeRun: async () => { calls += 1; return { ok: true }; }, session: adminSession,
    onAudit: () => { auditCalls += 1; },
  });
  const cookie = await sessionCookie();
  assert.deepEqual(await (await handlers.adminProbeGitHubInstallation(request("{}", cookie))).json(), { ok: true });
  assert.equal(calls, 1);
  assert.equal(auditCalls, 0);
  assert.equal((await handlers.adminProbeGitHubInstallation(request('{"unexpected":true}', cookie))).status, 400);
  assert.equal(calls, 1);

  const failed = makeHandlers({
    probeRun: async () => { throw new Error("PRIVATE_KEY_SENTINEL"); }, session: adminSession,
  });
  const failedResponse = await failed.adminProbeGitHubInstallation(request("{}", cookie));
  assert.equal(failedResponse.status, 503);
  const failedBody = await failedResponse.text();
  assert.doesNotMatch(failedBody, /PRIVATE_KEY_SENTINEL/u);
});

test("admin probe handler preserves ordinary, stale, and unauthenticated gate responses without outbound calls", async () => {
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true }; };
  const ordinary = makeHandlers({ probeRun: run, session: { accountId: "user-id", email: "user@example.test", sessionCreatedAt: now } });
  const ordinaryCookie = await sessionCookie("ordinary");
  assert.equal((await ordinary.adminProbeGitHubInstallation(request("{}", ordinaryCookie))).status, 403);

  const stale = makeHandlers({ probeRun: run, session: { accountId: "admin-id", email: "admin@example.test", sessionCreatedAt: now - 7 * 24 * 60 * 60 * 1000 } });
  const staleCookie = await sessionCookie("stale");
  assert.equal((await stale.adminProbeGitHubInstallation(request("{}", staleCookie))).status, 401);
  assert.equal((await stale.adminProbeGitHubInstallation(request("{}"))).status, 401);
  assert.equal(calls, 0);
});
