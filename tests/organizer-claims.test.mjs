import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer } from "vite";
import { organizerRepositoryFixtureScript, resetOrganizerRepositoryFixture } from "./support/organizer-repository-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { createIdentityRepository } = await vite.environments.ssr.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await vite.environments.ssr.runner.import("/app/circle-portal-handlers.ts");
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
      publishedEvent: async id => ["event-a", "event-b"].includes(id) ? { id } : null } };
  handlers = createCirclePortalHandlers(options);
  await candidate("candidate-a", "event-a");
  await candidate("candidate-b", "event-b");
  await grant("candidate-a", ids.ownerId, "owner");
  await grant("candidate-a", ids.editorId, "editor");
  await claim("claim-a", "event-a", "c-1");
  await claim("claim-b", "event-b", "c-1");
});

for (const [email, role] of [["owner@example.test", "organizer_owner"], ["editor@example.test", "organizer_editor"], ["admin@example.test", "admin"]]) {
  test(`${role} reads only its event and can approve a pending claim`, async () => {
    const cookie = await signIn(email);
    const response = await handlers.organizerListClaims(request("candidate-a", cookie), "candidate-a");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).claims.map(c => [c.id, c.eventId]), [["claim-a", "event-a"]]);
    assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 200);
    assert.equal((await repo.getClaim("claim-a")).method, "organizer");
    assert.equal((await repo.getClaim("claim-b")).status, "pending");
    const audit = await database.prepare("SELECT actor_role, detail_json FROM audit_log WHERE action = 'claim.organizer_approve'").first();
    assert.equal(audit.actor_role, role);
    assert.equal(JSON.parse(audit.detail_json).eventId, "event-a");
  });
}

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

test("rejection cannot withdraw an approved owner, and organizer routes never revoke", async () => {
  const cookie = await signIn("editor@example.test");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "approve"), "candidate-a")).status, 200);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "reject"), "candidate-a")).status, 409);
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "revoke"), "candidate-a")).status, 400);
  assert.equal((await repo.getClaim("claim-a")).status, "verified");
  await claim("reject-me", "event-a", "c-2");
  assert.equal((await handlers.organizerDecideClaim(request("candidate-a", cookie, "reject", "reject-me"), "candidate-a")).status, 200);
  assert.equal((await repo.getClaim("reject-me")).status, "rejected");
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
    assert.notEqual((await handlers.organizerDecideClaim(request("candidate-a", cookie, decision), "candidate-a")).status, 200);
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
