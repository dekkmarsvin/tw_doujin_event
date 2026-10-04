import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer } from "vite";
import { organizerRepositoryFixtureScript, resetOrganizerRepositoryFixture } from "./support/organizer-repository-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { createIdentityRepository } = await vite.environments.ssr.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await vite.environments.ssr.runner.import("/app/circle-portal-handlers.ts");
const { circleObjectPrefix } = await vite.environments.ssr.runner.import("/app/hosted-thumbnails.ts");
const { createEmptyOrganizerEventDraft } = await vite.environments.ssr.runner.import("/app/organizer-event.ts");
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: await organizerRepositoryFixtureScript(), d1Databases: { DB: "organizer-claims-test" } }));
const database = await runtime.getD1Database("DB");
const repo = createIdentityRepository(database);
after(async () => { await runtime.dispose(); await vite.close(); });
const now = 1_790_000_000_000;
const origin = "https://verify.example.test";
let ids, handlers, mail, options;
function request(candidate, cookie, decision, claimId = "claim-a") {
  return new Request(`${origin}/api/organizer/events/${candidate}/claims`, {
    method: decision ? "POST" : "GET",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(decision ? { "content-type": "application/json" } : {}) },
    ...(decision ? { body: JSON.stringify({ decision, claimId }) } : {}),
  });
}
async function signIn(email) {
  await handlers.requestLink(new Request(`${origin}/api/auth/request-link`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, audience: "organizer", turnstileToken: "test" }) }));
  const token = new URL(mail.at(-1).text.match(/https:\/\/\S+\/organizer\?login=\S+/)[0]).searchParams.get("login");
  const verified = await handlers.verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) }));
  return verified.headers.get("set-cookie").split(";")[0];
}
async function candidate(id, eventId, at = now, operation = "CREATE") {
  await repo.createOrganizerCandidate({ id, tentativeName: id, ownerEmail: "admin@example.test", createdByAccountId: ids.adminId, draftJson: JSON.stringify({ schema: "organizer-event-draft/1", event: { id: eventId, name: id, days: [] }, venue: { assignments: [] }, officialSource: { label: "", url: null } }), now: at });
  await database.prepare("UPDATE organizer_event_candidates SET publication_operation = ?2 WHERE id = ?1").bind(id, operation).run();
  await database.prepare("UPDATE organizer_event_candidates SET event_id = ?2 WHERE id = ?1").bind(id, eventId).run();
}
async function grant(candidateId, accountId, role) {
  await database.prepare("INSERT INTO organizer_event_grants (id, candidate_id, account_id, role, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(crypto.randomUUID(), candidateId, accountId, role, ids.adminId, now).run();
}
async function claim(id, eventId, circleId, accountId = ids.adminId) {
  await repo.createClaim({ id, eventId, circleId, accountId, circleNameKey: circleId, circleNameAtClaim: `社團 ${circleId}`, sourceRowAtClaim: null, status: "pending", method: null, targetUrl: null, challengeTokenHash: null, challengeExpiresAt: null, evidenceUrl: "https://circle.example.test/", evidenceNote: "佐證", now });
}
beforeEach(async () => {
  ids = await resetOrganizerRepositoryFixture(runtime, now);
  mail = [];
  options = { repository: repo, sendMail: async message => mail.push(message), lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test", projectCircle: async () => null,
    config: { eventId: "event-a", origin, sessionSecret: "test-secret", hashPepper: "test-pepper", adminEmails: ["admin@example.test"], dataUpdatedAt: "2026-10-01", eventEndsAt: "2026-12-31T23:59:59+08:00", now: () => now,
      publishedEvent: async id => ["event-a", "event-b"].includes(id) ? { dataUpdatedAt: id, eventEndsAt: id === "event-b" ? "2020-01-01" : "2030-01-01" } : null } };
  handlers = createCirclePortalHandlers(options);
  await candidate("candidate-a", "event-a");
  await candidate("candidate-b", "event-b");
  await database.prepare("UPDATE organizer_event_candidates SET status='published', published_version=1, published_at=?1, event_id_locked_at=?1 WHERE id IN ('candidate-a','candidate-b')").bind(now).run();
  await grant("candidate-a", ids.ownerId, "owner");
  await grant("candidate-a", ids.editorId, "editor");
  await claim("claim-a", "event-a", "c-1");
  await claim("claim-b", "event-b", "c-1");
});

for (const [email, account] of [["owner@example.test", "ownerId"], ["editor@example.test", "editorId"]]) {
  test(`${email} cannot turn an editable CREATE draft into a static event's moderation authority`, async () => {
    await candidate("attacker", "new-event");
    await grant("attacker", ids[account], account === "ownerId" ? "owner" : "editor");
    const eventId = "static-target", deleted = [];
    await claim("target-pending", eventId, "pending-circle");
    await claim("self-pending", eventId, "self-circle", ids[account]);
    await claim("protected-owner", eventId, "c-1");
    await repo.markClaimVerified("protected-owner", "admin", now, "admin@example.test");
    const key = `${circleObjectPrefix(eventId, "c-1")}image.webp`;
    await repo.putOverride({ eventId, circleId: "c-1", fieldsJson: '{"saleInfo":"protected"}',
      updatedBy: "admin@example.test", accountId: ids.adminId, now, hostedThumbnailKey: key });
    options.config.publishedEvent = async id => ["event-a", "event-b", eventId].includes(id)
      ? { dataUpdatedAt: id, eventEndsAt: "2030-01-01" } : null;
    handlers = takedownHandlers({ thumbnailStore: { list: async () => [key], delete: async keys => deleted.push(keys) } });
    const cookie = await signIn(email);
    const draft = createEmptyOrganizerEventDraft("New activity");
    draft.event.id = eventId;
    const saved = await handlers.updateOrganizerCandidate(new Request(`${origin}/api/organizer/events/attacker`, {
      method: "PATCH", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, draft }),
    }), "attacker");
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await repo.getOrganizerCandidate("attacker")).event_id, eventId);
    assert.equal((await handlers.organizerListClaims(request("attacker", cookie), "attacker")).status, 404);
    for (const decision of ["approve", "reject"]) {
      assert.equal((await handlers.organizerDecideClaim(request("attacker", cookie, decision, "target-pending"), "attacker")).status, 404);
    }
    assert.equal((await handlers.organizerDecideClaim(request("attacker", cookie, "approve", "self-pending"), "attacker")).status, 404);
    assert.equal((await handlers.organizerSearchTakedownCircles(overridesRequest("attacker", cookie), "attacker")).status, 404);
    assert.equal((await handlers.organizerTakedown(overridesRequest("attacker", cookie, { circleId: "c-1", reason: "attack" }), "attacker")).status, 404);

    // Exercise the SQL boundary independently of the entry guard.
    const authority = { candidateId: "attacker", accountId: ids[account] };
    assert.equal(await repo.markClaimVerified("target-pending", "organizer", now, email, authority), false);
    assert.equal(await repo.setClaimStatus("target-pending", "rejected", now, email, "pending", authority), false);
    assert.equal(await repo.setClaimStatus("protected-owner", "revoked", now, email, "verified", { ...authority, ownerOnly: true }), false);
    assert.equal((await repo.getClaim("protected-owner")).status, "verified");
    assert.equal(await repo.takedownOverride({ eventId, circleId: "c-1", reason: "attack", by: email, now, authority }), false);
    assert.equal((await repo.getClaim("target-pending")).status, "pending");
    assert.equal(await repo.ownsCircle(ids[account], eventId, "self-circle"), false);
    assert.equal((await repo.getOverride(eventId, "c-1")).status, "live");
    assert.equal((await repo.getOverride(eventId, "c-1")).hosted_thumbnail_key, key);
    assert.deepEqual(deleted, []);
  });
}

