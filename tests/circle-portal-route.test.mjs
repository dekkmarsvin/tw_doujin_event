import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers, SESSION_COOKIE } = await environment.runner.import("/app/circle-portal-handlers.ts");
const { OVERRIDE_RETENTION_PURGE_AFTER_MS } = await environment.runner.import("/app/circle-overrides.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "portal-route-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const ORIGIN = "https://verify.kotoban.top";
const CIRCLES = {
  "ff47-site": { id: "ff47-site", name: "有官網的社團", nameKey: "有官網的社團", sourceRow: 10, links: [{ provider: "官方網站", url: "https://circle.example/home" }] },
  "ff47-social": { id: "ff47-social", name: "只有社群的社團", nameKey: "只有社群的社團", sourceRow: 11, links: [{ provider: "X", url: "https://x.com/circle" }] },
  "ff47-domain": { id: "ff47-domain", name: "同網域社團", nameKey: "同網域社團", sourceRow: 12, links: [{ provider: "官方網站", url: "https://owner.example/" }] },
};

/** Comfortably after the fixture clock, so tests start in the "during" phase. */
const EVENT_ENDS_AT = "2026-08-23T23:59:59.999+08:00";

let clock = 1_786_500_000_000;
let sent = [];
let evidenceBody = null;
let humanVerified = true;
let verifiedTokens = [];
let sitekey = () => "test-sitekey";
let handlers;
let repository;

const TABLES = ["login_tokens", "sessions", "accounts", "circle_claims", "circle_overrides", "overrides_doc", "audit_log", "preview_mail_sink", "admins"];

beforeEach(async () => {
  sent = [];
  evidenceBody = null;
  humanVerified = true;
  verifiedTokens = [];
  sitekey = () => "test-sitekey";
  repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.com"] });
  // Isolation matters here: claim ownership and the login rate-limit window are
  // both persistent, so a shared database would make tests order-dependent.
  await repository.ensureTables();
  await database.batch(TABLES.map((table) => database.prepare(`DELETE FROM ${table}`)));
  // The wipe clears the roster too, and ensureTables has already memoized its
  // seed, so restore the baseline admin explicitly.
  await repository.addAdmin("admin@example.com", "bootstrap", clock);
  handlers = createCirclePortalHandlers({
    repository,
    sendMail: async (message) => { sent.push(message); },
    lookupCircle: async (circleId) => CIRCLES[circleId] ?? null,
    searchCircles: async (query, limit) => Object.values(CIRCLES)
      .filter((circle) => circle.nameKey.includes(query.toLocaleLowerCase("zh-Hant")))
      .slice(0, limit),
    projectCircle: async (circleId, fields) => (CIRCLES[circleId]
      ? [{ recordId: `${circleId}-0`, name: CIRCLES[circleId].name, circle: { id: circleId, ...fields } }]
      : null),
    fetchEvidence: async () => evidenceBody,
    verifyHuman: async (token, remoteIp) => {
      verifiedTokens.push({ token, remoteIp });
      return humanVerified;
    },
    turnstileSitekey: () => sitekey(),
    config: {
      eventId: "ff47",
      origin: ORIGIN,
      sessionSecret: "test-session-secret",
      hashPepper: "test-pepper",
      adminEmails: ["admin@example.com"],
      dataUpdatedAt: "2026-08-11T00:00:00.000+08:00",
      eventEndsAt: EVENT_ENDS_AT,
      now: () => clock,
    },
  });
});

function post(path, body, cookie) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

function get(path, cookie) {
  return new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

/** Drive the real magic-link flow rather than forging a session. */
async function signIn(email) {
  await handlers.requestLink(post("/api/auth/request-link", { email, turnstileToken: "solved" }));
  const link = sent.at(-1).text.match(/login=([^\s]+)/)[1];
  const response = await handlers.verify(post("/api/auth/verify", { token: decodeURIComponent(link) }));
  assert.equal(response.status, 200, `sign-in failed for ${email}`);
  return cookieFrom(response);
}

async function approve(cookieOwner, circleId, adminCookie) {
  const created = await handlers.createClaim(post("/api/claims", { circleId }, cookieOwner));
  const { id } = await created.json();
  await handlers.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, adminCookie));
  return id;
}

