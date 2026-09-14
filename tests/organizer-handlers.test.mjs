import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
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
const { QUEUED_PUBLICATION_TIMEOUT_MS } = await environment.runner.import("/app/organizer-publication.ts");
const { publicationFailureMessage } = await environment.runner.import("/app/organizer-publication-presentation.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-handlers-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const ORIGIN = "https://verify.kotoban.top";
const VENUE_ID = "taipei-expo-park-zhengyan-hall";
const VENUE_SPACE_ID = "zhengyan-exhibition-area";
let now = 1_788_100_000_000;
let repository;
let handlers;
let handlerOptions;
let sent;
let objects;

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

async function createReferenceSelection(candidateId, cookie, expectedVersion = 1) {
  const path = `/api/organizer/events/${candidateId}/references`;
  const organizer = await handlers.createOrganizerReferenceEntry(request(path, "POST", {
    expectedVersion, kind: "organizer", name: "測試主辦", sourceUrl: "https://organizer.example/",
  }, cookie), candidateId);
  assert.equal(organizer.status, 201);
  const organizerId = (await organizer.json()).created.id;
  const catalog = await handlers.createOrganizerReferenceEntry(request(path, "POST", {
    expectedVersion, kind: "category-catalog", organizerId, name: "官方分類", sourceUrl: "https://organizer.example/categories",
    categories: [{ label: "原創", description: "原創作品" }, { label: "二創", description: "" }],
  }, cookie), candidateId);
  assert.equal(catalog.status, 201);
  return { organizerAssignments: [{ organizerId, role: "lead" }], categoryCatalog: (await catalog.json()).created };
}

async function signIn(email, audience = "circle") {
  await handlers.requestLink(request("/api/auth/request-link", "POST", { email, turnstileToken: "solved", audience }));
  const path = audience === "organizer" ? "organizer" : "circle";
  const token = sent.at(-1).text.match(new RegExp(`/${path}\\?login=([^\\s]+)`))[1];
  return cookieFrom(await handlers.verify(request("/api/auth/verify", "POST", { token: decodeURIComponent(token) })));
}

// Built once: `ensureTables` memoizes on the repository closure, so a fresh
// repository per test re-ran the whole schema. Per-test isolation comes from
// clearPreviewData() below, not from rebuilding the tables.
before(async () => {
  repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.test"] });
  await repository.ensureTables();
});

beforeEach(async () => {
  sent = [];
  objects = new Map();
  await repository.clearPreviewData();
  await repository.addAdmin("admin@example.test", "bootstrap", now);
  handlerOptions = {
    repository,
    sendMail: async (message) => { sent.push(message); },
    mapContributionStore: {
      put: async (key, value, contentType) => { objects.set(key, { bytes: Buffer.from(value), contentType }); },
      get: async (key) => {
        const object = objects.get(key);
        return object ? { body: object.bytes, contentType: object.contentType } : null;
      },
      delete: async (keys) => { for (const key of [keys].flat()) objects.delete(key); },
    },
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
  };
  handlers = createCirclePortalHandlers(handlerOptions);
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

/**
 * The admin who names themselves the owner used to hold the `admin` event role
 * until they opened the mailed link. The submit control is rendered only for
 * `owner`, so an admin could build a whole activity and never see it — not
 * disabled, absent. Only admins may add Owners at all, so the trip through the
 * mailbox proved nothing.
 */
test("an admin who creates an activity for themselves is its owner without opening the invitation", async () => {
  const adminCookie = await signIn("admin@example.test");
  const sentBefore = sent.length;
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "Comic Horizon 20", ownerEmail: "admin@example.test" }, adminCookie,
  ));
  assert.equal(created.status, 201);
  const { candidateId } = await created.json();

  // The session that created the activity opens it; no second sign-in, no mail.
  const detail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, adminCookie,
  ), candidateId);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).event.role, "owner");

  // The audit says the grant came from creating the activity, not from
  // accepting an invitation.
  const actions = (await database.prepare("SELECT action FROM audit_log WHERE subject_id = ?1 ORDER BY at, action")
    .bind(candidateId).all()).results.map((row) => row.action);
  assert.deepEqual(actions, ["organizer_event.created", "organizer_event.owner_granted_on_create"]);

  // The invitation is spent at creation, so signing in through the link that
  // still goes out cannot mint a second grant.
  assert.equal(sent.length, sentBefore + 1);
  await signIn("admin@example.test", "organizer");
  const grants = await database.prepare(
    "SELECT COUNT(*) AS total FROM organizer_event_grants WHERE candidate_id = ?1 AND role = 'owner' AND revoked_at IS NULL",
  ).bind(candidateId).first();
  assert.equal(grants.total, 1);
});

test("an activity created for someone else still waits for that owner to accept the invitation", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF46", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();

  assert.equal((await database.prepare(
    "SELECT COUNT(*) AS total FROM organizer_event_grants WHERE candidate_id = ?1",
  ).bind(candidateId).first()).total, 0);
  const adminDetail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, adminCookie,
  ), candidateId);
  assert.equal((await adminDetail.json()).event.role, "admin");

  const ownerCookie = await signIn("owner@example.test", "organizer");
  const ownerDetail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.equal((await ownerDetail.json()).event.role, "owner");
});

