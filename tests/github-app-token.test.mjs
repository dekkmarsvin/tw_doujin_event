import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import test, { after, before } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const token = await environment.runner.import("/app/github-app-token.ts");
const publication = await environment.runner.import("/app/organizer-publication.ts");
after(() => vite.close());

const textEncoder = new TextEncoder();
let keyPair;
let pkcs8Pem;
let pkcs1Pem;

function base64UrlDecode(value) {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function pem(label, bytes) {
  const encoded = Buffer.from(bytes).toString("base64").replace(/(.{64})/gu, "$1\n");
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----`;
}

async function verifyJwt(authorization) {
  assert.match(authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
  const compact = authorization.slice("Bearer ".length);
  const [headerPart, claimsPart, signaturePart] = compact.split(".");
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(claimsPart)));
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKey = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  assert.equal(await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" }, publicKey, base64UrlDecode(signaturePart), textEncoder.encode(`${headerPart}.${claimsPart}`),
  ), true);
  return { header, claims };
}

function tokenResponse(value = "installation-token", expiresAt, status = 201) {
  return new Response(JSON.stringify({ token: value, expires_at: expiresAt }), {
    status, headers: { "content-type": "application/json" },
  });
}

function providerFor(privateKey, input = {}) {
  const now = input.now ?? (() => 1_790_000_000_000);
  const fetch = input.fetch ?? (async (url, init) => {
    assert.match(String(url), /\/app\/installations\/123\/access_tokens$/u);
    assert.equal(init.method, "POST");
    await verifyJwt(init.headers.authorization);
    return tokenResponse("installation-token", new Date(now() + 3_600_000).toISOString());
  });
  return token.createGitHubAppTokenProvider({ appId: "4931208", installationId: "123", privateKey, fetch, now });
}

before(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  pkcs8Pem = pem("PRIVATE KEY", pkcs8);
  const pkcs1 = createPrivateKey({ key: pkcs8Pem, format: "pem", type: "pkcs8" }).export({ format: "der", type: "pkcs1" });
  pkcs1Pem = pem("RSA PRIVATE KEY", pkcs1);
});

test("signs a verifiable App JWT from both PKCS#8 and PKCS#1 PEM keys", async () => {
  for (const privateKey of [pkcs8Pem, pkcs1Pem]) {
    let now = 1_790_000_123_456;
    let seen;
    const provider = providerFor(privateKey, {
      now: () => now,
      fetch: async (_url, init) => {
        seen = await verifyJwt(init.headers.authorization);
        return tokenResponse("token-for-jwt", new Date(now + 3_600_000).toISOString());
      },
    });
    assert.equal(await provider.getToken(), "token-for-jwt");
    assert.deepEqual(seen.header, { alg: "RS256", typ: "JWT" });
    assert.equal(seen.claims.iss, "4931208");
    assert.equal(seen.claims.iat, Math.floor(now / 1000) - 60);
    assert.equal(seen.claims.exp, seen.claims.iat + 600);
  }
});

test("caches until the 60 second refresh window and shares a pending mint", async () => {
  let now = 1_790_000_000_000;
  let calls = 0;
  const provider = providerFor(pkcs8Pem, {
    now: () => now,
    fetch: async (_url, init) => {
      calls += 1;
      await verifyJwt(init.headers.authorization);
      return tokenResponse(`token-${calls}`, new Date(1_790_003_600_000).toISOString());
    },
  });
  const first = await provider.getToken();
  assert.equal(first, "token-1");
  assert.equal(await provider.getToken(), "token-1");
  assert.equal(calls, 1);
  now = 1_790_003_539_000;
  assert.equal(await provider.getToken(), "token-1");
  now = 1_790_003_540_000;
  assert.equal(await provider.getToken(), "token-2");
  assert.equal(calls, 2);

  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let singleflightCalls = 0;
  const singleflight = providerFor(pkcs8Pem, {
    now: () => 1_790_000_000_000,
    fetch: async (_url, init) => {
      singleflightCalls += 1;
      await verifyJwt(init.headers.authorization);
      await blocked;
      return tokenResponse("shared-token", new Date(1_790_003_600_000).toISOString());
    },
  });
  const one = singleflight.getToken();
  const two = singleflight.getToken();
  for (let attempts = 0; attempts < 20 && singleflightCalls === 0; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(singleflightCalls, 1);
  release();
  assert.deepEqual(await Promise.all([one, two]), ["shared-token", "shared-token"]);
});

test("invalidates only the currently cached token, so a late old 401 cannot clear a newer token", async () => {
  let calls = 0;
  const provider = providerFor(pkcs8Pem, {
    fetch: async (_url, init) => {
      await verifyJwt(init.headers.authorization);
      calls += 1;
      return tokenResponse(calls === 1 ? "old-token" : "new-token", new Date(1_790_003_600_000).toISOString());
    },
  });
  assert.equal(await provider.getToken(), "old-token");
  provider.invalidate("unrelated-token");
  assert.equal(await provider.getToken(), "old-token");
  provider.invalidate("old-token");
  assert.equal(await provider.getToken(), "new-token");
  provider.invalidate("old-token");
  assert.equal(await provider.getToken(), "new-token");
  assert.equal(calls, 2);
});

test("configuration, key, malformed response, and fetch failures are safe PublicationFailures", async () => {
  const sentinel = "PRIVATE_SENTINEL_TOKEN";
  const cases = [
    {
      provider: token.createGitHubAppTokenProvider({ appId: "bad-app", installationId: "123", privateKey: sentinel, fetch: async () => { throw new Error(sentinel); } }),
      code: "github_app_config",
    },
    {
      provider: providerFor(sentinel),
      code: "github_app_key",
    },
    {
      provider: providerFor(pkcs8Pem, { fetch: async () => tokenResponse(sentinel, "not-a-date") }),
      code: "github_app_token",
    },
    {
      provider: providerFor(pkcs8Pem, { fetch: async () => { throw new Error(sentinel); } }),
      code: "github_app_request",
    },
  ];
  for (const { provider, code } of cases) {
    await assert.rejects(provider.getToken(), (error) => {
      assert.equal(error instanceof publication.PublicationFailure, true);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL_TOKEN/u);
      return true;
    });
  }
});

test("a mint response must be GitHub's 201 response", async () => {
  const provider = providerFor(pkcs8Pem, {
    fetch: async () => tokenResponse("response-sentinel", new Date(1_790_003_600_000).toISOString(), 200),
  });
  await assert.rejects(provider.getToken(), (error) => {
    assert.equal(error.code, "github_app_request");
    assert.doesNotMatch(error.message, /response-sentinel/u);
    return true;
  });
});