test("a login request answers identically whether or not the inbox is known", async () => {
  const fresh = await handlers.requestLink(post("/api/auth/request-link", { email: "brand-new@example.com", turnstileToken: "solved" }));
  await handlers.verify(post("/api/auth/verify", { token: decodeURIComponent(sent.at(-1).text.match(/login=([^\s]+)/)[1]) }));
  const known = await handlers.requestLink(post("/api/auth/request-link", { email: "brand-new@example.com", turnstileToken: "solved" }));

  assert.equal(fresh.status, 202);
  assert.equal(known.status, 202);
  assert.deepEqual(await fresh.json(), await known.json());

  // A malformed address is accepted silently too, and sends nothing.
  const before = sent.length;
  const bad = await handlers.requestLink(post("/api/auth/request-link", { email: "not-an-email", turnstileToken: "solved" }));
  assert.equal(bad.status, 202);
  assert.equal(sent.length, before);
});

test("a login request without a solved challenge reaches neither the mailer nor the database", async () => {
  const missing = await handlers.requestLink(post("/api/auth/request-link", { email: "unverified@example.com" }));
  assert.equal(missing.status, 403);
  assert.equal(verifiedTokens.length, 0, "an absent token must not cost a siteverify call");

  humanVerified = false;
  const rejected = await handlers.requestLink(post("/api/auth/request-link", { email: "unverified@example.com", turnstileToken: "forged" }));
  assert.equal(rejected.status, 403);
  assert.deepEqual(verifiedTokens.map(({ token }) => token), ["forged"]);

  assert.equal(sent.length, 0);
  const rows = await database.prepare("SELECT COUNT(*) AS total FROM login_tokens").first();
  assert.equal(rows.total, 0, "a refused request must not consume the address's hourly allowance either");
});

test("the challenge is checked before the address, so refusing it reveals nothing", async () => {
  // The address-shaped answer is deliberately indistinguishable (202 either
  // way). Verifying first keeps that property: a 403 is about the challenge
  // alone, which is why it can be reported honestly.
  humanVerified = false;
  const malformed = await handlers.requestLink(post("/api/auth/request-link", { email: "not-an-email", turnstileToken: "forged" }));
  assert.equal(malformed.status, 403);

  humanVerified = true;
  const wellFormed = await handlers.requestLink(post("/api/auth/request-link", { email: "someone@example.com", turnstileToken: "solved" }));
  const stillMalformed = await handlers.requestLink(post("/api/auth/request-link", { email: "not-an-email", turnstileToken: "solved" }));
  assert.equal(wellFormed.status, 202);
  assert.equal(stillMalformed.status, 202);
  assert.deepEqual(await wellFormed.json(), await stillMalformed.json());
});

test("the sign-in page can read the public sitekey without a session", async () => {
  const response = await handlers.authConfig();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { turnstileSitekey: "test-sitekey" });
});

test("an unconfigured sitekey stops sign-in and nothing else", async () => {
  // The reader's overlay is built from the same wiring as the portal. Reading
  // the sitekey eagerly would have made a Turnstile that nobody has configured
  // yet take down the public document too.
  sitekey = () => { throw new Error("Missing Pages secret or variable TURNSTILE_SITEKEY."); };

  const doc = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal(doc.status, 200);
  assert.throws(() => handlers.authConfig(), /TURNSTILE_SITEKEY/);
});