test("an event organizer can list and immediately extend the shared venue catalog", async () => {
  const adminCookie = await signIn("admin@example.test");
  const createdCandidate = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "新場館測試", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await createdCandidate.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");

  const initial = await handlers.listOrganizerVenues(request(
    `/api/organizer/events/${candidateId}/venues`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).venues.length, 4);

  const missingSource = await handlers.createOrganizerVenue(request(
    `/api/organizer/events/${candidateId}/venues`, "POST", {
      name: "沒有來源的場館", sourceUrl: null,
      initialSpace: { name: "全館", sourceUrl: null, defaultAreaMode: "none" },
    }, ownerCookie,
  ), candidateId);
  assert.equal(missingSource.status, 400);

  const createdVenue = await handlers.createOrganizerVenue(request(
    `/api/organizer/events/${candidateId}/venues`, "POST", {
      name: "松山文創園區",
      sourceUrl: "https://venue.example/songshan",
      initialSpace: {
        name: "1 號倉庫",
        sourceUrl: "https://venue.example/songshan/1",
        defaultAreaMode: "imported",
      },
    }, ownerCookie,
  ), candidateId);
  assert.equal(createdVenue.status, 201);
  const createdVenueBody = await createdVenue.json();
  assert.match(createdVenueBody.venue.id, /^venue-[0-9a-f-]{36}$/u);
  assert.match(createdVenueBody.space.id, /^venue-space-[0-9a-f-]{36}$/u);
  assert.equal(createdVenueBody.space.venueId, createdVenueBody.venue.id);

  const createdSpace = await handlers.createOrganizerVenueSpace(request(
    `/api/organizer/events/${candidateId}/venues/${createdVenueBody.venue.id}/spaces`, "POST", {
      name: "4 號倉庫",
      sourceUrl: "https://venue.example/songshan/4",
      defaultAreaMode: "none",
    }, ownerCookie,
  ), candidateId, createdVenueBody.venue.id);
  assert.equal(createdSpace.status, 201);
  const createdSpaceBody = await createdSpace.json();
  assert.equal(createdSpaceBody.space.defaultAreaMode, "none");

  const missingSpaceSource = await handlers.createOrganizerVenueSpace(request(
    `/api/organizer/events/${candidateId}/venues/${createdVenueBody.venue.id}/spaces`, "POST", {
      name: "沒有來源的空間", sourceUrl: "", defaultAreaMode: "none",
    }, ownerCookie,
  ), candidateId, createdVenueBody.venue.id);
  assert.equal(missingSpaceSource.status, 400);

  const refreshed = await handlers.listOrganizerVenues(request(
    `/api/organizer/events/${candidateId}/venues`, "GET", undefined, ownerCookie,
  ), candidateId);
  const catalog = await refreshed.json();
  const songshan = catalog.venues.find(({ id }) => id === createdVenueBody.venue.id);
  assert.deepEqual(songshan.spaces.map(({ name }) => name), ["1 號倉庫", "4 號倉庫"]);

  const audit = await database.prepare(
    "SELECT action FROM audit_log WHERE subject_id IN (?1, ?2) ORDER BY at, action",
  ).bind(createdVenueBody.venue.id, createdSpaceBody.space.id).all();
  assert.equal(audit.results.some(({ action }) => action === "organizer_venue.created"), true);

  const strangerCookie = await signIn("stranger@example.test", "organizer");
  const hidden = await handlers.listOrganizerVenues(request(
    `/api/organizer/events/${candidateId}/venues`, "GET", undefined, strangerCookie,
  ), candidateId);
  assert.equal(hidden.status, 404);
});

test("candidate updates reject missing and mismatched venue catalog references", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "Reference 驗證", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const base = {
    schema: "organizer-event-draft/1",
    event: { id: "reference-validation", name: "Reference 驗證", days: [] },
    venue: { assignments: [] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/reference" },
  };
  const save = (assignment) => handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH",
    { expectedVersion: 1, draft: { ...base, venue: { assignments: [assignment] } } }, ownerCookie,
  ), candidateId);

  const unknownVenue = await save({ venueId: "missing-venue", venueSpaceId: VENUE_SPACE_ID, areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1" });
  assert.equal(unknownVenue.status, 422);
  assert.equal((await unknownVenue.json()).issues[0].code, "unknown_venue");
  const unknownSpace = await save({ venueId: VENUE_ID, venueSpaceId: "missing-space", areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1" });
  assert.equal(unknownSpace.status, 422);
  assert.equal((await unknownSpace.json()).issues[0].code, "unknown_venue_space");
  const mismatch = await save({
    venueId: "taipei-nangang-exhibition-center-hall-1",
    venueSpaceId: "taipei-nangang-exhibition-center-hall-2-1f",
    areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1",
  });
  assert.equal(mismatch.status, 422);
  assert.equal((await mismatch.json()).issues[0].code, "venue_space_mismatch");

  const invalidMode = await save({ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["ALL"], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "unknown" });
  assert.equal(invalidMode.status, 400);
  const invalidNoDivision = await save({ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "none" });
  assert.equal(invalidNoDivision.status, 400);
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
    "missing_event_id", "missing_source", "invalid_source_url", "missing_days", "missing_venue",
  ]);

  const preference = await handlers.updateOrganizerWorkspacePreference(request(
    `/api/organizer/events/${candidateId}/workspace`, "PATCH",
    { guidedTask: "days", lastSection: "import" }, ownerCookie,
  ), candidateId);
  assert.equal(preference.status, 200);

  const draft = {
    references: await createReferenceSelection(candidateId, ownerCookie),
    schema: "organizer-event-draft/1",
    event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
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
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).mode, "binder");
});

