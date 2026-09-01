import assert from "node:assert/strict";
import { File } from "node:buffer";
import test, { after, before, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers, emailAuditSubjectId, SESSION_COOKIE } = await environment.runner.import("/app/circle-portal-handlers.ts");
const { OVERRIDE_RETENTION_PURGE_AFTER_MS } = await environment.runner.import("/app/circle-overrides.ts");
const { purgeExpiredRecords } = await environment.runner.import("/db/retention-purge.ts");

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
let handlerOptions;
let repository;
let thumbnailObjects;

const projectTestCircle = async (circleId, fields) => (CIRCLES[circleId]
  ? [{ recordId: `${circleId}-0`, name: CIRCLES[circleId].name, circle: { id: circleId, ...(fields ?? {}) } }]
  : null);

const TABLES = [
  "organizer_event_reviews",
  "organizer_event_invitations",
  "organizer_event_grants",
  "organizer_event_revisions",
  "organizer_event_candidates",
  "login_tokens",
  "sessions",
  "accounts",
  "circle_claims",
  "circle_overrides",
  "overrides_doc",
  "audit_log",
  "preview_mail_sink",
  "admins",
];

// The schema is built once. `ensureTables` memoizes on the repository closure,
// so rebuilding the repository per test threw that memo away and re-ran every
// CREATE TABLE, every ALTER, and every CREATE INDEX — 1935ms a test instead of
// 141ms. Only `tablesReady` lives in that closure, so one instance is safe.
before(async () => {
  repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.com"] });
  await repository.ensureTables();
});