test("a magic link works once and never again", async () => {
  await handlers.requestLink(post("/api/auth/request-link", { email: "replay@example.com", turnstileToken: "solved" }));
  const token = decodeURIComponent(sent.at(-1).text.match(/login=([^\s]+)/)[1]);

  assert.equal((await handlers.verify(post("/api/auth/verify", { token }))).status, 200);
  const replayed = await handlers.verify(post("/api/auth/verify", { token }));
  assert.equal(replayed.status, 400);
});

test("the raw token never reaches the database", async () => {
  await handlers.requestLink(post("/api/auth/request-link", { email: "secrets@example.com", turnstileToken: "solved" }));
  const token = decodeURIComponent(sent.at(-1).text.match(/login=([^\s]+)/)[1]);

  const rows = await database.prepare("SELECT * FROM login_tokens").all();
  const dumped = JSON.stringify(rows.results);
  assert.ok(!dumped.includes(token), "a database dump must not yield a usable login link");
});

test("the sixth link request within an hour is refused", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await handlers.requestLink(post("/api/auth/request-link", { email: "flood@example.com", turnstileToken: "solved" }))).status, 202);
  }
  assert.equal((await handlers.requestLink(post("/api/auth/request-link", { email: "flood@example.com", turnstileToken: "solved" }))).status, 429);
});

test("the session cookie is host-locked, http-only and not readable by script", async () => {
  await handlers.requestLink(post("/api/auth/request-link", { email: "cookie@example.com", turnstileToken: "solved" }));
  const token = decodeURIComponent(sent.at(-1).text.match(/login=([^\s]+)/)[1]);
  const response = await handlers.verify(post("/api/auth/verify", { token }));
  const header = response.headers.get("set-cookie");

  assert.match(header, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.doesNotMatch(header, /Domain=/);
});

test("a forged or tampered session cookie is rejected", async () => {
  const cookie = await signIn("tamper@example.com");
  assert.equal((await handlers.session(get("/api/auth/session", cookie))).status, 200);

  const [name, value] = cookie.split("=");
  const [sessionId, signature] = [value.slice(0, value.lastIndexOf(".")), value.slice(value.lastIndexOf(".") + 1)];
  assert.equal((await handlers.session(get("/api/auth/session", `${name}=${sessionId}.${signature}x`))).status, 401);
  assert.equal((await handlers.session(get("/api/auth/session", `${name}=forged.${signature}`))).status, 401);
  assert.equal((await handlers.session(get("/api/auth/session", `${name}=nonsense`))).status, 401);
  assert.equal((await handlers.session(get("/api/auth/session"))).status, 401);
});

test("signing out revokes the session immediately", async () => {
  const cookie = await signIn("bye@example.com");
  await handlers.signOut(post("/api/auth/session", {}, cookie));
  assert.equal((await handlers.session(get("/api/auth/session", cookie))).status, 401);
});

test("every write refuses an anonymous caller", async () => {
  for (const response of await Promise.all([
    handlers.listClaims(get("/api/claims")),
    handlers.createClaim(post("/api/claims", { circleId: "ff47-site" })),
    handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "x" } }), "ff47-site"),
    handlers.adminListClaims(get("/api/admin/claims")),
    handlers.adminTakedown(post("/api/admin/overrides", { circleId: "ff47-site", reason: "x" })),
  ])) {
    assert.equal(response.status, 401);
  }
});

test("a signed-in stranger cannot edit a circle they have not claimed", async () => {
  const cookie = await signIn("stranger@example.com");
  const response = await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "冒名" } }, cookie), "ff47-site");
  assert.equal(response.status, 403);
});

test("a matching email domain verifies the claim without review", async () => {
  const cookie = await signIn("hello@owner.example");
  const response = await handlers.createClaim(post("/api/claims", { circleId: "ff47-domain" }, cookie));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, "verified");
});