test("organizer detail uses formal map validation for readiness", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "地圖 readiness 測試", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const draft = {
    references: await createReferenceSelection(candidateId, ownerCookie),
    schema: "organizer-event-draft/1",
    event: { id: "map-readiness", name: "地圖 readiness 測試", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/map-readiness" },
  };
  assert.equal((await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft }, ownerCookie,
  ), candidateId)).status, 200);
  assert.equal((await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", {
      expectedVersion: 2,
      source: { fileName: "official.csv", worksheet: null, sha256: "b".repeat(64), sourceDescription: "主辦提供", mapping: { day: { fixed: "1" } } },
      rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: VENUE_SPACE_ID, areaId: "A", codes: ["A01"], circleName: "甲社", stableKey: null, identityGroup: null }],
    }, ownerCookie,
  ), candidateId)).status, 200);
  assert.equal((await handlers.createOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps`, "POST", {
      expectedVersion: 3, periodKey: "1", venueSpaceId: VENUE_SPACE_ID,
      layout: {
        version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
        floor: { x: 0, y: 0, width: 100, height: 80 },
        rows: [], pillars: [], accessPoints: [], landmarks: [],
      },
    }, ownerCookie,
  ), candidateId)).status, 201);

  const detail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  const readiness = (await detail.json()).workspace.readiness;
  assert.equal(readiness.sections.find((section) => section.id === "map").state, "needs_attention");
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "missing_booth"), true);
  const validated = await handlers.validateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/validate`, "POST", {}, ownerCookie,
  ), candidateId);
  const missing = (await validated.json()).issues.find((issue) => issue.code === "missing_booth");
  assert.deepEqual(missing.boothCodes, ["A01"]);
  assert.equal(missing.target, `1/${VENUE_SPACE_ID}`);
});