test("a locked, submitted CREATE draft still has no published-event moderation authority", async () => {
  await database.prepare("UPDATE organizer_event_candidates SET status='submitted', published_version=NULL WHERE id='candidate-a'").run();
  const cookie = await signIn("editor@example.test");
  assert.equal((await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a")).status, 404);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 404);
  assert.equal((await repo.getClaim("claim-a")).status, "pending");
});

function overridesRequest(candidateId, cookie, body, query = "社團") {
  return new Request(`${origin}/api/organizer/events/${candidateId}/overrides?q=${encodeURIComponent(query)}&event=event-b`, {
    method: body ? "POST" : "GET", headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function supplement(eventId, circleId = "c-1", media = false) {
  const claimId = eventId === "event-a" ? "claim-a" : "claim-b";
  await repo.markClaimVerified(claimId, "admin", now, "admin@example.test");
  const key = `${circleObjectPrefix(eventId, circleId)}image.webp`;
  await repo.putOverride({ eventId, circleId, fieldsJson: JSON.stringify({ saleInfo: eventId, ...(media ? { thumbnail: { url: "https://image.example.test/a.webp" } } : {}) }),
    updatedBy: "admin@example.test", accountId: ids.adminId, now, ...(media ? { hostedThumbnailKey: key } : {}) });
  return key;
}
function takedownHandlers(extra = {}) {
  return createCirclePortalHandlers({ ...options,
    lookupCircle: async (circleId, eventId) => circleId === "c-1" ? { id: circleId, name: `社團 ${eventId}`, nameKey: "社團", sourceRow: null, links: [] } : null,
    searchCircles: async (query, limit, eventId) => query === "社團" ? [{ id: "c-1", name: `社團 ${eventId}`, nameKey: "社團", sourceRow: null, links: [] }] : [],
    ...extra });
}

for (const [email, role] of [["owner@example.test", "organizer_owner"], ["editor@example.test", "organizer_editor"], ["admin@example.test", "admin"]]) {
  test(`${role} searches and withdraws only the candidate event supplement`, async () => {
    await supplement("event-a"); await supplement("event-b");
    const cookie = await signIn(email);
    handlers = takedownHandlers();
    const search = await handlers.organizerSearchTakedownCircles(overridesRequest("candidate-a", cookie), "candidate-a");
    assert.equal(search.status, 200);
    assert.deepEqual((await search.json()).circles, [{ circleId: "c-1", name: "社團 event-a", status: "live", verifiedClaimId: "claim-a" }],
      "the candidate event's approved claim is named so an Owner can revoke it; event-b's is not");
    const result = await handlers.organizerTakedown(overridesRequest("candidate-a", cookie, { circleId: "c-1", eventId: "event-b", reason: "權利人要求" }), "candidate-a");
    assert.equal(result.status, 200);
    assert.equal((await repo.getOverride("event-a", "c-1")).status, "takendown");
    assert.equal((await repo.getOverride("event-b", "c-1")).status, "live");
    assert.equal((await repo.getClaim("claim-a")).status, "verified");
    assert.deepEqual(JSON.parse((await repo.getOverridesDoc("event-a")).json).overrides, []);
    const audit = await database.prepare("SELECT actor_role,detail_json FROM audit_log WHERE action='override.organizer_takendown'").first();
    assert.equal(audit.actor_role, role);
    assert.equal(JSON.parse(audit.detail_json).eventId, "event-a");
    assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "重複" }), "candidate-a")).status, 404);
  });
}