test("a challenge is only offered for a recorded, fetchable url", async () => {
  const cookie = await signIn("challenge@example.com");

  const social = await handlers.createClaim(post("/api/claims", { circleId: "ff47-social", targetUrl: "https://x.com/circle" }, cookie));
  assert.equal((await social.json()).challenge, null, "bot-walled hosts must go to review");

  const attacker = await signIn("attacker@example.com");
  const forged = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://attacker.example/page" }, attacker));
  assert.equal((await forged.json()).challenge, null, "a url not already in the catalog must never be fetched");

  const site = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, cookie));
  assert.match((await site.json()).challenge, /^ff47-[23456789BCDFGHJKLMNPQRSTVWXYZ]{10}$/);
});

test("a challenge verifies only when the code is actually published", async () => {
  const cookie = await signIn("verify-challenge@example.com");
  const created = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, cookie));
  const { id, challenge } = await created.json();

  evidenceBody = "<html>nothing here</html>";
  const missed = await handlers.runChallenge(post(`/api/claims/${id}/challenge`, {}, cookie), id);
  assert.equal((await missed.json()).verified, false);

  evidenceBody = `<html>我的驗證碼是 ${challenge} 謝謝</html>`;
  const hit = await handlers.runChallenge(post(`/api/claims/${id}/challenge`, {}, cookie), id);
  assert.equal((await hit.json()).verified, true);

  assert.equal(await repository.ownsCircle((await repository.getClaim(id)).account_id, "ff47", "ff47-site"), true);
});

test("a claim cannot be challenged by anyone but its author", async () => {
  const owner = await signIn("claim-owner@example.com");
  const created = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, owner));
  const { id } = await created.json();

  const other = await signIn("someone-else@example.com");
  assert.equal((await handlers.runChallenge(post(`/api/claims/${id}/challenge`, {}, other), id)).status, 404);
});

test("a verified owner can publish, and the reader document reflects it", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("publisher@example.com");
  await approve(owner, "ff47-social", admin);

  const written = await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "新刊 300 元" } }, owner), "ff47-social");
  assert.equal(written.status, 200);

  const doc = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  const payload = await doc.json();
  assert.equal(payload.overrides.find((entry) => entry.circleId === "ff47-social").fields.saleInfo, "新刊 300 元");
  assert.match(doc.headers.get("cache-control"), /max-age=60/);
});

test("the public document is anonymous, revalidatable, and answers 304", async () => {
  const first = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  const etag = first.headers.get("etag");
  assert.ok(etag);

  const revalidated = await handlers.publicOverrides(
    new Request(`${ORIGIN}/data/events/ff47/overrides.json`, { headers: { "if-none-match": etag } }),
    "ff47",
  );
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("etag"), etag);
});

test("an unknown event cannot masquerade as an empty reviewed overlay", async () => {
  const response = await handlers.publicOverrides(get("/data/events/ff48/overrides.json"), "ff48");
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /找不到/);
});

test("rejects payloads the reader could not project", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("bad-payload@example.com");
  await approve(owner, "ff47-site", admin);

  for (const fields of [
    { saleInfo: "x".repeat(2001) },
    { links: [{ provider: "X", kind: "social", url: "javascript:alert(1)" }] },
    { thumbnail: { url: "https://tracker.example/pixel.png", sourceUrl: "https://tracker.example/p", provider: "x" } },
    { placements: { 1: ["A01"] } },
  ]) {
    const response = await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields }, owner), "ff47-site");
    assert.equal(response.status, 400, `should reject ${JSON.stringify(fields).slice(0, 60)}`);
  }
});

test("an admin address matches regardless of case or width", async () => {
  // The stored address is normalized, so the roster must be compared after the
  // same normalization rather than literally.
  await repository.addAdmin("mixed@example.com", "test", clock);
  const cookie = await signIn("Mixed@Example.COM");
  assert.equal((await (await handlers.session(get("/api/auth/session", cookie))).json()).isAdmin, true);

  const stranger = await signIn("nobody@example.com");
  assert.equal((await (await handlers.session(get("/api/auth/session", stranger))).json()).isAdmin, false);
});