test("owner and editor use one validated optimistic workflow while only admin approves", async (t) => {
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
    references: await createReferenceSelection(candidateId, ownerCookie),
    schema: "organizer-event-draft/1",
    event: {
      id: "pf45-rf14",
      name: "PF45 x RF14",
      days: [
        { id: "1", label: "第一日", date: "2026-11-07" },
      ],
    },
    venue: {
      assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["ALL"], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "none" }],
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
      rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: VENUE_SPACE_ID, areaId: "來源中的假分區", codes: ["A01", "A02"], circleName: "甲社", stableKey: null, identityGroup: null }],
    }, editorCookie,
  ), candidateId);
  assert.equal(imported.status, 200);
  assert.equal((await repository.getOrganizerImport(candidateId)).rows[0].area_id, "ALL");
  const mapCreated = await handlers.createOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps`, "POST", {
      expectedVersion: 3, periodKey: "1", venueSpaceId: VENUE_SPACE_ID,
      layout: {
        version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
        floor: { x: 0, y: 0, width: 100, height: 80 },
        rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A01", rect: { x: 5, y: 5, width: 10, height: 8 } }, { code: "A02", rect: { x: 20, y: 5, width: 10, height: 8 } }] }],
        pillars: [], accessPoints: [], landmarks: [],
      },
    }, editorCookie,
  ), candidateId);
  assert.equal(mapCreated.status, 201);

  // The repository outlives this test, so the stub is restored by a hook as
  // well as inline: an assertion failing before the inline restore would
  // otherwise leak it into every later test.
  const markOrganizerValidated = repository.markOrganizerValidated;
  t.after(() => { repository.markOrganizerValidated = markOrganizerValidated; });
  repository.markOrganizerValidated = async (id, version, at) => {
    const candidate = await repository.getOrganizerCandidate(id);
    await repository.saveOrganizerCandidate({
      candidateId: id,
      actorAccountId: candidate.created_by,
      expectedVersion: version,
      eventId: candidate.event_id,
      draftJson: candidate.current_draft_json,
      now: at,
      admin: true,
    });
    return markOrganizerValidated(id, version, at);
  };
  const racedValidation = await handlers.validateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/validate`, "POST", {}, editorCookie,
  ), candidateId);
  assert.equal(racedValidation.status, 409);
  assert.equal((await racedValidation.json()).conflict.currentVersion, 5);
  repository.markOrganizerValidated = markOrganizerValidated;

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

  const preview = await handlers.previewOrganizerCandidate(request(`/api/organizer/events/${candidateId}/preview`, "POST", {}, ownerCookie), candidateId);
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).preview.placements.map((row) => [row.boothCode, row.circleName]), [["A01", "甲社"], ["A02", "甲社"]]);
  const editorSubmit = await handlers.submitOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/submit`, "POST", { expectedVersion: 5 }, editorCookie,
  ), candidateId);
  assert.equal(editorSubmit.status, 403);

  const submitted = await handlers.submitOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/submit`, "POST", { expectedVersion: 5 }, ownerCookie,
  ), candidateId);
  assert.equal(submitted.status, 200);
  const submissionSnapshot = JSON.parse((await repository.getOrganizerSubmissionSnapshot(candidateId, 5)).snapshot_json);
  assert.equal(submissionSnapshot.schema, "organizer-submission-snapshot/3");
  assert.deepEqual(submissionSnapshot.import.rows[0].codes, ["A01", "A02"]);
  assert.equal(Object.hasOwn(submissionSnapshot.import.rows[0], "boothCode"), false);
  const referenceFiles = new Map(submissionSnapshot.references.files.map((file) => [file.path, new TextEncoder().encode(file.content)]));
  const { verifyReferenceFiles } = await import('../scripts/reference-selection-utils.mjs');
  verifyReferenceFiles(submissionSnapshot.references.selection, referenceFiles, 'pf45-rf14');
  assert.equal(JSON.parse(submissionSnapshot.references.files.find((file) => file.path.endsWith('/zhengyan-exhibition-area.json')).content).name, '爭艷館展區');
  assert.equal(submissionSnapshot.contentUpdatedAt, new Date((await repository.listOrganizerCandidateRevisions(candidateId)).find((row) => row.version === 5).created_at).toISOString());
  const { createHash } = await import('node:crypto');
  for (const file of submissionSnapshot.references.files) assert.equal(createHash('sha256').update(file.content).digest('hex'), file.sha256);
  const beforeCatalogChange = await repository.getOrganizerSubmissionSnapshot(candidateId, 5);
  const { buildApprovedPublicationArtifacts } = await environment.runner.import('/app/publication-artifacts.ts');
  const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson: beforeCatalogChange.snapshot_json, approvalHash: beforeCatalogChange.sha256 });
  assert.deepEqual(artifacts.official.days[0].booths[0], { codes: ['A01', 'A02'], name: '甲社', areaId: 'ALL' });
  await database.prepare("UPDATE organizer_reference_records SET display_name = '新版顯示名稱' WHERE kind = 'category-catalog'").run();
  assert.deepEqual(await repository.getOrganizerSubmissionSnapshot(candidateId, 5), beforeCatalogChange);
  const { readFile } = await import('node:fs/promises');
  const definition = JSON.parse(await readFile(new URL('../fixtures/events/sample/event.json', import.meta.url), 'utf8'));
  const { parseEventDefinition } = await environment.runner.import('/app/event-catalog.ts');
  const publishedShape = { ...definition, id: 'pf45-rf14', organizerAssignments: draft.references.organizerAssignments,
    categoryCatalog: draft.references.categoryCatalog,
    venueAssignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ['north', 'south'] }] };
  assert.equal(parseEventDefinition(publishedShape, submissionSnapshot.references.files.map((file) => JSON.parse(file.content))).organizerAssignments[0].name, '測試主辦');

  const disabled = await handlers.adminReviewOrganizerCandidate(request(
    `/api/admin/organizer/events/${candidateId}/review`, "POST",
    { expectedVersion: 5, decision: "approve" }, adminCookie,
  ), candidateId);
  assert.equal(disabled.status, 503);
  assert.equal((await repository.getOrganizerCandidate(candidateId)).status, "submitted");
  assert.equal(await repository.getLatestOrganizerPublicationJob(candidateId), null);
  const dispatched = [];
  handlers = createCirclePortalHandlers({ ...handlerOptions,
    config: { ...handlerOptions.config, organizerPublicationMode: "fake" },
    dispatchOrganizerPublication: async (jobId) => { dispatched.push(jobId); },
  });
  const approved = await handlers.adminReviewOrganizerCandidate(request(
    `/api/admin/organizer/events/${candidateId}/review`, "POST",
    { expectedVersion: 5, decision: "approve", note: "資料可發布" }, adminCookie,
  ), candidateId);
  assert.equal(approved.status, 200);
  const approval = await approved.json();
  assert.equal(approval.status, "queued");
  assert.equal((await repository.getOrganizerCandidate(candidateId)).status, "publishing");
  assert.deepEqual(dispatched, [approval.publicationJobId]);
  const jobId = approval.publicationJobId;
  const repeated = await handlers.adminReviewOrganizerCandidate(request(
    `/api/admin/organizer/events/${candidateId}/review`, "POST",
    { expectedVersion: 5, decision: "approve" }, adminCookie,
  ), candidateId);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).publicationJobId, jobId);
  assert.deepEqual(dispatched, [jobId], "approval replay must not dispatch again");
  for (const id of [jobId, "missing-job"]) {
    const response = await handlers.adminRetryOrganizerPublication(request(`/api/organizer/publications/${id}/retry`, "POST", {}), id);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "尚未登入。" });
  }
  // Workspace reads do not expire jobs. Cron owns the timeout even when no
  // user opens the workspace; the resulting UI still explains it never began.
  now += QUEUED_PUBLICATION_TIMEOUT_MS;
  const beforeTimeout = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.equal((await beforeTimeout.json()).publication.status, "queued");
  await repository.expireStalledOrganizerPublicationJobs({ now, timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS });
  const stalled = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  const neverStarted = (await stalled.json()).publication;
  assert.equal(neverStarted.status, "failed");
  assert.equal(neverStarted.step, "preparing_data", "approval creates the job here, not on assemble");
  assert.equal(neverStarted.started, false);
  assert.match(publicationFailureMessage(neverStarted), /發布沒有開始/);
  assert.equal((await handlers.adminRetryOrganizerPublication(request(
    `/api/organizer/publications/${jobId}/retry`, "POST", {}, ownerCookie,
  ), jobId)).status, 200);
  assert.deepEqual(dispatched, [jobId, jobId]);

  const lease = await repository.claimOrganizerPublicationLease({ jobId, now, ttlMs: 30_000 });
  assert.equal(lease.ok, true);
  await repository.updateOrganizerPublicationJob({ jobId, leaseToken: lease.token, expectedStep: "preparing_data",
    nextStep: "preparing_main", status: "failed", error: "temporary", retryable: true, now,
    // The executor never advances a step without its checkpoint, so a job this
    // far along carries one — and the workspace must not tell its owner that
    // nothing ran.
    metadata: { data_pr_number: 4, data_head_sha: "b".repeat(40), data_merge_sha: "c".repeat(40) } });
  await repository.releaseOrganizerPublicationLease(jobId, lease.token);
  const retryPath = `/api/organizer/publications/${jobId}/retry`;
  assert.equal((await handlers.adminRetryOrganizerPublication(request(retryPath, "POST", {}, editorCookie), jobId)).status, 403);
  const retried = await handlers.adminRetryOrganizerPublication(request(retryPath, "POST", {}, ownerCookie), jobId);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).step, "preparing_main");
  assert.deepEqual(dispatched, [jobId, jobId, jobId]);
  assert.equal((await repository.getOrganizerCandidate(candidateId)).status, "publishing");

  // Listing also stays read-only. The scheduled timeout makes the failed
  // activity findable before it is opened, with the same checkpoint for retry.
  now += QUEUED_PUBLICATION_TIMEOUT_MS;
  const beforeListTimeout = await handlers.listOrganizerCandidates(request("/api/organizer/events", "GET", undefined, ownerCookie));
  assert.equal((await beforeListTimeout.json()).events.find((event) => event.id === candidateId).status, "publishing");
  await repository.expireStalledOrganizerPublicationJobs({ now, timeoutMs: QUEUED_PUBLICATION_TIMEOUT_MS });
  const listed = await handlers.listOrganizerCandidates(request("/api/organizer/events", "GET", undefined, ownerCookie));
  assert.equal((await listed.json()).events.find((event) => event.id === candidateId).status, "failed");
  const detail = await handlers.getOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.deepEqual((await detail.json()).publication, {
    id: jobId, status: "failed", step: "preparing_main", candidateVersion: 5, retryable: true, started: true,
    failureCode: "queued_timeout", error: "Publication never started: the job stayed queued past the timeout.",
    updatedAt: now,
  });
  const resumed = await handlers.adminRetryOrganizerPublication(request(retryPath, "POST", {}, ownerCookie), jobId);
  assert.equal(resumed.status, 200);
  assert.deepEqual(dispatched, [jobId, jobId, jobId, jobId]);
  assert.equal((await repository.getOrganizerCandidate(candidateId)).status, "publishing");
});