test("takedown search and writes reject anonymous, outsiders, wrong candidates and unpublished events", async () => {
  await supplement("event-a");
  const owner = await signIn("owner@example.test"), outsider = await signIn("stranger@example.test");
  handlers = takedownHandlers();
  for (const [id, cookie, status] of [["candidate-a", null, 401], ["candidate-a", outsider, 404], ["candidate-b", owner, 404]]) {
    assert.equal((await handlers.organizerSearchTakedownCircles(overridesRequest(id, cookie), id)).status, status);
    assert.equal((await handlers.organizerTakedown(overridesRequest(id, cookie, { circleId: "c-1", reason: "測試" }), id)).status, status);
  }
  await candidate("unpublished-takedown", "not-served"); await grant("unpublished-takedown", ids.ownerId, "owner");
  assert.equal((await handlers.organizerSearchTakedownCircles(overridesRequest("unpublished-takedown", owner), "unpublished-takedown")).status, 404);
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", owner, { circleId: "other-event-circle", reason: "測試" }), "candidate-a")).status, 404);
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", owner, { circleId: "c-1", reason: "  " }), "candidate-a")).status, 400);
  assert.equal((await repo.getOverride("event-a", "c-1")).status, "live");
});

test("takedown rechecks revoked grants before changing content or deleting media", async () => {
  const key = await supplement("event-a", "c-1", true);
  const cookie = await signIn("editor@example.test");
  const deleted = [];
  handlers = takedownHandlers({ thumbnailStore: { list: async () => [key], delete: async key => deleted.push(key) },
    repository: { ...repo, takedownOverride: async input => {
      await database.prepare("UPDATE organizer_event_grants SET revoked_at=?1 WHERE account_id=?2").bind(now, ids.editorId).run();
      return repo.takedownOverride(input);
    } } });
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "測試" }), "candidate-a")).status, 404);
  assert.equal((await repo.getOverride("event-a", "c-1")).status, "live");
  assert.deepEqual(deleted, []);
});