test("the configured roster seeds an empty table and is not reapplied after", async () => {
  await database.prepare("DELETE FROM admins").run();

  // An empty roster is the break-glass state: configuration refills it.
  const fresh = createIdentityRepository(database, { bootstrapAdmins: ["seeded@example.com"] });
  await fresh.ensureTables();
  const seeded = await fresh.listAdmins();
  assert.deepEqual(seeded.map((admin) => admin.email), ["seeded@example.com"]);
  assert.equal(seeded[0].added_by, "bootstrap");

  // A different configuration over a populated table must not re-seed, or a
  // deliberately removed admin would keep coming back.
  const other = createIdentityRepository(database, { bootstrapAdmins: ["someone-else@example.com"] });
  await other.ensureTables();
  assert.deepEqual((await other.listAdmins()).map((admin) => admin.email), ["seeded@example.com"]);
});

test("an admin can add another admin, who gains access immediately", async () => {
  const admin = await signIn("admin@example.com");
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "second@example.com", action: "add" }, admin))).status, 200);

  // No redeploy in between: the new admin is authorised on their next request.
  const second = await signIn("second@example.com");
  assert.equal((await handlers.adminListClaims(get("/api/admin/claims", second))).status, 200);
  assert.equal((await (await handlers.session(get("/api/auth/session", second))).json()).isAdmin, true);
});

test("adding the same admin twice is reported rather than duplicated", async () => {
  const admin = await signIn("admin@example.com");
  await handlers.adminManageAdmins(post("/api/admin/admins", { email: "dupe@example.com", action: "add" }, admin));
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "dupe@example.com", action: "add" }, admin))).status, 409);
  assert.equal((await repository.listAdmins()).filter((entry) => entry.email === "dupe@example.com").length, 1);
});

test("the roster cannot be emptied into a lockout", async () => {
  const admin = await signIn("admin@example.com");

  // Removing yourself is the easiest accidental lockout.
  const self = await handlers.adminManageAdmins(post("/api/admin/admins", { email: "admin@example.com", action: "remove" }, admin));
  assert.equal(self.status, 409);
  assert.match((await self.json()).error, /不能移除自己/);

  // And the final remaining admin is refused even from another account.
  await handlers.adminManageAdmins(post("/api/admin/admins", { email: "temp@example.com", action: "add" }, admin));
  const temp = await signIn("temp@example.com");
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "admin@example.com", action: "remove" }, temp))).status, 200);

  const last = await handlers.adminManageAdmins(post("/api/admin/admins", { email: "temp@example.com", action: "remove" }, temp));
  assert.equal(last.status, 409, "the last admin must not be removable");
  assert.equal((await repository.listAdmins()).length, 1);
});

test("a removed admin loses access at once", async () => {
  const admin = await signIn("admin@example.com");
  await handlers.adminManageAdmins(post("/api/admin/admins", { email: "fired@example.com", action: "add" }, admin));
  const fired = await signIn("fired@example.com");
  assert.equal((await handlers.adminListClaims(get("/api/admin/claims", fired))).status, 200);

  await handlers.adminManageAdmins(post("/api/admin/admins", { email: "fired@example.com", action: "remove" }, admin));
  assert.equal((await handlers.adminListClaims(get("/api/admin/claims", fired))).status, 403);
});

test("only an admin may read or change the roster", async () => {
  const ordinary = await signIn("ordinary-roster@example.com");
  assert.equal((await handlers.adminListAdmins(get("/api/admin/admins", ordinary))).status, 403);
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "x@example.com", action: "add" }, ordinary))).status, 403);
  assert.equal((await handlers.adminListAdmins(get("/api/admin/admins"))).status, 401);
});

test("rejects a malformed roster change", async () => {
  const admin = await signIn("admin@example.com");
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "admin@example.com", action: "promote" }, admin))).status, 400);
  assert.equal((await handlers.adminManageAdmins(post("/api/admin/admins", { email: "not-an-email", action: "add" }, admin))).status, 400);
});