beforeEach(async () => {
  sent = [];
  evidenceBody = null;
  humanVerified = true;
  verifiedTokens = [];
  sitekey = () => "test-sitekey";
  thumbnailObjects = { put: [], deleted: [], keys: new Set() };
  // Isolation matters here: claim ownership and the login rate-limit window are
  // both persistent, so a shared database would make tests order-dependent.
  // Wiping the rows is what provides it; the schema above is stateless.
  await database.batch(TABLES.map((table) => database.prepare(`DELETE FROM ${table}`)));
  // The wipe clears the roster too, and ensureTables has already memoized its
  // seed, so restore the baseline admin explicitly.
  await repository.addAdmin("admin@example.com", "bootstrap", clock);
  handlerOptions = {
    repository,
    sendMail: async (message) => { sent.push(message); },
    lookupCircle: async (circleId) => CIRCLES[circleId] ?? null,
    searchCircles: async (query, limit) => Object.values(CIRCLES)
      .filter((circle) => circle.nameKey.includes(query.toLocaleLowerCase("zh-Hant")))
      .slice(0, limit),
    projectCircle: projectTestCircle,
    fetchEvidence: async () => evidenceBody,
    verifyHuman: async (token, remoteIp) => {
      verifiedTokens.push({ token, remoteIp });
      return humanVerified;
    },
    turnstileSitekey: () => sitekey(),
    thumbnailStore: {
      url: (key) => `https://media-preview.kotoban.top/${key}`,
      list: async (prefix) => [...thumbnailObjects.keys].filter((key) => key.startsWith(prefix)),
      put: async (key, value, contentType) => { thumbnailObjects.keys.add(key); thumbnailObjects.put.push({ key, size: value.byteLength, contentType }); },
      delete: async (keys) => {
        const removed = Array.isArray(keys) ? keys : [keys];
        removed.forEach((key) => thumbnailObjects.keys.delete(key));
        thumbnailObjects.deleted.push(...removed);
      },
    },
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
  };
  handlers = createCirclePortalHandlers(handlerOptions);
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

function thumbnailRequest(circleId, cookie, bytes, type = "image/png") {
  const body = new FormData();
  body.set("file", new File([Uint8Array.from(bytes)], "thumbnail", { type }));
  body.set("sourceUrl", "https://circle.example/work");
  body.set("provider", "社團本人");
  return new Request(`${ORIGIN}/api/circle/${circleId}/thumbnail`, {
    method: "POST", headers: { origin: ORIGIN, cookie }, body,
  });
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

test("an organizer login link returns to the organizer entry and accepts its event invitation", async () => {
  const adminId = await repository.upsertAccount("admin@example.com", clock);
  await repository.createOrganizerCandidate({
    id: "candidate-organizer-login",
    tentativeName: "Organizer 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify({
      schema: "organizer-event-draft/1",
      event: { id: null, name: "Organizer 候選活動", days: [] },
      venue: { assignments: [] },
      officialSource: { label: "", url: null },
    }),
    now: clock,
  });

  const requested = await handlers.requestLink(post("/api/auth/request-link", {
    email: "owner@example.test",
    turnstileToken: "solved",
    audience: "organizer",
  }));
  assert.equal(requested.status, 202);
  const link = sent.at(-1).text.match(/\/organizer\?login=([^\s]+)/);
  assert.ok(link, "the emailed link must return to the organizer entry");

  const verified = await handlers.verify(post("/api/auth/verify", { token: decodeURIComponent(link[1]) }));
  assert.equal(verified.status, 200);
  const session = await verified.json();
  assert.equal(session.hasOrganizerAccess, true);

  const account = await database.prepare("SELECT id FROM accounts WHERE email = 'owner@example.test'").first();
  assert.equal(await repository.organizerRole("candidate-organizer-login", account.id), "owner");
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

test("login-request audit uses a keyed domain-separated digest", async () => {
  await handlers.requestLink(post("/api/auth/request-link", { email: "audit-email@example.com", turnstileToken: "solved" }));
  const row = await database.prepare(`SELECT subject_id FROM audit_log WHERE action = 'auth.link_requested' ORDER BY at DESC LIMIT 1`).first();
  assert.equal(row.subject_id, await emailAuditSubjectId("test-pepper", "audit-email@example.com"));
  const rawSha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("audit-email@example.com"));
  assert.notEqual(row.subject_id, Buffer.from(rawSha).toString("hex"));
});

test("a circle can delete its account and release its owned circle", async () => {
  const email = "delete@owner.example";
  const cookie = await signIn(email);
  assert.equal((await handlers.createClaim(post("/api/claims", { circleId: "ff47-domain" }, cookie))).status, 201);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
  const upload = await handlers.uploadThumbnail(thumbnailRequest("ff47-domain", cookie, png), "ff47-domain");
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  assert.equal((await handlers.putOverride(post("/api/circle/ff47-domain/overrides", {
    fields: { thumbnail: uploaded.thumbnail }, hostedThumbnailKey: uploaded.uploadKey,
  }, cookie), "ff47-domain")).status, 200);
  const hostedKey = (await repository.getOverride("ff47", "ff47-domain")).hosted_thumbnail_key;
  const abandoned = await handlers.uploadThumbnail(thumbnailRequest("ff47-domain", cookie, [...png, 0x03]), "ff47-domain");
  assert.equal(abandoned.status, 200);
  const abandonedKey = (await abandoned.json()).uploadKey;
  const accountId = await repository.upsertAccount(email, clock);
  await repository.createClaim({
    id: "claim-past-event", accountId, eventId: "past-event", circleId: "past-circle",
    circleNameKey: "past", circleNameAtClaim: "Past", sourceRowAtClaim: null,
    status: "verified", method: "admin", targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null,
    evidenceUrl: null, evidenceNote: null, now: clock,
  });
  const pastDraftKey = `events/past-event/circles/past-circle/${"b".repeat(64)}.png`;
  thumbnailObjects.keys.add(pastDraftKey);

  assert.equal((await handlers.deleteMyAccount(post("/api/account", { confirm: "wrong@example.com" }, cookie))).status, 400);
  const deleted = await handlers.deleteMyAccount(post("/api/account", { confirm: email }, cookie));
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await handlers.session(get("/api/auth/session", cookie))).status, 401);
  assert.equal((await database.prepare(`SELECT COUNT(*) AS total FROM accounts WHERE email = ?1`).bind(email).first()).total, 0);
  assert.equal((await database.prepare(`SELECT COUNT(*) AS total FROM circle_overrides WHERE circle_id = 'ff47-domain'`).first()).total, 0);
  assert.deepEqual(thumbnailObjects.deleted, [hostedKey, abandonedKey, pastDraftKey]);

  const successor = await signIn("successor@owner.example");
  assert.equal((await handlers.createClaim(post("/api/claims", { circleId: "ff47-domain" }, successor))).status, 201);
});