test("takedown refuses a concurrent supplement edit without deleting its images", async () => {
  const key = await supplement("event-a", "c-1", true), deleted = [];
  const cookie = await signIn("editor@example.test");
  handlers = takedownHandlers({ thumbnailStore: { list: async () => [key], delete: async key => deleted.push(key) },
    repository: { ...repo, takedownOverride: async input => {
      await repo.putOverride({ eventId: "event-a", circleId: "c-1", fieldsJson: '{"saleInfo":"新的內容"}', updatedBy: "admin@example.test", now, accountId: ids.adminId });
      return repo.takedownOverride(input);
    } } });
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "測試" }), "candidate-a")).status, 409);
  assert.equal(JSON.parse((await repo.getOverride("event-a", "c-1")).fields_json).saleInfo, "新的內容");
  assert.deepEqual(deleted, []);
});

test("authorized takedown clears media references, removes scoped objects and preserves after-event hiding", async () => {
  const key = await supplement("event-b", "c-1", true), deleted = [];
  await grant("candidate-b", ids.editorId, "editor");
  await claim("hidden-claim", "event-b", "c-hidden", ids.ownerId);
  await repo.markClaimVerified("hidden-claim", "admin", now, "admin@example.test");
  await repo.putOverride({ eventId: "event-b", circleId: "c-hidden", fieldsJson: '{"saleInfo":"隱藏內容"}', updatedBy: "owner@example.test", now, accountId: ids.ownerId });
  await database.prepare("UPDATE circle_overrides SET post_event_hidden=1 WHERE circle_id='c-hidden'").run();
  const cookie = await signIn("editor@example.test");
  handlers = takedownHandlers({ thumbnailStore: { list: async prefix => { assert.equal(prefix, circleObjectPrefix("event-b", "c-1")); return [key]; }, delete: async key => deleted.push(key) } });
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-b", cookie, { circleId: "c-1", reason: "測試" }), "candidate-b")).status, 200);
  const row = await repo.getOverride("event-b", "c-1");
  assert.equal(row.hosted_thumbnail_key, null);
  assert.equal(JSON.parse(row.fields_json).thumbnail, null);
    assert.deepEqual(deleted, [[key]]);
  assert.deepEqual(JSON.parse((await repo.getOverridesDoc("event-b")).json).overrides, []);
});

test("an R2 failure leaves content withdrawn and permits authorized cleanup retry", async () => {
  const key = await supplement("event-a", "c-1", true);
  const cookie = await signIn("editor@example.test");
  const stored = new Set([key]);
  let fail = true;
  handlers = takedownHandlers({ thumbnailStore: { list: async () => [...stored], delete: async keys => {
    if (fail) throw new Error("temporary R2 failure");
    for (const key of keys) stored.delete(key);
  } } });
  const req = () => overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "初次撤下原因" });
  assert.equal((await handlers.organizerTakedown(req(), "candidate-a")).status, 503);
  assert.equal((await repo.getOverride("event-a", "c-1")).status, "takendown");
  assert.deepEqual(JSON.parse((await repo.getOverridesDoc("event-a")).json).overrides, []);
  const found = await (await handlers.organizerSearchTakedownCircles(overridesRequest("candidate-a", cookie), "candidate-a")).json();
  assert.equal(found.circles[0].cleanupPending, true);
  fail = false;
  assert.equal((await handlers.organizerTakedown(overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "清理重試" }), "candidate-a")).status, 200);
  assert.equal(stored.size, 0);
  assert.equal((await repo.getOverride("event-a", "c-1")).takedown_reason, "初次撤下原因");
  assert.equal((await handlers.organizerTakedown(req(), "candidate-a")).status, 404);
});

test("a cleanup retry cannot delete R2 after its organizer grant was revoked", async () => {
  const key = await supplement("event-a", "c-1", true), deleted = [];
  const cookie = await signIn("editor@example.test");
  const store = { list: async () => [key], delete: async () => { throw new Error("R2 failure"); } };
  handlers = takedownHandlers({ thumbnailStore: store });
  const req = () => overridesRequest("candidate-a", cookie, { circleId: "c-1", reason: "測試" });
  assert.equal((await handlers.organizerTakedown(req(), "candidate-a")).status, 503);
  handlers = takedownHandlers({ thumbnailStore: { ...store, delete: async keys => deleted.push(keys) }, repository: { ...repo, takedownOverride: async input => {
    await database.prepare("UPDATE organizer_event_grants SET revoked_at=?1 WHERE account_id=?2").bind(now, ids.editorId).run();
    return repo.takedownOverride(input);
  } } });
  assert.equal((await handlers.organizerTakedown(req(), "candidate-a")).status, 404);
  assert.deepEqual(deleted, []);
});