test("preview renders a draft without storing it", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("previewer@example.com");
  await approve(owner, "ff47-site", admin);

  const response = await handlers.previewOverride(
    post("/api/circle/ff47-site/preview", { fields: { saleInfo: "草稿內容" } }, owner), "ff47-site");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).records[0].circle.saleInfo, "草稿內容");

  // Nothing may reach the published document from a preview.
  assert.equal(await repository.getOverride("ff47", "ff47-site"), null);
  const doc = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.deepEqual((await doc.json()).overrides, []);
});

test("preview refuses a non-owner and an unauthored field", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("preview-owner@example.com");
  await approve(owner, "ff47-site", admin);

  const stranger = await signIn("preview-stranger@example.com");
  assert.equal((await handlers.previewOverride(post("/api/circle/ff47-site/preview", { fields: {} }, stranger), "ff47-site")).status, 403);
  assert.equal((await handlers.previewOverride(post("/api/circle/ff47-site/preview", { fields: {} }), "ff47-site")).status, 401);

  // The same validation as a save: a preview must not show what cannot be saved.
  assert.equal((await handlers.previewOverride(
    post("/api/circle/ff47-site/preview", { fields: { name: "改名" } }, owner), "ff47-site")).status, 400);
  assert.equal((await handlers.previewOverride(
    post("/api/circle/ff47-site/preview", { fields: { saleInfo: "x".repeat(2001) } }, owner), "ff47-site")).status, 400);
});

test("a circle can withdraw its own content from after the event", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("optout@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "展期內容" } }, owner), "ff47-site");

  const opted = await handlers.setPostEventVisibility(post("/api/circle/ff47-site/visibility", { hidden: true }, owner), "ff47-site");
  assert.equal(opted.status, 200);

  // During the event nothing changes: the opt-out is about afterwards.
  const during = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await during.json()).overrides.length, 1);

  // Past the end, the circle's own content is gone from the document entirely,
  // not merely hidden by the client.
  clock = Date.parse(EVENT_ENDS_AT) + 1000;
  const after = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.deepEqual((await after.json()).overrides, []);
  clock = 1_786_500_000_000;
});

test("a circle that did not opt out stays published after the event", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("stays@example.com");
  await approve(owner, "ff47-social", admin);
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "保留" } }, owner), "ff47-social");

  clock = Date.parse(EVENT_ENDS_AT) + 1000;
  const after = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await after.json()).overrides.length, 1);
  clock = 1_786_500_000_000;
});

test("the phase change alone rewrites the document and its etag", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("phase@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "內容" } }, owner), "ff47-site");
  await handlers.setPostEventVisibility(post("/api/circle/ff47-site/visibility", { hidden: true }, owner), "ff47-site");

  const beforeTag = (await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47")).headers.get("etag");

  // The event ending is not an edit, so nothing writes. The read path has to
  // notice the phase moved and rebuild, or withdrawn content keeps serving.
  clock = Date.parse(EVENT_ENDS_AT) + 1000;
  const afterResponse = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.notEqual(afterResponse.headers.get("etag"), beforeTag, "a stale etag would keep caches serving withdrawn content");
  assert.deepEqual((await afterResponse.json()).overrides, []);
  clock = 1_786_500_000_000;
});

test("visibility cannot be set by a non-owner or before any content exists", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("novis@example.com");
  await approve(owner, "ff47-domain", admin);

  // Nothing saved yet, so there is no row to flag.
  assert.equal((await handlers.setPostEventVisibility(post("/api/circle/ff47-domain/visibility", { hidden: true }, owner), "ff47-domain")).status, 409);

  const stranger = await signIn("vis-stranger@example.com");
  assert.equal((await handlers.setPostEventVisibility(post("/api/circle/ff47-domain/visibility", { hidden: true }, stranger), "ff47-domain")).status, 403);
  assert.equal((await handlers.setPostEventVisibility(post("/api/circle/ff47-domain/visibility", { hidden: true }), "ff47-domain")).status, 401);

  await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: { saleInfo: "x" } }, owner), "ff47-domain");
  assert.equal((await handlers.setPostEventVisibility(post("/api/circle/ff47-domain/visibility", { hidden: "yes" }, owner), "ff47-domain")).status, 400);
});