test("an admin can disable a non-admin account and revoke its live session", async () => {
  const target = await signIn("disabled-route@example.com");
  const admin = await signIn("admin@example.com");
  assert.equal((await handlers.adminDisableAccount(post("/api/admin/accounts", { email: "disabled-route@example.com" }, admin))).status, 200);
  assert.equal((await handlers.session(get("/api/auth/session", target))).status, 401);
  assert.equal((await handlers.adminDisableAccount(post("/api/admin/accounts", { email: "admin@example.com" }, admin))).status, 409);
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

const del = (path, cookie) => new Request(`${ORIGIN}${path}`, {
  method: "DELETE",
  headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
});

test("a lost challenge is recovered by the claimant, without an admin", async () => {
  const started = clock;
  try {
    const cookie = await signIn("lost-challenge@example.com");
    const created = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, cookie));
    const { id, challenge: lost } = await created.json();

    // The code was never stored in the clear, so a claimant who lost it has
    // nothing to look up — a day later it is expired as well.
    clock = started + 25 * 60 * 60 * 1000;
    const expired = await handlers.runChallenge(post(`/api/claims/${id}/challenge`, {}, cookie), id);
    assert.equal(expired.status, 410);
    assert.match((await expired.json()).error, /撤回/, "the error has to name the way out, not just the problem");

    // Resubmitting first is the dead end this test exists for.
    const blocked = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, cookie));
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /撤回/);

    assert.equal((await handlers.withdrawClaim(del(`/api/claims/${id}`, cookie), id)).status, 200);

    const again = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, cookie));
    assert.equal(again.status, 201);
    const { id: resubmitted, challenge } = await again.json();
    assert.notEqual(challenge, lost, "a resubmission must issue a new code");

    evidenceBody = `<html>驗證碼 ${lost}</html>`;
    assert.equal((await (await handlers.runChallenge(post(`/api/claims/${resubmitted}/challenge`, {}, cookie), resubmitted)).json()).verified,
      false, "the withdrawn claim's code must be dead");

    evidenceBody = `<html>驗證碼 ${challenge}</html>`;
    assert.equal((await (await handlers.runChallenge(post(`/api/claims/${resubmitted}/challenge`, {}, cookie), resubmitted)).json()).verified, true);
    assert.equal(await repository.ownsCircle((await repository.getClaim(resubmitted)).account_id, "ff47", "ff47-site"), true);
  } finally {
    clock = started;
  }
});

test("only the claimant can withdraw, and only while the claim is pending", async () => {
  const owner = await signIn("withdraw-owner@example.com");
  const created = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site", targetUrl: "https://circle.example/home" }, owner));
  const { id } = await created.json();

  const other = await signIn("withdraw-other@example.com");
  assert.equal((await handlers.withdrawClaim(del(`/api/claims/${id}`, other), id)).status, 404,
    "someone else's claim must not even be identifiable");

  const admin = await signIn("admin@example.com");
  await handlers.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, admin));
  assert.equal((await handlers.withdrawClaim(del(`/api/claims/${id}`, owner), id)).status, 409,
    "withdrawing is an escape from a pending challenge, not a way to drop ownership");
});

test("withdrawing does not buy more claims than the daily limit allows", async () => {
  const cookie = await signIn("claim-limit@example.com");
  for (const circleId of ["ff47-site", "ff47-social", "ff47-domain"]) {
    const created = await handlers.createClaim(post("/api/claims", { circleId }, cookie));
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await handlers.withdrawClaim(del(`/api/claims/${id}`, cookie), id)).status, 200);
  }

  // Withdrawn claims still occupy the window: the row is reused rather than
  // removed, so the counter cannot be reset by withdrawing.
  const blocked = await handlers.createClaim(post("/api/claims", { circleId: "ff47-site" }, cookie));
  assert.equal(blocked.status, 429);
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