for (const [email, role] of [["owner@example.test", "organizer_owner"], ["editor@example.test", "organizer_editor"], ["admin@example.test", "admin"]]) {
  test(`${role} reads only its event and can approve a pending claim`, async () => {
    const cookie = await signIn(email);
    const response = await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a");
    assert.equal(response.status, 200);
    const queue = await response.json();
    assert.deepEqual(queue.claims.map(c => [c.id, c.eventId]), [["claim-a", "event-a"]]);
    assert.equal(queue.pendingClaimCount, 1);
    assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 200);
    assert.equal((await repo.getClaim("claim-a")).method, "organizer");
    assert.equal((await repo.getClaim("claim-b")).status, "pending");
    const audit = await database.prepare("SELECT actor_role, detail_json FROM audit_log WHERE action = 'claim.organizer_approve'").first();
    assert.equal(audit.actor_role, role);
    assert.equal(JSON.parse(audit.detail_json).eventId, "event-a");
  });
}

test("pending total includes claims beyond the 500-row queue limit and excludes other events", async () => {
  const cookie = await signIn("editor@example.test");
  await database.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<500)
    INSERT INTO circle_claims (id,account_id,event_id,circle_id,circle_name_key,circle_name_at_claim,status,created_at)
    SELECT 'bulk-'||n,c.account_id,c.event_id,'bulk-circle-'||n,'bulk-'||n,'社團 '||n,'pending',c.created_at+n
    FROM numbers CROSS JOIN circle_claims c WHERE c.id='claim-a'`).run();
  const queue = await (await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a")).json();
  assert.equal(queue.claims.length, 500);
  assert.equal(queue.pendingClaimCount, 501);
  assert.ok(queue.claims.every(claim => claim.eventId === "event-a"));
  await database.prepare("UPDATE circle_claims SET status='withdrawn' WHERE event_id='event-a' AND status='pending'").run();
  const empty = await (await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a")).json();
  assert.equal(empty.pendingClaimCount, 0);
  assert.deepEqual(empty.claims, []);
  assert.equal((await repo.getClaim("claim-b")).status, "pending");
});

test("anonymous, strangers, other events, and unpublished events cannot be reviewed", async () => {
  assert.equal((await handlers.organizerListClaims(request("candidate-a"), "candidate-a")).status, 401);
  const stranger = await signIn("stranger@example.test");
  assert.equal((await handlers.organizerListClaims(request("candidate-a", stranger), "candidate-a")).status, 404);
  const owner = await signIn("owner@example.test");
  assert.equal((await handlers.organizerListClaims(request("candidate-b", owner), "candidate-b")).status, 404);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", owner, "approve", "claim-b"), "candidate-a")).status, 404);
  await candidate("unpublished", "not-served");
  await grant("unpublished", ids.ownerId, "owner");
  assert.equal((await handlers.organizerListClaims(request("unpublished", owner), "unpublished")).status, 404);
  assert.equal((await repo.getClaim("claim-b")).status, "pending");
});

test("rejection cannot withdraw an approved owner, and editors cannot revoke", async () => {
  const cookie = await signIn("editor@example.test");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 200);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "reject"), "candidate-a")).status, 409);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 403);
  assert.equal((await repo.getClaim("claim-a")).status, "verified");
  await claim("reject-me", "event-a", "c-2");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "reject", "reject-me"), "candidate-a")).status, 200);
  assert.equal((await repo.getClaim("reject-me")).status, "rejected");
});

test("an owner revokes an approved claim in their event, which withdraws its content and is audited", async () => {
  await repo.markClaimVerified("claim-a", "admin", now, "admin@example.test");
  await repo.putOverride({ eventId: "event-a", circleId: "c-1", fieldsJson: '{"saleInfo":"wrong owner"}', updatedBy: "admin@example.test", accountId: ids.adminId, now });
  await repo.rebuildOverridesDoc("event-a", "2026-10-01", now, "during");
  assert.match(JSON.stringify(await repo.getOverridesDoc("event-a")), /wrong owner/);
  const cookie = await signIn("owner@example.test");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke", "claim-b"), "candidate-a")).status, 404, "another event's claim stays out of reach");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 200);
  assert.equal((await repo.getClaim("claim-a")).status, "revoked");
  assert.doesNotMatch(JSON.stringify(await repo.getOverridesDoc("event-a")), /wrong owner/, "the public document drops the revoked owner's content");
  const audit = await database.prepare("SELECT actor_role, detail_json FROM audit_log WHERE action = 'claim.organizer_revoke'").first();
  assert.equal(audit.actor_role, "organizer_owner");
  assert.equal(JSON.parse(audit.detail_json).candidateId, "candidate-a");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 409, "only an approved claim can be revoked");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke", "claim-pending"), "candidate-a")).status, 404);
  await claim("still-pending", "event-a", "c-2");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke", "still-pending"), "candidate-a")).status, 409);
  assert.equal((await repo.getClaim("still-pending")).status, "pending", "revoke never decides a pending claim");
});

test("an organizer revoke rebuilds the candidate's event, whatever event the request names", async () => {
  await repo.markClaimVerified("claim-a", "admin", now, "admin@example.test");
  await repo.putOverride({ eventId: "event-a", circleId: "c-1", fieldsJson: '{"saleInfo":"wrong owner"}', updatedBy: "admin@example.test", accountId: ids.adminId, now });
  await repo.rebuildOverridesDoc("event-a", "2026-10-01", now, "during");
  const cookie = await signIn("owner@example.test");
  // Production binds these to the request's `?event=`; an unserved one cannot be read at all.
  handlers = createCirclePortalHandlers({ ...options, config: { ...options.config,
    dataUpdatedAt: async () => { throw new Error("unserved request event"); },
    eventEndsAt: async () => { throw new Error("unserved request event"); } } });
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 200);
  assert.equal((await repo.getClaim("claim-a")).status, "revoked");
  const doc = JSON.parse((await repo.getOverridesDoc("event-a")).json);
  assert.equal(doc.generatedAt, "event-a", "the rebuild uses the candidate event's own published data");
  assert.doesNotMatch(JSON.stringify(doc), /wrong owner/);
});

test("revoke rechecks the Owner grant at the SQL write", async () => {
  await repo.markClaimVerified("claim-a", "admin", now, "admin@example.test");
  const cookie = await signIn("owner@example.test");
  handlers = createCirclePortalHandlers({ ...options, repository: { ...repo, setClaimStatus: async (...args) => {
    await database.prepare("UPDATE organizer_event_grants SET role = 'editor' WHERE account_id = ?1").bind(ids.ownerId).run();
    return repo.setClaimStatus(...args);
  } } });
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 403);
  assert.equal((await repo.getClaim("claim-a")).status, "verified", "a grant downgraded mid-request leaves the owner in place");
});

test("approval races preserve one owner and report circleClaimed in the shared queue", async () => {
  await claim("duplicate", "event-a", "c-1", ids.ownerId);
  const cookie = await signIn("editor@example.test");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 200);
  const queue = await (await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a")).json();
  assert.equal(queue.claims.find(c => c.id === "duplicate").circleClaimed, true);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve", "duplicate"), "candidate-a")).status, 409);
});

for (const decision of ["approve", "reject"]) {
  test(`${decision} rechecks revoked grants at the SQL write`, async () => {
    const cookie = await signIn("editor@example.test");
    const method = decision === "approve" ? "markClaimVerified" : "setClaimStatus";
    handlers = createCirclePortalHandlers({ ...options, repository: { ...repo, [method]: async (...args) => {
      await database.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE account_id = ?2").bind(now, ids.editorId).run();
      return repo[method](...args);
    } } });
    assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, decision), "candidate-a")).status, 404);
    assert.equal((await repo.getClaim("claim-a")).status, "pending");
  });
}

test("edition numbers remain chronological when earlier work is edited or only a later grant is visible", async () => {
  await candidate("amend-a", "event-a", now + 100, "AMEND");
  await grant("amend-a", ids.editorId, "editor");
  await database.prepare("UPDATE organizer_event_candidates SET updated_at = ?1 WHERE id = 'candidate-a'").bind(now + 200).run();
  let rows = await repo.listOrganizerCandidatesForAccount(ids.editorId, false);
  assert.equal(rows.find(c => c.id === "candidate-a").edition, 1);
  assert.equal(rows.find(c => c.id === "amend-a").edition, 2);
  await database.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = 'candidate-a' AND account_id = ?2").bind(now, ids.editorId).run();
  rows = await repo.listOrganizerCandidatesForAccount(ids.editorId, false);
  assert.deepEqual(rows.map(c => [c.id, c.edition]), [["amend-a", 2]]);
});