test("a circle chooses how long its own contribution lives, and the row carries the deadline", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("retention@example.com");
  await approve(owner, "ff47-site", admin);

  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "新刊" }, retention: "purge" }, owner), "ff47-site");
  const chosen = await (await handlers.getMyOverride(get("/api/circle/ff47-site/overrides", owner), "ff47-site")).json();
  assert.equal(chosen.retention, "purge");
  // Counted from the end of the event, not from this edit (ADR-0018).
  assert.equal(chosen.retentionExpiresAt, Date.parse(EVENT_ENDS_AT) + OVERRIDE_RETENTION_PURGE_AFTER_MS);

  // Waiting to be deleted is not the same as being withdrawn: the content stays
  // public for the whole of the window.
  const during = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await during.json()).overrides.length, 1);

  const audit = await database.prepare("SELECT detail_json FROM audit_log WHERE action = 'override.retention' AND subject_id = ?1").bind("ff47-site").all();
  assert.equal(audit.results.length, 1, "the purge records that it happened but not what it deleted, so the choice is recorded here");
  assert.equal(JSON.parse(audit.results[0].detail_json).choice, "purge");

  // Switching back drops the deadline rather than leaving a stale one behind.
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "新刊" }, retention: "keep" }, owner), "ff47-site");
  const kept = await (await handlers.getMyOverride(get("/api/circle/ff47-site/overrides", owner), "ff47-site")).json();
  assert.equal(kept.retention, "keep");
  assert.equal(kept.retentionExpiresAt, null);
});

test("a save that does not answer is not an answer", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("unanswered@example.com");
  await approve(owner, "ff47-social", admin);

  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "沒表態" } }, owner), "ff47-social");
  const unanswered = await (await handlers.getMyOverride(get("/api/circle/ff47-social/overrides", owner), "ff47-social")).json();
  assert.equal(unanswered.retention, null, "an unanswered row must be distinguishable from one that chose to keep");
  assert.equal(unanswered.retentionExpiresAt, null);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'override.retention'").first()).total, 0);

  // Answering once, then saving content again without repeating the answer.
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "選清除" }, retention: "purge" }, owner), "ff47-social");
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "只改內容" } }, owner), "ff47-social");
  const still = await (await handlers.getMyOverride(get("/api/circle/ff47-social/overrides", owner), "ff47-social")).json();
  assert.equal(still.retention, "purge", "a content-only save must not revert the choice");
  // Unchanged answers do not write a second audit row.
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'override.retention'").first()).total, 1);
});

test("the retention choice is refused when it is not one of the two options", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("badretention@example.com");
  await approve(owner, "ff47-domain", admin);

  const body = { fields: { saleInfo: "x" }, retention: "delete-now" };
  assert.equal((await handlers.putOverride(post("/api/circle/ff47-domain/overrides", body, owner), "ff47-domain")).status, 400);

  const stranger = await signIn("retention-stranger@example.com");
  assert.equal((await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: {}, retention: "purge" }, stranger), "ff47-domain")).status, 403);
  assert.equal((await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: {}, retention: "purge" }), "ff47-domain")).status, 401);

  // The rejected save must not have created a row at all.
  const row = await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides WHERE circle_id = ?1").bind("ff47-domain").first();
  assert.equal(row.total, 0);
});