test("hosted thumbnails stay draft-only until the confirmed save, then follow normal deletion", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("hosted-owner@example.com");
  await approve(owner, "ff47-site", admin);
  await approve(owner, "ff47-social", admin);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];

  const first = await handlers.uploadThumbnail(thumbnailRequest("ff47-site", owner, png), "ff47-site");
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.match(firstBody.thumbnail.url, /^https:\/\/media-preview\.kotoban\.top\/events\/ff47\/circles\/ff47-site\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(thumbnailObjects.put.map(({ contentType, size }) => ({ contentType, size })), [{ contentType: "image/png", size: png.length }]);
  assert.equal(await repository.getOverride("ff47", "ff47-site"), null, "upload alone must not publish or save the draft");
  assert.deepEqual((await (await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47")).json()).overrides, []);

  const savedFirst = await handlers.putOverride(post("/api/circle/ff47-site/overrides", {
    fields: { thumbnail: firstBody.thumbnail }, hostedThumbnailKey: firstBody.uploadKey,
  }, owner), "ff47-site");
  assert.equal(savedFirst.status, 200);
  const firstRow = await repository.getOverride("ff47", "ff47-site");
  assert.ok(firstRow.hosted_thumbnail_key);
  const published = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await published.json()).overrides[0].fields.thumbnail.url, firstBody.thumbnail.url);
  const metadataOnly = await handlers.putOverride(post("/api/circle/ff47-site/overrides", {
    fields: { thumbnail: { ...firstBody.thumbnail, provider: "社團更新標示" } },
  }, owner), "ff47-site");
  assert.equal(metadataOnly.status, 200);
  assert.equal((await repository.getOverride("ff47", "ff47-site")).hosted_thumbnail_key, firstRow.hosted_thumbnail_key);
  assert.equal(thumbnailObjects.keys.has(firstRow.hosted_thumbnail_key), true, "metadata edits keep the published object");

  const replacement = await handlers.uploadThumbnail(thumbnailRequest("ff47-site", owner, [...png, 0x01]), "ff47-site");
  assert.equal(replacement.status, 200);
  const replacementBody = await replacement.json();
  assert.equal((await repository.getOverride("ff47", "ff47-site")).hosted_thumbnail_key, firstRow.hosted_thumbnail_key);
  assert.deepEqual(thumbnailObjects.deleted, [], "staging a replacement must not remove the published object");
  const latestDraft = await handlers.uploadThumbnail(thumbnailRequest("ff47-site", owner, [...png, 0x02]), "ff47-site");
  assert.equal(latestDraft.status, 200);
  const latestDraftBody = await latestDraft.json();
  assert.deepEqual(thumbnailObjects.deleted, [replacementBody.uploadKey], "only the latest unpublished draft is retained");
  const missingKey = await handlers.putOverride(post("/api/circle/ff47-site/overrides", {
    fields: { thumbnail: latestDraftBody.thumbnail },
  }, owner), "ff47-site");
  assert.equal(missingKey.status, 400, "an unconfirmed hosted URL cannot be persisted without its upload key");
  assert.equal(thumbnailObjects.keys.has(latestDraftBody.uploadKey), true);
  const savedReplacement = await handlers.putOverride(post("/api/circle/ff47-site/overrides", {
    fields: { thumbnail: latestDraftBody.thumbnail }, hostedThumbnailKey: latestDraftBody.uploadKey,
  }, owner), "ff47-site");
  assert.equal(savedReplacement.status, 200);
  const replacementKey = (await repository.getOverride("ff47", "ff47-site")).hosted_thumbnail_key;
  assert.notEqual(replacementKey, firstRow.hosted_thumbnail_key);
  assert.deepEqual(thumbnailObjects.deleted, [replacementBody.uploadKey, firstRow.hosted_thumbnail_key], "replacement removes the former published object after save");

  const forged = await handlers.putOverride(post("/api/circle/ff47-site/overrides", {
    fields: { thumbnail: latestDraftBody.thumbnail }, hostedThumbnailKey: "events/ff47/circles/ff47-social/" + "a".repeat(64) + ".png",
  }, owner), "ff47-site");
  assert.equal(forged.status, 400);

  const removed = await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", { confirm: "ff47-site" }, owner), "ff47-site");
  assert.equal(removed.status, 200);
  assert.deepEqual(thumbnailObjects.deleted, [replacementBody.uploadKey, firstRow.hosted_thumbnail_key, replacementKey]);

  const second = await handlers.uploadThumbnail(thumbnailRequest("ff47-social", owner, png), "ff47-social");
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal((await handlers.putOverride(post("/api/circle/ff47-social/overrides", {
    fields: { thumbnail: secondBody.thumbnail }, hostedThumbnailKey: secondBody.uploadKey,
  }, owner), "ff47-social")).status, 200);
  const secondKey = (await repository.getOverride("ff47", "ff47-social")).hosted_thumbnail_key;
  const takedown = await handlers.adminTakedown(post("/api/admin/overrides", { circleId: "ff47-social", reason: "權利人要求" }, admin));
  assert.equal(takedown.status, 200);
  assert.deepEqual(thumbnailObjects.deleted, [replacementBody.uploadKey, firstRow.hosted_thumbnail_key, replacementKey, secondKey]);
  const takenDownRow = await repository.getOverride("ff47", "ff47-social");
  assert.equal(takenDownRow.hosted_thumbnail_key, null);
  assert.equal(JSON.parse(takenDownRow.fields_json).thumbnail, null, "a later edit cannot republish a deleted hosted URL");
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
  const preview = await response.json();
  assert.equal(preview.records[0].circle.saleInfo, "草稿內容");
  assert.equal(preview.baseRecords[0].circle.saleInfo, undefined);
  assert.equal(preview.projectedAt, new Date(clock).toISOString());

  // Nothing may reach the published document from a preview.
  assert.equal(await repository.getOverride("ff47", "ff47-site"), null);
  const doc = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.deepEqual((await doc.json()).overrides, []);
});

