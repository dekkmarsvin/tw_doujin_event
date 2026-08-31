import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await environment.runner.import("/app/circle-portal-handlers.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-handlers-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const ORIGIN = "https://verify.kotoban.top";
let now = 1_788_100_000_000;
let repository;
let handlers;
let sent;

function request(path, method = "GET", body, cookie) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function signIn(email, audience = "circle") {
  await handlers.requestLink(request("/api/auth/request-link", "POST", { email, turnstileToken: "solved", audience }));
  const path = audience === "organizer" ? "organizer" : "circle";
  const token = sent.at(-1).text.match(new RegExp(`/${path}\\?login=([^\\s]+)`))[1];
  return cookieFrom(await handlers.verify(request("/api/auth/verify", "POST", { token: decodeURIComponent(token) })));
}

beforeEach(async () => {
  sent = [];
  repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.test"] });
  await repository.ensureTables();
  await repository.clearPreviewData();
  await repository.addAdmin("admin@example.test", "bootstrap", now);
  handlers = createCirclePortalHandlers({
    repository,
    sendMail: async (message) => { sent.push(message); },
    lookupCircle: async () => null,
    searchCircles: async () => [],
    fetchEvidence: async () => null,
    verifyHuman: async () => true,
    turnstileSitekey: () => "test-sitekey",
    projectCircle: async () => null,
    config: {
      eventId: "ff47",
      origin: ORIGIN,
      sessionSecret: "test-session-secret",
      hashPepper: "test-pepper",
      adminEmails: ["admin@example.test"],
      dataUpdatedAt: "2026-08-30T00:00:00.000+08:00",
      eventEndsAt: "2026-12-31T23:59:59.999+08:00",
      now: () => now,
    },
  });
});

test("admin invitation creates an organizer event entry that only its owner can open", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events",
    "POST",
    { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" },
    adminCookie,
  ));
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.candidateId, /^[0-9a-f-]{36}$/);
  assert.match(sent.at(-1).text, /\/organizer\?login=/);

  const ownerCookie = await signIn("owner@example.test", "organizer");
  const listed = await handlers.listOrganizerCandidates(request("/api/organizer/events", "GET", undefined, ownerCookie));
  assert.equal(listed.status, 200);
  const events = (await listed.json()).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].role, "owner");

  const coOwner = await handlers.manageOrganizerCollaborators(request(
    `/api/organizer/events/${body.candidateId}/collaborators`, "POST",
    { email: "co-owner@example.test", role: "owner", action: "invite" }, adminCookie,
  ), body.candidateId);
  assert.equal(coOwner.status, 200);
  const coOwnerCookie = await signIn("co-owner@example.test", "organizer");
  const coOwnerDetail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${body.candidateId}`, "GET", undefined, coOwnerCookie,
  ), body.candidateId);
  assert.equal((await coOwnerDetail.json()).event.role, "owner");

  const strangerCookie = await signIn("stranger@example.test", "organizer");
  const hidden = await handlers.getOrganizerCandidate(request(`/api/organizer/events/${body.candidateId}`, "GET", undefined, strangerCookie), body.candidateId);
  assert.equal(hidden.status, 404);
});

test("organizer onboarding persists real progress and completes without a candidate revision", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");

  const listed = await handlers.listOrganizerCandidates(request("/api/organizer/events", "GET", undefined, ownerCookie));
  assert.equal((await listed.json()).events[0].workspaceMode, "guided");
  const initial = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  const initialBody = await initial.json();
  assert.equal(initialBody.workspace.mode, "guided");
  assert.deepEqual(initialBody.workspace.resume, { guidedTask: "identity_source", section: "event" });

  const invalid = await handlers.completeOrganizerWorkspaceOnboarding(request(
    `/api/organizer/events/${candidateId}/workspace/complete-onboarding`, "POST", { expectedVersion: 1 }, ownerCookie,
  ), candidateId);
  assert.equal(invalid.status, 422);
  assert.deepEqual((await invalid.json()).issues.map((issue) => issue.code), [
    "missing_event_id", "missing_source", "missing_days", "missing_venue",
  ]);

  const preference = await handlers.updateOrganizerWorkspacePreference(request(
    `/api/organizer/events/${candidateId}/workspace`, "PATCH",
    { guidedTask: "days", lastSection: "import" }, ownerCookie,
  ), candidateId);
  assert.equal(preference.status, 200);

  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
  };
  const saved = await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft }, ownerCookie,
  ), candidateId);
  assert.equal(saved.status, 200);

  const stale = await handlers.completeOrganizerWorkspaceOnboarding(request(
    `/api/organizer/events/${candidateId}/workspace/complete-onboarding`, "POST", { expectedVersion: 1 }, ownerCookie,
  ), candidateId);
  assert.equal(stale.status, 409);
  const completed = await handlers.completeOrganizerWorkspaceOnboarding(request(
    `/api/organizer/events/${candidateId}/workspace/complete-onboarding`, "POST", { expectedVersion: 2 }, ownerCookie,
  ), candidateId);
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).mode, "binder");

  const detail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  const detailBody = await detail.json();
  assert.equal(detailBody.workspace.mode, "binder");
  assert.deepEqual(detailBody.workspace.resume, { guidedTask: "days", section: "import" });
  assert.equal(detailBody.workspace.readiness.completed, 2);
  assert.equal(detailBody.event.version, 2);
  assert.deepEqual((await repository.listOrganizerCandidateRevisions(candidateId)).map((row) => row.version), [1, 2]);

  const repeat = await handlers.completeOrganizerWorkspaceOnboarding(request(
    `/api/organizer/events/${candidateId}/workspace/complete-onboarding`, "POST", { expectedVersion: 99 }, ownerCookie,
  ), candidateId);
  assert.equal(repeat.status, 409);
});

test("owner and editor use one validated optimistic workflow while only admin approves", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");

  const invited = await handlers.manageOrganizerCollaborators(request(
    `/api/organizer/events/${candidateId}/collaborators`, "POST",
    { email: "editor@example.test", action: "invite" }, ownerCookie,
  ), candidateId);
  assert.equal(invited.status, 200);
  const editorCookie = await signIn("editor@example.test", "organizer");

  const draft = {
    schema: "organizer-event-draft/1",
    event: {
      id: "pf45-rf14",
      name: "PF45 x RF14",
      days: [
        { id: "1", label: "第一日", date: "2026-11-07" },
      ],
    },
    venue: {
      assignments: [{ venueId: "taipei-flower-expo", venueSpaceId: "zhengyan", areaIds: ["ALL"], mapTemplate: "TAIWAN_GENERIC_V1" }],
    },
    officialSource: { label: "主辦提供名單", url: "https://organizer.example/pf45" },
  };
  const edited = await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH",
    { expectedVersion: 1, draft }, editorCookie,
  ), candidateId);
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).version, 2);

  const imported = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", {
      expectedVersion: 2,
      source: { fileName: "official.csv", worksheet: null, sha256: "a".repeat(64), sourceDescription: "主辦提供", mapping: { day: { fixed: "1" } } },
      rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: "zhengyan", areaId: "ALL", boothCode: "A01", circleName: "甲社", stableKey: null, identityGroup: null }],
    }, editorCookie,
  ), candidateId);
  assert.equal(imported.status, 200);
  const mapCreated = await handlers.createOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps`, "POST", {
      expectedVersion: 3, periodKey: "1", venueSpaceId: "zhengyan",
      layout: {
        version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
        floor: { x: 0, y: 0, width: 100, height: 80 },
        rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A01", rect: { x: 5, y: 5, width: 10, height: 8 } }] }],
        pillars: [], accessPoints: [], landmarks: [],
      },
    }, editorCookie,
  ), candidateId);
  assert.equal(mapCreated.status, 201);

  const validated = await handlers.validateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/validate`, "POST", {}, editorCookie,
  ), candidateId);
  assert.deepEqual((await validated.json()).issues, []);
  const validatedDetail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, editorCookie,
  ), candidateId);
  const validatedWorkspace = (await validatedDetail.json()).workspace;
  assert.equal(validatedWorkspace.readiness.completed, 5);
  assert.equal(validatedWorkspace.readiness.sections.find((section) => section.id === "validate").state, "complete");

  const editorSubmit = await handlers.submitOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/submit`, "POST", { expectedVersion: 4 }, editorCookie,
  ), candidateId);
  assert.equal(editorSubmit.status, 403);

  const submitted = await handlers.submitOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/submit`, "POST", { expectedVersion: 4 }, ownerCookie,
  ), candidateId);
  assert.equal(submitted.status, 200);

  const approved = await handlers.adminReviewOrganizerCandidate(request(
    `/api/admin/organizer/events/${candidateId}/review`, "POST",
    { expectedVersion: 4, decision: "approve", note: "資料可發布" }, adminCookie,
  ), candidateId);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, "approved");
});

test("import API persists confirmed normalized rows and rejects stale versions", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"] }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
  };
  const saved = await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft }, ownerCookie,
  ), candidateId);
  assert.equal(saved.status, 200);
  const payload = {
    expectedVersion: 2,
    source: {
      fileName: "official.xlsx", worksheet: "Day 1", sha256: "a".repeat(64),
      sourceDescription: "主辦提供", mapping: { day: { fixed: "1" } },
    },
    rows: [{
      sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "A",
      boothCode: "A01", circleName: "甲社", stableKey: null, identityGroup: null,
    }],
  };
  const imported = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", payload, ownerCookie,
  ), candidateId);
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).version, 3);
  assert.equal((await repository.getOrganizerImport(candidateId)).rows[0].circle_name, "甲社");

  const stale = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", payload, ownerCookie,
  ), candidateId);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).conflict.currentVersion, 3);
});

test("import API tells the organizer which limit rejected the batch", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "pf45-limits", name: "PF45", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"] }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
  };
  const saved = await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft }, ownerCookie,
  ), candidateId);
  assert.equal(saved.status, 200);
  const source = {
    fileName: "official.xlsx", worksheet: "Day 1", sha256: "a".repeat(64),
    sourceDescription: "主辦提供", mapping: { day: { fixed: "1" } },
  };
  const row = (index, circleName) => ({
    sourceRow: index + 2, dayId: "1", venueSpaceId: "hall-a", areaId: "A",
    boothCode: `A${index}`, circleName, stableKey: null, identityGroup: null,
  });

  const tooManyRows = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT",
    { expectedVersion: 2, source, rows: Array.from({ length: 20_001 }, (_, index) => row(index, "甲社")) },
    ownerCookie,
  ), candidateId);
  assert.equal(tooManyRows.status, 400);
  assert.equal((await tooManyRows.json()).error, "正規化資料列最多 20,000 筆。");

  // 20,000 rows of maximum-length names stay under the row cap but blow past
  // the byte cap, so this is the only request that reaches the 413.
  const longName = "社".repeat(200);
  const tooManyBytes = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT",
    { expectedVersion: 2, source, rows: Array.from({ length: 20_000 }, (_, index) => row(index, longName)) },
    ownerCookie,
  ), candidateId);
  assert.equal(tooManyBytes.status, 413);
  // Replace semantics make batching a data-losing suggestion, so the message
  // must never offer it.
  const message = (await tooManyBytes.json()).error;
  assert.match(message, /縮短欄位內容/u);
  assert.doesNotMatch(message, /分批/u);
  assert.equal(await repository.getOrganizerImport(candidateId), null);
});

test("organizer map API keeps one candidate-scoped immutable map revision stream", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "pf45", name: "PF45", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
    officialSource: { label: "主辦", url: "https://organizer.example/pf45" },
  };
  await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft }, ownerCookie,
  ), candidateId);
  const layout = {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
    floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
  };
  const mapCreated = await handlers.createOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps`, "POST",
    { expectedVersion: 2, periodKey: "1", venueSpaceId: "hall-a", layout }, ownerCookie,
  ), candidateId);
  assert.equal(mapCreated.status, 201);
  const { draftId } = await mapCreated.json();

  const listed = await handlers.listOrganizerMaps(request(
    `/api/organizer/events/${candidateId}/maps`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.deepEqual((await listed.json()).maps.map((item) => [item.periodKey, item.venueSpaceId, item.mapRevision]), [["1", "hall-a", 1]]);

  layout.landmarks.push({ id: "stage", kind: "stage", label: "舞台", rect: { x: 4, y: 4, width: 10, height: 10 } });
  const saved = await handlers.updateOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps/${draftId}`, "PATCH",
    { expectedVersion: 3, expectedMapRevision: 1, layout }, ownerCookie,
  ), candidateId, draftId);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, version: 4, mapRevision: 2 });
});

/**
 * An Owner is an invited third party, not staff. Invitations mint real login
 * tokens, so an unmetered invite endpoint would be an open sign-in-link sender
 * — and, because invitations are counted per inbox, a way to burn a victim's
 * own hourly budget until they cannot sign in to the account they already have.
 */
test("organizer invitations are metered like every other login link", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const invite = (email) => handlers.manageOrganizerCollaborators(request(
    `/api/organizer/events/${candidateId}/collaborators`, "POST",
    { email, action: "invite" }, ownerCookie,
  ), candidateId);

  // Distinct addresses are capped by the actor's own hourly budget.
  const statuses = [];
  for (let index = 0; index < 12; index += 1) statuses.push((await invite(`editor${index}@example.test`)).status);
  assert.equal(statuses.filter((status) => status === 200).length, 10);
  assert.deepEqual([...new Set(statuses.filter((status) => status !== 200))], [429]);
  // Ten editor links, plus the one the admin minted for the Owner itself.
  assert.equal(sent.filter((mail) => mail.subject.includes("Organizer 邀請")).length, 11);

  // A refused invitation leaves no row claiming someone was invited.
  const pending = await database.prepare(
    "SELECT COUNT(*) AS total FROM organizer_event_invitations WHERE candidate_id = ?1 AND role = 'editor'",
  ).bind(candidateId).first();
  assert.equal(pending.total, 10);
});

test("an invitation flood cannot lock the target out of their own sign-in", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const target = "victim@example.test";
  const cycle = (action) => handlers.manageOrganizerCollaborators(request(
    `/api/organizer/events/${candidateId}/collaborators`, "POST",
    { email: target, action }, ownerCookie,
  ), candidateId);

  // Revoke/invite cycles are the way around the pending-invitation unique key.
  let refused = 0;
  for (let index = 0; index < 8; index += 1) {
    if ((await cycle("invite")).status === 429) refused += 1;
    await cycle("revoke");
  }
  assert.ok(refused > 0, "the per-inbox invitation budget must stop the cycle");
  assert.equal(sent.filter((mail) => mail.to === target).length, 3);

  // The target keeps their own sign-in budget intact: the invitations were
  // charged to the inviter's inbox budget, not spent out of the target's.
  for (let index = 0; index < 5; index += 1) {
    const own = await handlers.requestLink(request(
      "/api/auth/request-link", "POST", { email: target, turnstileToken: "solved" },
    ));
    assert.equal(own.status, 202, `self-service request ${index + 1} must still be accepted`);
  }
  const exhausted = await handlers.requestLink(request(
    "/api/auth/request-link", "POST", { email: target, turnstileToken: "solved" },
  ));
  assert.equal(exhausted.status, 429, "the target's own budget still applies to itself");
});