test("only a listed admin reaches the review queue", async () => {
  const ordinary = await signIn("ordinary@example.com");
  assert.equal((await handlers.adminListClaims(get("/api/admin/claims", ordinary))).status, 403);

  const admin = await signIn("admin@example.com");
  assert.equal((await handlers.adminListClaims(get("/api/admin/claims", admin))).status, 200);
});

test("the generic public route rejects an event that does not match handler config", async () => {
  const response = await handlers.publicOverrides(get("/data/events/other/overrides.json"), "other");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("admin actions require a recently created session", async () => {
  const admin = await signIn("admin@example.com");
  clock += 25 * 60 * 60 * 1000;
  const response = await handlers.adminListClaims(get("/api/admin/claims", admin));
  assert.equal(response.status, 401, "a stale admin session must re-authenticate before deciding");
  clock -= 25 * 60 * 60 * 1000;
});

test("a takedown removes the content and a second takedown reports nothing to do", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("takedown@example.com");
  await approve(owner, "ff47-domain", admin);
  await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: { saleInfo: "冒名內容" } }, owner), "ff47-domain");

  assert.equal((await handlers.adminTakedown(post("/api/admin/overrides", { circleId: "ff47-domain", reason: "冒名" }, admin))).status, 200);

  const doc = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  const payload = await doc.json();
  assert.equal(payload.overrides.some((entry) => entry.circleId === "ff47-domain"), false);

  assert.equal((await handlers.adminTakedown(post("/api/admin/overrides", { circleId: "ff47-domain", reason: "again" }, admin))).status, 404);
});

test("revoking a claim stops the former owner from editing", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("revoked@example.com");
  const claimId = await approve(owner, "ff47-social", admin);

  await handlers.adminDecideClaim(post("/api/admin/claims", { claimId, decision: "revoke" }, admin));
  const response = await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "還想改" } }, owner), "ff47-social");
  assert.equal(response.status, 403);
});

test("a claim on an already-owned circle is refused without naming the owner", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("first@example.com");
  await approve(owner, "ff47-site", admin);

  const rival = await signIn("second@example.com");
  const response = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site" }, rival));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.doesNotMatch(body.error, /first@example\.com/, "the response must not leak who owns the circle");
});

test("circle search requires a session, so the catalog stays gated", async () => {
  // The portal must never need the public catalog to be readable: that is the
  // whole reason the search runs server-side.
  assert.equal((await handlers.searchCatalog(get("/api/circle/search?q=社團"))).status, 401);

  const cookie = await signIn("searcher@example.com");
  const response = await handlers.searchCatalog(get("/api/circle/search?q=社團", cookie));
  assert.equal(response.status, 200);
  assert.ok((await response.json()).circles.length > 0);
});

test("search needs two characters and returns only verifiable links", async () => {
  const cookie = await signIn("searcher2@example.com");

  for (const short of ["", " ", "社"]) {
    const response = await handlers.searchCatalog(get(`/api/circle/search?q=${encodeURIComponent(short)}`, cookie));
    assert.deepEqual((await response.json()).circles, [], `must not search on ${JSON.stringify(short)}`);
  }

  const social = await handlers.searchCatalog(get("/api/circle/search?q=只有社群", cookie));
  const [entry] = (await social.json()).circles;
  assert.equal(entry.name, "只有社群的社團");
  // The circle has an X link, which a Worker cannot read, so it is not offered
  // as a challenge target — but the count still tells the user it exists.
  assert.deepEqual(entry.links, []);
  assert.equal(entry.linkCount, 1);

  const site = await handlers.searchCatalog(get("/api/circle/search?q=有官網", cookie));
  const [withSite] = (await site.json()).circles;
  assert.deepEqual(withSite.links, [{ provider: "官方網站", url: "https://circle.example/home" }]);
});

test("a claim for an unknown circle is refused", async () => {
  const cookie = await signIn("unknown@example.com");
  assert.equal((await handlers.createClaim(post("/api/claims", { circleId: "ff47-nope" }, cookie))).status, 404);
});