test("the confirmed preview payload projects identically after it becomes public", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("preview-public@example.com");
  await approve(owner, "ff47-site", admin);
  const fields = { saleInfo: "同一份內容", specialTags: ["新刊", "套組"] };

  const previewResponse = await handlers.previewOverride(
    post("/api/circle/ff47-site/preview", { fields }, owner), "ff47-site");
  const preview = await previewResponse.json();
  assert.equal((await handlers.putOverride(
    post("/api/circle/ff47-site/overrides", { fields }, owner), "ff47-site")).status, 200);
  const publicDocument = await (await handlers.publicOverrides(
    get("/data/events/ff47/overrides.json"), "ff47")).json();
  const publishedFields = publicDocument.overrides.find(({ circleId }) => circleId === "ff47-site").fields;

  assert.deepEqual(preview.records, await projectTestCircle("ff47-site", publishedFields));
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

test("a write by someone else after the event does not republish a circle that opted out", async () => {
  const admin = await signIn("admin@example.com");
  const optedOut = await signIn("rebuild-optout@example.com");
  const neighbour = await signIn("rebuild-neighbour@example.com");
  const takendown = await signIn("rebuild-takedown@example.com");
  await approve(optedOut, "ff47-site", admin);
  await approve(neighbour, "ff47-social", admin);
  await approve(takendown, "ff47-domain", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "退出內容" } }, optedOut), "ff47-site");
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "鄰居內容" } }, neighbour), "ff47-social");
  await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: { saleInfo: "待撤下" } }, takendown), "ff47-domain");
  await handlers.setPostEventVisibility(post("/api/circle/ff47-site/visibility", { hidden: true }, optedOut), "ff47-site");

  clock = Date.parse(EVENT_ENDS_AT) + 1000;
  // The read path notices the phase and rebuilds, so the stored document starts
  // this test correct. What follows is about keeping it that way.
  assert.deepEqual(
    (await (await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47")).json()).overrides.map((o) => o.circleId),
    ["ff47-domain", "ff47-social"],
  );

  // Every rebuild has to state the phase. A save by an unrelated circle is not
  // a decision about this one, so it must not put withdrawn content back into
  // the document the readers download.
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "鄰居改了內容" } }, neighbour), "ff47-social");
  const afterNeighbourSave = await repository.getOverridesDoc("ff47");
  assert.doesNotMatch(afterNeighbourSave.json, /退出內容/, "another circle's save must not republish withdrawn content");
  assert.equal(afterNeighbourSave.phase, "after");

  // Same for an admin takedown of a third circle.
  const freshAdmin = await signIn("admin@example.com");
  assert.equal((await handlers.adminTakedown(post("/api/admin/overrides", { circleId: "ff47-domain", reason: "權利人要求" }, freshAdmin))).status, 200);
  const afterTakedown = await repository.getOverridesDoc("ff47");
  assert.doesNotMatch(afterTakedown.json, /退出內容/, "an admin takedown must not republish withdrawn content");
  assert.equal(afterTakedown.phase, "after");

  const published = await (await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47")).json();
  assert.deepEqual(published.overrides.map((override) => override.circleId), ["ff47-social"]);
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

test("the purge takes the content off the public route, and the etag with it", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("purged@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "會過期的內容" }, retention: "purge" }, owner), "ff47-site");

  // Past the deadline but before the nightly purge has run: still published.
  // The 90 days are a lifespan, not an early withdrawal (ADR-0018).
  clock = Date.parse(EVENT_ENDS_AT) + OVERRIDE_RETENTION_PURGE_AFTER_MS + 1000;
  const waiting = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await waiting.json()).overrides.length, 1);
  const waitingTag = waiting.headers.get("etag");

  await purgeExpiredRecords(database, clock);

  // Same phase as the read above, so nothing but the purge can have moved the
  // etag — and a stale one would keep caches serving what was just deleted.
  const purged = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.deepEqual((await purged.json()).overrides, []);
  assert.notEqual(purged.headers.get("etag"), waitingTag);
  clock = 1_786_500_000_000;
});