test("reference catalog creation enforces actor, editable state and version without partial writes", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request("/api/admin/organizer/events", "POST",
    { tentativeName: "References", ownerEmail: "owner@example.test" }, adminCookie));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  const strangerCookie = await signIn("stranger@example.test", "organizer");
  const path = `/api/organizer/events/${candidateId}/references`;
  const body = { expectedVersion: 1, kind: "organizer", name: "新主辦", sourceUrl: "https://organizer.example/" };
  const send = (input, cookie = ownerCookie) => handlers.createOrganizerReferenceEntry(request(path, "POST", input, cookie), candidateId);
  const counts = async () => ({ records: (await repository.listOrganizerReferenceRecords()).length,
    audits: (await database.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'organizer_reference.created'").first()).n });
  const before = await counts();
  assert.equal((await handlers.createOrganizerReferenceEntry(request(path, "POST", body), candidateId)).status, 401);
  assert.equal((await send(body, strangerCookie)).status, 404);
  assert.equal((await send({ ...body, expectedVersion: 2 })).status, 409);
  for (const sourceUrl of ["", "http://organizer.example/", "not a URL"]) assert.equal((await send({ ...body, sourceUrl })).status, 400);
  assert.deepEqual(await counts(), before);
  const references = await createReferenceSelection(candidateId, ownerCookie);
  const catalogBody = { expectedVersion: 1, kind: "category-catalog", name: "分類", sourceUrl: "https://organizer.example/categories",
    organizerId: references.organizerAssignments[0].organizerId, categories: [{ label: "原創", description: "" }] };
  const beforeInvalid = await counts();
  for (const categories of [[], [{ label: "" }], [{ label: "同名" }, { label: "同名" }], [{ label: "全部類別" }]]) assert.equal((await send({ ...catalogBody, categories })).status, 400);
  assert.deepEqual(await counts(), beforeInvalid);
  assert.equal((await send({ ...catalogBody, organizerId: "unknown-organizer" })).status, 409);
  const afterValid = await counts();
  for (const status of ["submitted", "approved", "publishing", "published", "failed"]) {
    await database.prepare("UPDATE organizer_event_candidates SET status = ?1 WHERE id = ?2").bind(status, candidateId).run();
    assert.equal((await send(body)).status, 409);
    assert.deepEqual(await counts(), afterValid);
  }
  await database.prepare("UPDATE organizer_event_candidates SET status = 'changes_requested' WHERE id = ?1").bind(candidateId).run();
  assert.equal((await send(body, adminCookie)).status, 201);
  assert.equal((await repository.getOrganizerCandidate(candidateId)).current_version, 1, "catalog creation does not apply a selection");
  const audit = await database.prepare("SELECT actor_role FROM audit_log WHERE action = 'organizer_reference.created' AND subject_id = ?1")
    .bind(references.organizerAssignments[0].organizerId).first();
  assert.equal(audit.actor_role, "organizer_owner");
});

test("candidate reference selection rejects wrong catalog ownership and duplicate leads, and missing references block submit", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request("/api/admin/organizer/events", "POST",
    { tentativeName: "References", ownerEmail: "admin@example.test" }, adminCookie));
  const { candidateId } = await created.json();
  const references = await createReferenceSelection(candidateId, adminCookie);
  const another = await createReferenceSelection(candidateId, adminCookie);
  const original = await repository.getOrganizerCandidate(candidateId);
  const draft = JSON.parse(original.current_draft_json);
  const save = (selection, expectedVersion = 1) => handlers.updateOrganizerCandidate(request(`/api/organizer/events/${candidateId}`, "PATCH",
    { expectedVersion, draft: { ...draft, references: selection } }, adminCookie), candidateId);
  for (const selection of [
    { ...references, categoryCatalog: another.categoryCatalog },
    { ...references, organizerAssignments: [...references.organizerAssignments, ...another.organizerAssignments] },
    { ...references, organizerAssignments: [...references.organizerAssignments, ...references.organizerAssignments] },
    { ...references, organizerAssignments: [{ ...references.organizerAssignments[0], role: "partner" }] },
  ]) {
    assert.equal((await save(selection)).status, 422);
    assert.deepEqual(await repository.getOrganizerCandidate(candidateId), original);
  }
  const result = await handlers.validateOrganizerCandidate(request(`/api/organizer/events/${candidateId}/validate`, "POST", {}, adminCookie), candidateId);
  const issues = (await result.json()).issues;
  assert.ok(issues.some((issue) => issue.code === "missing_organizer"));
  assert.ok(issues.some((issue) => issue.code === "missing_category_catalog"));
  assert.ok(issues.some((issue) => issue.code === "invalid_source_url"));
  assert.equal((await save(references)).status, 200);
  assert.equal((await save(another)).status, 409);
  assert.deepEqual(JSON.parse((await repository.getOrganizerCandidate(candidateId)).current_draft_json).references, references);
  const records = await repository.listOrganizerReferenceRecords();
  const selected = records.find((record) => record.id === references.categoryCatalog.id);
  const invalid = JSON.parse(selected.publicReferenceJson);
  invalid.categories[0].label = "全部類別";
  selected.publicReferenceJson = JSON.stringify(invalid);
  const { resolveOrganizerReferences } = await environment.runner.import("/app/organizer-reference-catalog.ts");
  const resolved = await resolveOrganizerReferences({ ...draft, references }, records);
  assert.ok(resolved.issues.some((issue) => issue.code === "invalid_category_catalog" && issue.message.includes("全部類別")));
  assert.equal(resolved.snapshot, null, "an existing catalog with a reader-reserved label cannot reach the snapshot");
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
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"] }] },
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
      sourceRow: 2, dayId: "1", venueSpaceId: VENUE_SPACE_ID, areaId: "A",
      codes: ["A01", "A02"], circleName: "甲社", stableKey: null, identityGroup: null,
    }],
  };
  const imported = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", payload, ownerCookie,
  ), candidateId);
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).version, 3);
  assert.equal((await repository.getOrganizerImport(candidateId)).rows[0].circle_name, "甲社");

  assert.deepEqual((await repository.getOrganizerImport(candidateId)).rows[0].codes, ["A01", "A02"]);
  const detail = await handlers.getOrganizerCandidate(request(`/api/organizer/events/${candidateId}`, "GET", undefined, ownerCookie), candidateId);
  assert.deepEqual((await detail.json()).import.rows[0].codes, ["A01", "A02"]);
  for (const codes of [["A01", "a01"], [], [""], [123]]) {
    const bad = await handlers.putOrganizerImport(request(`/api/organizer/events/${candidateId}/imports`, "PUT",
      { ...payload, expectedVersion: 3, rows: [{ ...payload.rows[0], codes }] }, ownerCookie), candidateId);
    assert.equal(bad.status, 422);
    assert.equal((await repository.getOrganizerCandidate(candidateId)).current_version, 3);
  }
  const duplicated = await handlers.putOrganizerImport(request(`/api/organizer/events/${candidateId}/imports`, "PUT",
    { ...payload, expectedVersion: 3, rows: [payload.rows[0], { ...payload.rows[0], sourceRow: 3, codes: ["A02", "A03"] }] }, ownerCookie), candidateId);
  assert.equal(duplicated.status, 422);
  assert.equal((await repository.getOrganizerImport(candidateId)).rows.length, 1);

  const stale = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT", payload, ownerCookie,
  ), candidateId);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).conflict.currentVersion, 3);

  const changedAreaMode = await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", {
      expectedVersion: 3,
      draft: {
        ...draft,
        venue: { assignments: [{ ...draft.venue.assignments[0], areaMode: "none", areaIds: ["ALL"] }] },
      },
    }, ownerCookie,
  ), candidateId);
  assert.equal(changedAreaMode.status, 200);
  const revalidated = await handlers.validateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}/validate`, "POST", {}, ownerCookie,
  ), candidateId);
  assert.equal((await revalidated.json()).issues.some((issue) => issue.code === "stale_import_area_mode"), true);
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
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"] }] },
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
    sourceRow: index + 2, dayId: "1", venueSpaceId: VENUE_SPACE_ID, areaId: "A",
    codes: [`A${index}`], circleName, stableKey: null, identityGroup: null,
  });

  const tooManyRows = await handlers.putOrganizerImport(request(
    `/api/organizer/events/${candidateId}/imports`, "PUT",
    { expectedVersion: 2, source, rows: Array.from({ length: 20_001 }, (_, index) => row(index, "甲社")) },
    ownerCookie,
  ), candidateId);
  assert.equal(tooManyRows.status, 400);
  assert.match((await tooManyRows.json()).error, /20,000/u);

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
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
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
    { expectedVersion: 2, periodKey: "1", venueSpaceId: VENUE_SPACE_ID, layout }, ownerCookie,
  ), candidateId);
  assert.equal(mapCreated.status, 201);
  const { draftId } = await mapCreated.json();

  const listed = await handlers.listOrganizerMaps(request(
    `/api/organizer/events/${candidateId}/maps`, "GET", undefined, ownerCookie,
  ), candidateId);
  assert.deepEqual((await listed.json()).maps.map((item) => [item.periodKey, item.venueSpaceId, item.mapRevision]), [["1", VENUE_SPACE_ID, 1]]);

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

test("an owner address this environment cannot mail is refused before the activity exists", async () => {
  const scoped = createCirclePortalHandlers({
    ...handlerOptions,
    mailRecipientAllowed: (email) => email.endsWith(".test"),
  });
  const adminCookie = await signIn("admin@example.test");
  const sentBefore = sent.length;

  const refused = await scoped.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events",
    "POST",
    { tentativeName: "test", ownerEmail: "someone@example.com" },
    adminCookie,
  ));

  assert.equal(refused.status, 400);
  // The invitation is the only way an owner reaches this workspace, so an
  // address that cannot receive one must not leave an activity behind.
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM organizer_event_candidates").first()).total, 0);
  assert.equal(sent.length, sentBefore);
});

test("an activity survives an invitation the mailer could not send, and says the mail did not go out", async () => {
  const flaky = createCirclePortalHandlers({
    ...handlerOptions,
    sendMail: async () => { throw new Error("mailer is down"); },
  });
  const adminCookie = await signIn("admin@example.test");

  const created = await flaky.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events",
    "POST",
    { tentativeName: "test", ownerEmail: "owner@example.test" },
    adminCookie,
  ));

  // Reporting the whole call as failed made the admin retry and create a second
  // activity under the same name — nothing stops two candidates sharing one.
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.invitationSent, false);
  const candidate = await database.prepare("SELECT tentative_name FROM organizer_event_candidates WHERE id = ?1")
    .bind(body.candidateId).first();
  assert.equal(candidate.tentative_name, "test");

  // Creation is recorded because it happened, and the failure is recorded next
  // to it, so the activity can still be traced back to whoever made it.
  const actions = (await database.prepare("SELECT action FROM audit_log WHERE subject_id = ?1 ORDER BY at")
    .bind(body.candidateId).all()).results.map((row) => row.action);
  assert.deepEqual(actions, ["organizer_event.created", "organizer_event.invitation_failed"]);
});

/**
 * The plan a candidate map is traced from. It is stored beside the map instead
 * of being re-picked every session, so what this pins is the shape of that
 * store: one object per map, addressed by the draft's own ids, replaced rather
 * than accumulated, and readable only by the people who may edit the map.
 */
test("a candidate map's layout plan is stored once per map, replaced in place, and stays private", async () => {
  const adminCookie = await signIn("admin@example.test");
  const created = await handlers.adminCreateOrganizerCandidate(request(
    "/api/admin/organizer/events", "POST",
    { tentativeName: "PF45", ownerEmail: "owner@example.test" }, adminCookie,
  ));
  const { candidateId } = await created.json();
  const ownerCookie = await signIn("owner@example.test", "organizer");
  await handlers.updateOrganizerCandidate(request(
    `/api/organizer/events/${candidateId}`, "PATCH", { expectedVersion: 1, draft: {
      schema: "organizer-event-draft/1",
      event: { id: "pf45", name: "PF45", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
      venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
      officialSource: { label: "主辦", url: "https://organizer.example/pf45" },
    } }, ownerCookie,
  ), candidateId);
  const mapCreated = await handlers.createOrganizerMap(request(
    `/api/organizer/events/${candidateId}/maps`, "POST",
    { expectedVersion: 2, periodKey: "1", venueSpaceId: VENUE_SPACE_ID, layout: {
      version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
      floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
    } }, ownerCookie,
  ), candidateId);
  const { draftId } = await mapCreated.json();
  const path = `/api/organizer/events/${candidateId}/maps/${draftId}/background`;
  const plan = (name = "plan.png") => new File(
    [Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")],
    name, { type: "image/png" },
  );
  const upload = (file, cookie) => {
    const form = new FormData();
    form.append("file", file);
    return new Request(`${ORIGIN}${path}`, { method: "PUT", headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: form });
  };

  const anonymous = await handlers.getOrganizerMapBackground(request(path, "GET"), candidateId, draftId);
  assert.equal(anonymous.status, 401);
  const missing = await handlers.getOrganizerMapBackground(request(path, "GET", undefined, ownerCookie), candidateId, draftId);
  assert.equal(missing.status, 404, "a map traced from nothing has no plan to read");

  const stored = await handlers.putOrganizerMapBackground(upload(plan(), ownerCookie), candidateId, draftId);
  assert.equal(stored.status, 200);
  assert.deepEqual(await stored.json(), { ok: true, width: 1, height: 1 });
  assert.deepEqual([...objects.keys()], [`organizer-map-backgrounds/${candidateId}/${draftId}`]);

  const read = await handlers.getOrganizerMapBackground(request(path, "GET", undefined, ownerCookie), candidateId, draftId);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "image/png");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal(read.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await read.arrayBuffer()).length, 70);

  // Uploading again is how a plan is corrected, so the second one takes the
  // first one's place instead of leaving two plans behind one map.
  const replaced = objects.get(`organizer-map-backgrounds/${candidateId}/${draftId}`).bytes;
  const other = new File([Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64")], "plan.webp", { type: "image/webp" });
  const second = await handlers.putOrganizerMapBackground(upload(other, ownerCookie), candidateId, draftId);
  assert.equal(second.status, 200);
  assert.equal(objects.size, 1);
  assert.notDeepEqual(objects.get(`organizer-map-backgrounds/${candidateId}/${draftId}`).bytes, replaced);
  const reread = await handlers.getOrganizerMapBackground(request(path, "GET", undefined, ownerCookie), candidateId, draftId);
  assert.equal(reread.headers.get("content-type"), "image/webp");

  const stranger = await signIn("stranger@example.test", "organizer");
  assert.equal((await handlers.getOrganizerMapBackground(request(path, "GET", undefined, stranger), candidateId, draftId)).status, 404);
  assert.equal((await handlers.putOrganizerMapBackground(upload(plan(), stranger), candidateId, draftId)).status, 404);
  assert.equal((await handlers.putOrganizerMapBackground(
    upload(plan(), ownerCookie), candidateId, "11111111-1111-4111-8111-111111111111",
  )).status, 404);

  const document = new File([Buffer.from("%PDF-1.7\n")], "plan.pdf", { type: "application/pdf" });
  const rejected = await handlers.putOrganizerMapBackground(upload(document, ownerCookie), candidateId, draftId);
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /JPEG、PNG 或 WebP/);

  const audit = await database.prepare(
    "SELECT action FROM audit_log WHERE action = 'organizer_event.map_background_updated' AND subject_id = ?1",
  ).bind(candidateId).all();
  assert.equal(audit.results.length, 2);

  // Without the private bucket the plan cannot be stored at all, and saying so
  // is the only honest answer: a 404 would read as "this map has no plan".
  const unbound = createCirclePortalHandlers({ ...handlerOptions, mapContributionStore: undefined });
  assert.equal((await unbound.putOrganizerMapBackground(upload(plan(), ownerCookie), candidateId, draftId)).status, 503);
  assert.equal((await unbound.getOrganizerMapBackground(request(path, "GET", undefined, ownerCookie), candidateId, draftId)).status, 503);
});
