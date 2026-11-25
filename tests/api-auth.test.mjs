import assert from "node:assert/strict";
import test, { after } from "node:test";
import { startApi } from "./support/api.mjs";

// Auth module through the router (#546 phase 6): sign-in by emailed link, the
// session and its lifetime, sign-out, account deletion, and the request gate
// every write passes.
const api = await startApi("api-auth");
after(() => api.close());

const DAY = 24 * 60 * 60 * 1000;
const count = async (table) => (await api.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

test("a mailed link signs in once; the session lasts until sign-out", async () => {
  const email = "member@example.test";
  const cookie = await api.signIn(email);
  const session = await api.call("GET", "/api/auth/session", { cookie });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).email, email);

  const token = /[?&]login=([^&\s]+)/.exec((await api.lastMail(email)).text)[1];
  const reused = await api.call("POST", "/api/auth/verify", { body: { token } });
  assert.equal(reused.status, 400, "a link works once");

  const signedOut = await api.call("DELETE", "/api/auth/session", { cookie, body: {} });
  assert.equal(signedOut.status, 200);
  assert.equal((await api.call("GET", "/api/auth/session", { cookie })).status, 401);
});

test("the session cookie is host-locked and hidden from scripts, and a forged one is refused", async () => {
  const requested = await api.call("POST", "/api/auth/request-link", { headers: { "cf-connecting-ip": "203.0.113.7" },
    body: { email: "second@example.test", turnstileToken: "token", locale: "zh-Hant" } });
  assert.equal(requested.status, 202);
  const token = /[?&]login=([^&\s]+)/.exec((await api.lastMail("second@example.test")).text)[1];
  const verified = await api.call("POST", "/api/auth/verify", { body: { token } });
  const header = verified.headers.get("set-cookie");
  assert.match(header, /^__Host-[^=]+=/);
  for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"]) {
    assert.ok(header.split(/;\s*/).includes(attribute), attribute);
  }
  assert.doesNotMatch(header, /Domain=/i);

  const [name, value] = header.split(";")[0].split("=");
  const [sessionId, signature] = value.split(".");
  // Change the first signature character: the last one can carry only padding bits.
  const tampered = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  for (const forged of [`${sessionId}.${tampered}`, `${sessionId}x.${signature}`, sessionId]) {
    assert.equal((await api.call("GET", "/api/auth/session", { cookie: `${name}=${forged}` })).status, 401, forged);
  }
});

test("no link is sent without passing human verification", async () => {
  api.human = false;
  try {
    const tokens = await count("login_tokens");
    const response = await api.call("POST", "/api/auth/request-link", { body: { email: "other@example.test", turnstileToken: "token", locale: "zh-Hant" } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "turnstile_failed");
    assert.equal(await count("login_tokens"), tokens);
    assert.equal(await api.lastMail("other@example.test"), null);
  } finally {
    api.human = true;
  }
});

test("a session older than seven days is refused", async () => {
  const cookie = await api.signIn("owner@example.test");
  const sessionId = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
  await api.database.prepare("UPDATE sessions SET created_at = created_at - ? WHERE id = ?").bind(7 * DAY, sessionId).run();
  assert.equal((await api.call("GET", "/api/auth/session", { cookie })).status, 401);
});

test("deleting an account needs the email typed back, then removes it and its session", async () => {
  const email = "local-circle@example.test";
  const cookie = await api.signIn(email);
  const wrong = await api.call("DELETE", "/api/account", { cookie, body: { confirm: "someone@example.test" } });
  assert.equal(wrong.status, 400);

  const deleted = await api.call("DELETE", "/api/account", { cookie, body: { confirm: email } });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal((await api.call("GET", "/api/auth/session", { cookie })).status, 401);
  const account = await api.database.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first();
  assert.equal(account, null);
});

test("writes need this site's origin and a JSON body", async () => {
  const tokens = await count("login_tokens");
  const body = { email: "member@example.test", turnstileToken: "token", locale: "zh-Hant" };
  const foreign = await api.call("POST", "/api/auth/request-link", { body, headers: { origin: "https://elsewhere.example" } });
  assert.equal(foreign.status, 403);
  const form = await api.call("POST", "/api/auth/request-link", { body, headers: { "content-type": "text/plain" } });
  assert.equal(form.status, 415);
  assert.equal(await count("login_tokens"), tokens);
});

test("the router answers unknown paths with 404 and wrong methods with 405", async () => {
  assert.equal((await api.call("GET", "/api/nothing-here")).status, 404);
  const wrongMethod = await api.call("PATCH", "/api/auth/session", { body: {} });
  assert.equal(wrongMethod.status, 405);
  assert.match(wrongMethod.headers.get("allow"), /GET/);
});