test("a circle deletes its own contribution, and the same row the purge would have taken", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("selfdelete@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "要刪掉的內容" }, retention: "purge" }, owner), "ff47-site");

  // Not a single button: the confirmation is the circle id echoed back, so a
  // stale tab cannot delete by being clicked once (ADR-0020).
  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", { confirm: true }, owner), "ff47-site")).status, 400);
  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", {}, owner), "ff47-site")).status, 400);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides").first()).total, 1, "a refused confirmation must not delete");

  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", { confirm: "ff47-site" }, owner), "ff47-site")).status, 200);

  // The row is gone, not flagged — the same thing the scheduled purge does, so
  // "I deleted it" and "its deadline passed" leave no different remains.
  const rows = await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides WHERE circle_id = ?1").bind("ff47-site").first();
  assert.equal(rows.total, 0);
  const published = await handlers.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.deepEqual((await published.json()).overrides, []);

  // Who did it survives; what they deleted does not.
  const entry = await database.prepare("SELECT actor_account_id, actor_role, detail_json FROM audit_log WHERE action = 'override.deleted'").first();
  assert.ok(entry.actor_account_id, "after a transfer the account is the only way to tell who deleted what");
  assert.equal(entry.actor_role, "circle");
  assert.doesNotMatch(entry.detail_json, /要刪掉的內容/);

  // Nothing left to delete.
  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", { confirm: "ff47-site" }, owner), "ff47-site")).status, 404);
});

test("deletion needs the ownership chain, and follows it after a transfer", async () => {
  const admin = await signIn("admin@example.com");
  const first = await signIn("first-owner@example.com");
  const firstClaim = await approve(first, "ff47-domain", admin);
  await handlers.putOverride(post("/api/circle/ff47-domain/overrides", { fields: { saleInfo: "前任寫的" } }, first), "ff47-domain");

  const stranger = await signIn("delete-stranger@example.com");
  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-domain/overrides", { confirm: "ff47-domain" }, stranger), "ff47-domain")).status, 403);
  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-domain/overrides", { confirm: "ff47-domain" }), "ff47-domain")).status, 401);

  // Hand the circle over: the content belongs to the circle, not to the
  // account that typed it, so the new owner can delete what the old one wrote.
  await handlers.adminDecideClaim(post("/api/admin/claims", { claimId: firstClaim, decision: "revoke" }, admin));
  const second = await signIn("second-owner@example.com");
  await approve(second, "ff47-domain", admin);

  assert.equal((await handlers.deleteMyOverride(post("/api/circle/ff47-domain/overrides", { confirm: "ff47-domain" }, second), "ff47-domain")).status, 200);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides").first()).total, 0);
});

test("self-service deletion and the scheduled purge leave the same nothing behind", async () => {
  const admin = await signIn("admin@example.com");
  const byHand = await signIn("by-hand@example.com");
  const byClock = await signIn("by-clock@example.com");
  await approve(byHand, "ff47-site", admin);
  await approve(byClock, "ff47-social", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "自己刪" }, retention: "keep" }, byHand), "ff47-site");
  await handlers.putOverride(post("/api/circle/ff47-social/overrides", { fields: { saleInfo: "等期限" }, retention: "purge" }, byClock), "ff47-social");

  await handlers.deleteMyOverride(post("/api/circle/ff47-site/overrides", { confirm: "ff47-site" }, byHand), "ff47-site");
  clock = Date.parse(EVENT_ENDS_AT) + OVERRIDE_RETENTION_PURGE_AFTER_MS + 1000;
  await purgeExpiredRecords(database, clock);

  // Two routes to the same end state. If they diverged, "I deleted it myself"
  // and "the deadline came" would leave different remains, and only one of
  // them would be the one anybody tested.
  const remaining = await database.prepare("SELECT COUNT(*) AS total FROM circle_overrides").first();
  assert.equal(remaining.total, 0);
  const document = await repository.getOverridesDoc("ff47");
  assert.doesNotMatch(document.json, /自己刪|等期限/, "neither route may leave content inside the published document");
  clock = 1_786_500_000_000;
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

/** A deployment serving two events, each with its own dates. */
const SECOND_EVENT_ENDS_AT = "2027-02-14T23:59:59.999+08:00";
function multiEventHandlers() {
  const dates = {
    ff47: { dataUpdatedAt: "2026-08-11T00:00:00.000+08:00", eventEndsAt: EVENT_ENDS_AT },
    ff48: { dataUpdatedAt: "2027-02-01T00:00:00.000+08:00", eventEndsAt: SECOND_EVENT_ENDS_AT },
  };
  return createCirclePortalHandlers({
    ...handlerOptions,
    config: { ...handlerOptions.config, publishedEvent: async (id) => dates[id] ?? null },
  });
}

test("every published event serves its own overlay, and only published ones exist", async () => {
  const portal = multiEventHandlers();
  const admin = await signIn("admin@example.com");
  const owner = await signIn("two-events@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第一場的內容" } }, owner), "ff47-site");

  const first = await portal.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  const second = await portal.publicOverrides(get("/data/events/ff48/overrides.json"), "ff48");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  // The second event answers with its own document and its own generatedAt,
  // not a copy of the first event's.
  const secondBody = await second.json();
  assert.equal(secondBody.eventId, "ff48");
  assert.deepEqual(secondBody.overrides, []);
  assert.equal(secondBody.generatedAt, "2027-02-01T00:00:00.000+08:00");
  assert.equal((await first.json()).overrides.length, 1);

  // Distinct etags, or a cache would serve one event's overlay for the other.
  assert.notEqual(first.headers.get("etag"), second.headers.get("etag"));
  assert.match(first.headers.get("etag"), /ff47/);
  assert.match(second.headers.get("etag"), /ff48/);

  const unpublished = await portal.publicOverrides(get("/data/events/ff49/overrides.json"), "ff49");
  assert.equal(unpublished.status, 404);
});

test("each event retires its own content on its own end date", async () => {
  const portal = multiEventHandlers();
  const admin = await signIn("admin@example.com");
  const owner = await signIn("per-event-phase@example.com");
  await approve(owner, "ff47-site", admin);
  await handlers.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第一場的內容" } }, owner), "ff47-site");
  assert.equal((await handlers.setPostEventVisibility(post("/api/circle/ff47-site/visibility", { hidden: true }, owner), "ff47-site")).status, 200);

  // Past the first event's end but well before the second's. Borrowing one
  // event's dates for another would retire content on the wrong schedule — for
  // the circle that opted out, months early or months late.
  clock = Date.parse(EVENT_ENDS_AT) + 1000;
  assert.deepEqual((await (await portal.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47")).json()).overrides, []);
  const second = await portal.publicOverrides(get("/data/events/ff48/overrides.json"), "ff48");
  assert.match(second.headers.get("etag"), /during/, "the second event has not ended yet");
  clock = 1_786_500_000_000;
});

/**
 * #136 / ADR-0043. One account, several events: the identity is shared, the
 * authorization is not. Production builds one handler set per request from the
 * event the request names, so a second event is a second handler set over the
 * same repository — exactly what these tests construct.
 */
const SERVED_EVENTS = ["ff47", "ff48"];

function handlersForEvent(eventId, served = SERVED_EVENTS) {
  return createCirclePortalHandlers({
    ...handlerOptions,
    config: {
      ...handlerOptions.config,
      eventId,
      publishedEvent: async (id) => (served.includes(id)
        ? { dataUpdatedAt: handlerOptions.config.dataUpdatedAt, eventEndsAt: EVENT_ENDS_AT }
        : null),
    },
  });
}

test("a claim in one event authorizes nothing in another", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("owner@example.com");
  const first = handlersForEvent("ff47");
  const second = handlersForEvent("ff48");

  const created = await first.createClaim(post("/api/claims", { circleId: "ff47-site" }, owner));
  const { id } = await created.json();
  await first.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, admin));
  assert.equal((await first.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第一場" } }, owner), "ff47-site")).status, 200);

  // Same account, same circle id, other event: the ownership chain does not
  // cross, and nothing about the first event's content is readable through it.
  const written = await second.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第二場" } }, owner), "ff47-site");
  assert.equal(written.status, 403);
  assert.deepEqual((await (await second.listClaims(get("/api/claims", owner))).json()).claims, []);

  const firstDoc = await first.publicOverrides(get("/data/events/ff47/overrides.json"), "ff47");
  assert.equal((await firstDoc.json()).overrides.find((entry) => entry.circleId === "ff47-site").fields.saleInfo, "第一場");
  const secondDoc = await second.publicOverrides(get("/data/events/ff48/overrides.json"), "ff48");
  assert.deepEqual((await secondDoc.json()).overrides, []);
});

test("the same account holds its own claim in each event, and each answer says which", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("owner@example.com");
  const first = handlersForEvent("ff47");
  const second = handlersForEvent("ff48");

  for (const handlersForOne of [first, second]) {
    const created = await handlersForOne.createClaim(post("/api/claims", { circleId: "ff47-site" }, owner));
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await handlersForOne.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, admin))).status, 200);
  }

  const mineFirst = await (await first.listClaims(get("/api/claims", owner))).json();
  const mineSecond = await (await second.listClaims(get("/api/claims", owner))).json();
  assert.equal(mineFirst.eventId, "ff47");
  assert.equal(mineSecond.eventId, "ff48");
  assert.deepEqual(mineFirst.claims.map((claim) => claim.status), ["verified"]);
  assert.deepEqual(mineSecond.claims.map((claim) => claim.status), ["verified"]);
  assert.notEqual(mineFirst.claims[0].id, mineSecond.claims[0].id);

  assert.equal((await first.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第一場" } }, owner), "ff47-site")).status, 200);
  assert.equal((await second.putOverride(post("/api/circle/ff47-site/overrides", { fields: { saleInfo: "第二場" } }, owner), "ff47-site")).status, 200);
});

test("the admin queue is one event's, and says which event it is", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("owner@example.com");
  const first = handlersForEvent("ff47");
  const second = handlersForEvent("ff48");
  await first.createClaim(post("/api/claims", { circleId: "ff47-site" }, owner));

  const pending = await (await first.adminListClaims(get("/api/admin/claims", admin))).json();
  assert.equal(pending.eventId, "ff47");
  assert.deepEqual(pending.claims.map((claim) => claim.circleId), ["ff47-site"]);

  const other = await (await second.adminListClaims(get("/api/admin/claims", admin))).json();
  assert.equal(other.eventId, "ff48");
  assert.deepEqual(other.claims, []);
});

test("an event this deployment does not serve is a 404, not another event's data", async () => {
  const owner = await signIn("owner@example.com");
  const unknown = handlersForEvent("ff99");

  for (const [name, response] of [
    ["listClaims", await unknown.listClaims(get("/api/claims", owner))],
    ["createClaim", await unknown.createClaim(post("/api/claims", { circleId: "ff47-site" }, owner))],
    ["searchCatalog", await unknown.searchCatalog(get("/api/circle/search?q=社團", owner))],
    ["putOverride", await unknown.putOverride(post("/api/circle/ff47-site/overrides", { fields: {} }, owner), "ff47-site")],
  ]) {
    assert.equal(response.status, 404, `${name} must refuse an unserved event`);
  }

  // The account routes are not event-scoped: signing in and out has to keep
  // working whatever event the client last named.
  assert.equal((await unknown.session(get("/api/auth/session", owner))).status, 200);
});

test("a claim id from another event cannot be acted on through this one", async () => {
  const admin = await signIn("admin@example.com");
  const owner = await signIn("owner@example.com");
  const first = handlersForEvent("ff47");
  const second = handlersForEvent("ff48");

  // Challengeable, so the claim carries a token and `runChallenge` would have
  // work to do if the event check were not the first thing it did.
  const created = await first.createClaim(post("/api/claims", {
    circleId: "ff47-site", targetUrl: "https://circle.example/home",
  }, owner));
  const { id } = await created.json();

  // The owner's own claim, addressed through the other event's control plane.
  assert.equal((await second.withdrawClaim(post(`/api/claims/${id}`, {}, owner), id)).status, 404);
  assert.equal((await second.runChallenge(post(`/api/claims/${id}/challenge`, {}, owner), id)).status, 404);
  // And an admin decision, which would otherwise revoke ownership in one event
  // while rebuilding the other event's public document.
  assert.equal((await second.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, admin))).status, 404);
  assert.equal((await second.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "revoke" }, admin))).status, 404);

  // Untouched: still pending, and still this account's claim in its own event.
  const mine = await (await first.listClaims(get("/api/claims", owner))).json();
  assert.deepEqual(mine.claims.map((claim) => claim.status), ["pending"]);
  assert.equal((await first.adminDecideClaim(post("/api/admin/claims", { claimId: id, decision: "approve" }, admin))).status, 200);
  assert.equal(await repository.ownsCircle((await repository.getClaim(id)).account_id, "ff47", "ff47-site"), true);
  assert.equal(await repository.ownsCircle((await repository.getClaim(id)).account_id, "ff48", "ff47-site"), false);
});
