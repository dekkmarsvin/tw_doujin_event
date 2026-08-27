import assert from "node:assert/strict";
import { File } from "node:buffer";
import { deflateSync } from "node:zlib";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await environment.runner.import("/app/circle-portal-handlers.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "map-contribution-handler-test" },
}));
const database = await miniflare.getD1Database("DB");
after(async () => { await miniflare.dispose(); await vite.close(); });

const ORIGIN = "https://preview.example";
const NOW = 1_786_500_000_000;
const DAY = 24 * 60 * 60 * 1000;
/** Reset per test. Advance it to age a session or a draft past a deadline. */
let clock = NOW;
let repository;
let handlers;
let sent;
let objects;
let scopeConfig;

/** Carries one booth and one landmark so a targeted change request has
 * something real to point at; a request naming an absent element is refused. */
function validContent() {
  return {
    schema: "map-contribution-draft/1",
    layout: {
      version: 2, template: "SAMPLE", width: 100, height: 100,
      floor: { x: 0, y: 0, width: 100, height: 100 },
      rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A07", rect: { x: 10, y: 10, width: 20, height: 10 } }] }],
      pillars: [], accessPoints: [],
      landmarks: [{ id: "stage-1", kind: "stage", label: "舞台", rect: { x: 50, y: 50, width: 20, height: 10 } }],
    },
  };
}

beforeEach(async () => {
  clock = NOW;
  sent = [];
  objects = new Map();
  scopeConfig = {
    eventId: "ff47", periodKey: "1", periodAliases: ["1", "day-1"],
    venueSpaceId: "zhengyan-exhibition-area", mapTemplate: "SAMPLE",
    // A07 is the booth validContent() draws, so a targeted change request has a
    // real element to name without the draft failing official coverage.
    allowedBoothCodes: ["A07"], requiredBoothCodes: [], targetPath: "map.json",
  };
  repository = createIdentityRepository(database, { bootstrapAdmins: ["admin@example.test"] });
  await repository.ensureTables();
  await repository.clearPreviewData();
  await repository.addAdmin("admin@example.test", "bootstrap", NOW);
  handlers = createCirclePortalHandlers({
    repository,
    sendMail: async (message) => sent.push(message),
    lookupCircle: async () => null,
    searchCircles: async () => [],
    fetchEvidence: async () => null,
    verifyHuman: async () => true,
    turnstileSitekey: () => "test-key",
    projectCircle: async () => null,
    resolveMapContributionScope: async ({ periodKey, venueSpaceId }) =>
      scopeConfig.periodAliases.includes(periodKey) && venueSpaceId === scopeConfig.venueSpaceId ? scopeConfig : null,
    readPublishedEventMap: async () => null,
    mapContributionStore: {
      put: async (key, value, contentType) => objects.set(key, { bytes: new Uint8Array(value), contentType }),
      get: async (key) => {
        const value = objects.get(key);
        return value ? { body: new Response(value.bytes).body, contentType: value.contentType } : null;
      },
      delete: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => objects.delete(key)),
    },
    config: {
      eventId: "ff47", origin: ORIGIN, sessionSecret: "session-secret", hashPepper: "pepper",
      adminEmails: ["admin@example.test"], dataUpdatedAt: "2026-08-25T00:00:00Z",
      eventEndsAt: "2026-09-01T00:00:00Z", now: () => clock,
    },
  });
});

function request(path, method, body, cookie) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signIn(email) {
  await handlers.requestLink(request("/api/auth/request-link", "POST", { email, turnstileToken: "solved" }));
  const token = decodeURIComponent(sent.at(-1).text.match(/login=([^\s]+)/)[1]);
  const response = await handlers.verify(request("/api/auth/verify", "POST", { token }));
  return response.headers.get("set-cookie").split(";")[0];
}

async function grant(email, adminCookie, action = "grant") {
  return handlers.adminManageMapContributor(request("/api/admin/map-contributors", "POST", { email, action }, adminCookie));
}

async function newDraft(cookie) {
  const response = await handlers.createMapDraft(request("/api/map-contributions/drafts", "POST", {
    periodKey: "day-1", venueSpaceId: "zhengyan-exhibition-area", content: validContent(),
  }, cookie));
  return { response, body: await response.json() };
}

function png() {
  const crc32 = (value) => {
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type);
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    typeBytes.copy(result, 4);
    Buffer.from(data).copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(5))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function uploadRequest(draftId, cookie, revision = 1) {
  const form = new FormData();
  form.set("draftId", draftId);
  form.set("revision", String(revision));
  form.set("sourceUrl", "https://organizer.example/map");
  form.set("documentDate", "2026-08-25");
  form.set("file", new File([png()], "map.png", { type: "image/png" }));
  return new Request(`${ORIGIN}/api/map-contributions/files`, { method: "POST", headers: { origin: ORIGIN, cookie }, body: form });
}

async function addEvidenceRecord(draftId, eventId = "ff47") {
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  return repository.addMapDraftFile({
    id: `file-${draftId}`, draftId, eventId, revision: 1,
    objectKey: `map-contributions/${eventId}/${draftId}/source.png`,
    sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25", pageNumber: null,
    sha256: "a".repeat(64), mime: "image/png", sizeBytes: 10,
    width: 1, height: 1, pageCount: null, uploadedBy: mapperId, now: NOW,
  });
}

test("admin-only grants are audited and revocation immediately blocks writes", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  assert.equal((await grant("mapper@example.test", mapperCookie)).status, 403);
  assert.equal((await grant("mapper@example.test", adminCookie)).status, 200);

  const { response, body } = await newDraft(mapperCookie);
  assert.equal(response.status, 201);
  assert.equal(body.revision, 1);
  assert.equal((await repository.getMapDraft(body.draftId)).period_key, "1", "day-1 is stored as the canonical event day id");
  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);
  const update = await handlers.updateMapDraft(request(`/api/map-contributions/drafts/${body.draftId}`, "PUT", {
    expectedRevision: 1, content: validContent(),
  }, mapperCookie), body.draftId);
  assert.equal(update.status, 409);
  const audit = await database.prepare("SELECT action, actor_role FROM audit_log WHERE action LIKE 'map_contributor.%' ORDER BY at").all();
  assert.deepEqual(audit.results, [
    { action: "map_contributor.grant", actor_role: "admin" },
    { action: "map_contributor.revoke", actor_role: "admin" },
  ]);
});

test("period aliases normalize before persistence and cannot create parallel active scopes", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  assert.equal(await repository.createMapDraft({
    id: "legacy-alias", eventId: "ff47", periodKey: "day-1", venueSpaceId: scopeConfig.venueSpaceId,
    ownerAccountId: mapperId, contentJson: JSON.stringify(validContent()), now: NOW,
  }), true);
  await addEvidenceRecord("legacy-alias");
  await repository.submitMapDraft({
    draftId: "legacy-alias", eventId: "ff47", ownerAccountId: mapperId, expectedRevision: 1, now: NOW + 1,
  });
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "legacy-alias", expectedRevision: 1, actorAccountId: "admin-1", now: NOW + 2,
  }), { ok: true, replacedDraftId: null });

  const { body: next } = await newDraft(mapperCookie);
  assert.equal((await repository.getMapDraft("legacy-alias")).period_key, "1");
  assert.equal((await repository.getMapDraft(next.draftId)).period_key, "1");
  await handlers.uploadMapDraftFile(uploadRequest(next.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${next.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), next.draftId)).status, 200);
  const approval = await handlers.adminReviewMapDraft(request(`/admin/drafts/${next.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", confirmOfficialSource: true,
  }, adminCookie), next.draftId);
  assert.equal(approval.status, 409);
  assert.equal((await approval.json()).activeDraftId, "legacy-alias");
});

test("denied create and submit requests do not normalize legacy scope rows", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const strangerCookie = await signIn("stranger@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  assert.equal(await repository.createMapDraft({
    id: "legacy-denied", eventId: "ff47", periodKey: "day-1", venueSpaceId: scopeConfig.venueSpaceId,
    ownerAccountId: mapperId, contentJson: JSON.stringify(validContent()), now: NOW,
  }), true);
  await addEvidenceRecord("legacy-denied");

  assert.equal((await newDraft(strangerCookie)).response.status, 403);
  assert.equal((await repository.getMapDraft("legacy-denied")).period_key, "day-1");
  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);
  assert.equal((await handlers.submitMapDraft(request("/drafts/legacy-denied/submit", "POST", {
    expectedRevision: 1,
  }, mapperCookie), "legacy-denied")).status, 409);
  assert.equal((await repository.getMapDraft("legacy-denied")).period_key, "day-1");
});

test("owner and admin map routes are bounded to the configured event", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  const oldNow = NOW - 40 * 24 * 60 * 60 * 1000;
  assert.equal(await repository.createMapDraft({
    id: "old-event-draft", eventId: "old-event", periodKey: "1", venueSpaceId: scopeConfig.venueSpaceId,
    ownerAccountId: mapperId, contentJson: JSON.stringify(validContent()), now: oldNow,
  }), true);
  await addEvidenceRecord("old-event-draft", "old-event");
  assert.equal(await repository.submitMapDraft({
    draftId: "old-event-draft", eventId: "old-event", ownerAccountId: mapperId,
    expectedRevision: 1, now: oldNow + 1,
  }), true);

  const mine = await handlers.listMyMapDrafts(request("/drafts", "GET", undefined, mapperCookie));
  assert.deepEqual((await mine.json()).drafts, []);
  const admin = await handlers.adminListMapDrafts(request("/admin/drafts", "GET", undefined, adminCookie));
  assert.deepEqual((await admin.json()).drafts, []);
  assert.equal((await handlers.getMapDraft(request("/drafts/old-event-draft", "GET", undefined, mapperCookie), "old-event-draft")).status, 404);
  assert.equal((await handlers.getMapDraft(request("/admin/drafts/old-event-draft", "GET", undefined, adminCookie), "old-event-draft", true)).status, 404);
  assert.equal((await handlers.updateMapDraft(request("/drafts/old-event-draft", "PUT", {
    expectedRevision: 1, content: validContent(),
  }, mapperCookie), "old-event-draft")).status, 404);
  assert.equal((await handlers.submitMapDraft(request("/drafts/old-event-draft/submit", "POST", {
    expectedRevision: 1,
  }, mapperCookie), "old-event-draft")).status, 404);
  assert.equal((await handlers.uploadMapDraftFile(uploadRequest("old-event-draft", mapperCookie))).status, 404);
  assert.equal(objects.size, 0, "an old-event upload is rejected before R2 write");
  assert.equal((await handlers.readMapDraftFile(request("/files/file-old-event-draft", "GET", undefined, mapperCookie), "file-old-event-draft")).status, 404);
  assert.equal((await handlers.adminReviewMapDraft(request("/admin/drafts/old-event-draft/review", "POST", {
    expectedRevision: 1, decision: "approve", confirmOfficialSource: true,
  }, adminCookie), "old-event-draft")).status, 404);
  assert.equal((await handlers.adminExportMapDraft(request("/admin/drafts/old-event-draft/export", "POST", {
    expectedRevision: 1,
  }, adminCookie), "old-event-draft")).status, 404);
  const stale = await handlers.adminListStaleMapDrafts(request("/admin/drafts/stale?days=30", "GET", undefined, adminCookie));
  assert.deepEqual((await stale.json()).drafts, []);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_draft_reviews WHERE draft_id = ?1").bind("old-event-draft").first()).total, 1,
    "only the owner submission transition exists");
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_draft_exports WHERE draft_id = ?1").bind("old-event-draft").first()).total, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE subject_id = ?1").bind("old-event-draft").first()).total, 0);
});

test("a legacy immutable export with an alias target path fails closed", async () => {
  await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  const adminId = await repository.upsertAccount("admin@example.test", NOW);
  scopeConfig = { ...scopeConfig, targetPath: "maps/1/zhengyan-exhibition-area.json" };
  assert.equal(await repository.createMapDraft({
    id: "legacy-export", eventId: "ff47", periodKey: "day-1", venueSpaceId: scopeConfig.venueSpaceId,
    ownerAccountId: mapperId, contentJson: JSON.stringify(validContent()), now: NOW,
  }), true);
  await addEvidenceRecord("legacy-export");
  assert.equal(await repository.submitMapDraft({
    draftId: "legacy-export", eventId: "ff47", ownerAccountId: mapperId, expectedRevision: 1, now: NOW + 1,
  }), true);
  assert.deepEqual(await repository.approveMapDraft({
    draftId: "legacy-export", expectedRevision: 1, actorAccountId: adminId, now: NOW + 2,
  }), { ok: true, replacedDraftId: null });
  const legacyTargetPath = "maps/day-1/zhengyan-exhibition-area.json";
  assert.ok(await repository.exportMapDraft({
    draftId: "legacy-export", expectedRevision: 1, targetPath: legacyTargetPath,
    candidateJson: "{}", diffJson: "{}", candidateSha256: "b".repeat(64),
    actorAccountId: adminId, now: NOW + 3,
  }));

  const response = await handlers.adminExportMapDraft(request("/admin/drafts/legacy-export/export", "POST", {
    expectedRevision: 1,
  }, adminCookie), "legacy-export");
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /immutable export/);
  assert.equal((await repository.getMapDraft("legacy-export")).period_key, "1");
  assert.equal((await repository.getMapDraftExport("legacy-export", 1)).target_path, legacyTargetPath,
    "the immutable legacy export is not rewritten");

  scopeConfig = { ...scopeConfig, periodAliases: [] };
  const archived = await handlers.adminExportMapDraft(request("/admin/drafts/legacy-export/export", "POST", {
    expectedRevision: 1,
  }, adminCookie), "legacy-export");
  assert.equal(archived.status, 200, "an immutable export remains retrievable after its live scope is removed");
  assert.equal((await archived.json()).targetPath, legacyTargetPath);
});

test("private evidence is owner/admin-only, images preview safely and raw downloads attach", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const strangerCookie = await signIn("stranger@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const uploaded = await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal(uploaded.status, 201);
  const { fileId } = await uploaded.json();
  assert.equal(objects.size, 1);

  assert.equal((await handlers.readMapDraftFile(request(`/files/${fileId}`, "GET", undefined, strangerCookie), fileId)).status, 403);
  const preview = await handlers.readMapDraftFile(request(`/files/${fileId}/preview`, "GET", undefined, mapperCookie), fileId, true);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-disposition"), "inline; filename=\"map-source.png\"");
  assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
  assert.match(preview.headers.get("content-security-policy"), /sandbox/);

  const raw = await handlers.readMapDraftFile(request(`/files/${fileId}`, "GET", undefined, adminCookie), fileId, false);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("content-disposition"), "attachment; filename=\"map-source.png\"");
  assert.equal(raw.headers.get("cache-control"), "private, no-store");
});

test("failed metadata binding rolls back the private object", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await grant("mapper@example.test", adminCookie, "suspend");
  const response = await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal(response.status, 409);
  assert.equal(objects.size, 0);
});

test("a D1 exception after upload also rolls back the private object", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  repository.addMapDraftFile = async () => { throw new Error("D1 unavailable"); };
  await assert.rejects(() => handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie)), /D1 unavailable/);
  assert.equal(objects.size, 0);
});

test("account deletion removes unsubmitted private bytes before deleting D1 metadata", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  assert.equal((await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie))).status, 201);
  assert.equal(objects.size, 1);
  const deleted = await handlers.deleteMyAccount(request("/api/account", "DELETE", { confirm: "mapper@example.test" }, mapperCookie));
  assert.equal(deleted.status, 200);
  assert.equal(objects.size, 0);
  assert.equal(await repository.getMapDraft(draft.draftId), null);
});

test("starting account deletion rejects a new upload request before storing bytes", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const session = await repository.getSession(mapperCookie.split("=")[1].split(".")[0], NOW);
  assert.equal(await repository.beginAccountDeletion({ accountId: session.accountId, email: "mapper@example.test", now: NOW }), true);
  const response = await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal(response.status, 401);
  assert.equal(objects.size, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM map_draft_files WHERE draft_id = ?1").bind(draft.draftId).first()).total, 0);
});

test("submission validates official coverage and requires evidence from the current revision", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);

  // A07 stays allowed - it is the booth the draft draws - so the missing one is A01.
  scopeConfig = { ...scopeConfig, allowedBoothCodes: ["A01", "A07"], requiredBoothCodes: ["A01"] };
  let response = await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).problems[0].code, "missing_booth");

  scopeConfig = { ...scopeConfig, requiredBoothCodes: [] };
  response = await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).problems[0].code, "missing_evidence");

  assert.equal((await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie))).status, 201);
  response = await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId);
  assert.equal(response.status, 200);
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "submitted");
});

test("only an admin can approve and export an immutable review candidate", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId)).status, 200);

  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve",
  }, mapperCookie), draft.draftId)).status, 403);
  assert.equal((await handlers.adminExportMapDraft(request(`/admin/drafts/${draft.draftId}/export`, "POST", {
    expectedRevision: 1,
  }, adminCookie), draft.draftId)).status, 409);

  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", note: "geometry checked",
  }, adminCookie), draft.draftId)).status, 400, "official source confirmation is an explicit review decision");

  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", note: "geometry checked", confirmOfficialSource: true,
  }, adminCookie), draft.draftId)).status, 200);
  const exported = await handlers.adminExportMapDraft(request(`/admin/drafts/${draft.draftId}/export`, "POST", {
    expectedRevision: 1,
  }, adminCookie), draft.draftId);
  assert.equal(exported.status, 201);
  const body = await exported.json();
  assert.equal(body.targetPath, "map.json");
  assert.equal(body.candidate.sourceName, `map-contribution:${draft.draftId}:r1`);
  assert.deepEqual(body.candidate.layout, validContent().layout);
  assert.match(body.candidateSha256, /^[a-f0-9]{64}$/);
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "exported");
  assert.equal((await repository.listMapDraftFiles(draft.draftId, 1))[0].review_result, "approved_official_source");

  const retry = await handlers.adminExportMapDraft(request(`/admin/drafts/${draft.draftId}/export`, "POST", {
    expectedRevision: 1,
  }, adminCookie), draft.draftId);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).candidateSha256, body.candidateSha256);
  const reviews = await repository.listMapDraftReviews(draft.draftId);
  assert.deepEqual(reviews.map(({ from_status, to_status }) => [from_status, to_status]), [
    ["draft", "submitted"], ["submitted", "approved"], ["approved", "exported"],
  ]);
});

test("admin approval fails closed for a legacy submitted revision with no evidence", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const mapperId = await repository.upsertAccount("mapper@example.test", NOW);
  assert.equal(await repository.submitMapDraft({
    draftId: draft.draftId, eventId: "ff47", ownerAccountId: mapperId, expectedRevision: 1, now: NOW + 1,
  }), true, "simulate a submitted row created before evidence became mandatory");

  const response = await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", confirmOfficialSource: true,
  }, adminCookie), draft.draftId);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).problems[0].code, "missing_evidence");
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "submitted");
});

test("approving a parallel draft requires an explicit replacement id", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: first } = await newDraft(mapperCookie);
  const { body: second } = await newDraft(mapperCookie);
  for (const draft of [first, second]) {
    await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
    assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
      expectedRevision: 1,
    }, mapperCookie), draft.draftId)).status, 200);
  }
  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${first.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", confirmOfficialSource: true,
  }, adminCookie), first.draftId)).status, 200);
  const missingReplacement = await handlers.adminReviewMapDraft(request(`/admin/drafts/${second.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", confirmOfficialSource: true,
  }, adminCookie), second.draftId);
  assert.equal(missingReplacement.status, 409);
  assert.equal((await missingReplacement.json()).activeDraftId, first.draftId);
  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${second.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "approve", replacementDraftId: first.draftId, confirmOfficialSource: true,
  }, adminCookie), second.draftId)).status, 200);
  assert.equal((await repository.getMapDraft(first.draftId)).status, "withdrawn");
  assert.equal((await repository.getMapDraft(second.draftId)).status, "approved");
});

test("a version conflict names the revision, the time and the role that moved the draft", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const save = (expectedRevision) => handlers.updateMapDraft(request(`/drafts/${draft.draftId}`, "PUT", {
    expectedRevision, content: validContent(),
  }, mapperCookie), draft.draftId);

  // The stale session still holds revision 1 while the other one saves twice.
  assert.equal((await save(1)).status, 200, "the first writer wins");
  assert.equal((await save(2)).status, 200);
  const stale = await save(1);
  assert.equal(stale.status, 409, "the second writer is still refused; the lock is unchanged");
  assert.deepEqual(await stale.json(), {
    error: "草稿已更新至版本 3。",
    conflict: { cause: "version", revision: 3, updatedAt: NOW, updatedByRole: "map_contributor" },
  });
  assert.equal((await repository.getMapDraft(draft.draftId)).current_revision, 3, "no auto-merge");

  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie, 3));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 3,
  }, mapperCookie), draft.draftId)).status, 200);
  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 3, decision: "changes_requested", note: "row A is off by one slot",
  }, adminCookie), draft.draftId)).status, 200);
  assert.equal((await save(3)).status, 200);

  const afterReview = await save(1);
  assert.equal(afterReview.status, 409);
  assert.deepEqual((await afterReview.json()).conflict, {
    cause: "version", revision: 4, updatedAt: NOW, updatedByRole: "map_contributor",
  }, "a revision write is attributed to the contributor even right after an admin review");

  const adminMoved = await handlers.adminExportMapDraft(request(`/admin/drafts/${draft.draftId}/export`, "POST", {
    expectedRevision: 3,
  }, adminCookie), draft.draftId);
  assert.equal(adminMoved.status, 409);
  assert.deepEqual((await adminMoved.json()).conflict, {
    cause: "version", revision: 4, updatedAt: NOW, updatedByRole: "map_contributor",
  });

  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie, 4));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 4,
  }, mapperCookie), draft.draftId)).status, 200);
  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 4, decision: "reject", note: "superseded",
  }, adminCookie), draft.draftId)).status, 200);
  const afterAdminMove = await save(1);
  assert.deepEqual((await afterAdminMove.json()).conflict, {
    cause: "version", revision: 4, updatedAt: NOW, updatedByRole: "admin",
  }, "a status change is attributed to the reviewing role, never to an account");
});

test("revoked permission and an unwritable status stay distinguishable from a version conflict", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId)).status, 200);

  const submitted = await handlers.updateMapDraft(request(`/drafts/${draft.draftId}`, "PUT", {
    expectedRevision: 1, content: validContent(),
  }, mapperCookie), draft.draftId);
  assert.equal(submitted.status, 409);
  assert.deepEqual(await submitted.json(), {
    error: "草稿狀態已變更。",
    conflict: { cause: "status", revision: 1, updatedAt: NOW, updatedByRole: "map_contributor" },
  });

  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);
  const revoked = await handlers.updateMapDraft(request(`/drafts/${draft.draftId}`, "PUT", {
    expectedRevision: 1, content: validContent(),
  }, mapperCookie), draft.draftId);
  assert.equal(revoked.status, 409);
  assert.deepEqual(await revoked.json(), {
    error: "沒有有效的地圖貢獻者權限。",
    conflict: { cause: "permission", revision: 1, updatedAt: NOW, updatedByRole: "map_contributor" },
  }, "revocation outranks the status message and never shares the version wording");

  const submitRevoked = await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId);
  assert.equal(submitRevoked.status, 409);
  assert.equal((await submitRevoked.json()).conflict.cause, "permission");
});

test("a review thread accumulates, points at single booths, and never names an account", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const post = (cookie, body) => handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", body, cookie), draft.draftId,
  );

  assert.equal((await post(mapperCookie, { body: "A 排的位置我不確定。" })).status, 201);
  const targeted = await post(adminCookie, { body: "這一格往右偏了一格。", targetKind: "slot", targetRef: "A07" });
  assert.equal(targeted.status, 201);
  assert.equal((await post(mapperCookie, { body: "已修正 A07。", targetKind: "slot", targetRef: "A07" })).status, 201);

  const detail = await (await handlers.getMapDraft(request(`/drafts/${draft.draftId}`, "GET", undefined, mapperCookie), draft.draftId)).json();
  assert.deepEqual(detail.comments.map(({ author_role, target_kind, target_ref, revision, body }) => ({ author_role, target_kind, target_ref, revision, body })), [
    { author_role: "map_contributor", target_kind: null, target_ref: null, revision: 1, body: "A 排的位置我不確定。" },
    { author_role: "admin", target_kind: "slot", target_ref: "A07", revision: 1, body: "這一格往右偏了一格。" },
    { author_role: "map_contributor", target_kind: "slot", target_ref: "A07", revision: 1, body: "已修正 A07。" },
  ], "one draft accumulates many comments, in the order they were written");
  assert.equal(detail.comments.every((item) => !Object.hasOwn(item, "author_account_id")), true,
    "participants on a draft are named by role only");
  assert.equal(detail.comments.every((item) => !JSON.stringify(item).includes("data:")), true, "no raw image bytes ride along");

  assert.equal((await post(mapperCookie, { body: "   " })).status, 400);
  assert.equal((await post(mapperCookie, { body: "沒有指定代碼。", targetKind: "slot" })).status, 400);
  assert.equal((await post(mapperCookie, { body: "類型不存在。", targetKind: "pillar", targetRef: "p1" })).status, 400);
  // A reference the draft does not contain would render as a link that does
  // nothing when pressed, so it is refused rather than stored.
  assert.equal((await post(adminCookie, { body: "這格不存在。", targetKind: "slot", targetRef: "Z99" })).status, 400);
  assert.equal((await post(adminCookie, { body: "這個區域不存在。", targetKind: "landmark", targetRef: "stage-9" })).status, 400);
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 3, "none of the refusals wrote a row");
});

test("only the draft owner or an admin can add to its thread", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);

  const strangerCookie = await signIn("stranger@example.test");
  assert.equal((await handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", { body: "我也想留言。" }, strangerCookie), draft.draftId,
  )).status, 404, "someone else's draft is not found rather than described");

  assert.equal((await handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", { body: "沒登入。" }, undefined), draft.draftId,
  )).status, 401);

  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);
  assert.equal((await handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", { body: "權限沒了。" }, mapperCookie), draft.draftId,
  )).status, 403, "commenting needs the same live grant that writing does");
});

test("speaking as an administrator needs a fresh session, like every other admin write", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const comment = (cookie) => handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", { body: "請調整 A07。" }, cookie), draft.draftId,
  );
  assert.equal((await comment(adminCookie)).status, 201);

  clock = NOW + 25 * 60 * 60 * 1000;
  assert.equal((await comment(adminCookie)).status, 401,
    "a still-valid but stale admin session cannot put words in front of a contributor as a reviewer");
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 1);

  // The contributor's own path is not an administrative write, so it is not
  // held to the reauthentication boundary.
  assert.equal((await comment(mapperCookie)).status, 201);
  assert.deepEqual((await repository.listMapDraftComments(draft.draftId)).map(({ author_role }) => author_role),
    ["admin", "map_contributor"]);
});

test("a comment counts as activity, so a draft under discussion is not treated as abandoned", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  assert.equal((await repository.getMapDraft(draft.draftId)).last_activity_at, NOW);

  // Months on, nobody has saved a revision but the thread is still moving.
  // The login session is long gone by then, so the contributor signs in again.
  clock = NOW + 150 * DAY;
  const returning = await signIn("mapper@example.test");
  assert.equal((await handlers.postMapDraftComment(
    request(`/drafts/${draft.draftId}/comments`, "POST", { body: "還在討論這一排。" }, returning), draft.draftId,
  )).status, 201);
  assert.equal((await repository.getMapDraft(draft.draftId)).last_activity_at, clock,
    "without this the inactivity window would run out while the draft was being talked about");
});

test("requesting changes records the elements it is about, and only when it takes effect", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId)).status, 200);

  const review = (body) => handlers.adminReviewMapDraft(
    request(`/admin/drafts/${draft.draftId}/review`, "POST", body, adminCookie), draft.draftId,
  );

  assert.equal((await review({
    expectedRevision: 1, decision: "changes_requested", note: "兩處要改",
    targets: [{ kind: "slot", body: "缺代碼" }],
  })).status, 400, "a request that names no element is refused rather than silently dropped");
  assert.equal((await review({
    expectedRevision: 1, decision: "changes_requested", note: "兩處要改",
    targets: [{ targetKind: "slot", targetRef: "A07", body: "  " }],
  })).status, 400);

  // A refused transition must leave no requests behind.
  assert.equal((await review({
    expectedRevision: 99, decision: "changes_requested", note: "版本錯了",
    targets: [{ targetKind: "slot", targetRef: "A07", body: "不該被寫入" }],
  })).status, 409);
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 0);

  assert.equal((await review({
    expectedRevision: 1, decision: "changes_requested", note: "兩處要改",
    targets: [
      { targetKind: "slot", targetRef: "A07", body: "往右偏了一格。" },
      { targetKind: "landmark", targetRef: "stage-1", body: "舞台範圍比實際大。" },
    ],
  })).status, 200);
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "changes_requested");
  assert.deepEqual((await repository.listMapDraftComments(draft.draftId)).map(({ author_role, target_kind, target_ref }) => ({ author_role, target_kind, target_ref })), [
    { author_role: "admin", target_kind: "slot", target_ref: "A07" },
    { author_role: "admin", target_kind: "landmark", target_ref: "stage-1" },
  ]);

  const reviews = await repository.listMapDraftReviews(draft.draftId);
  assert.equal(reviews.length, 2, "the state-machine trail stays one row per transition, not one per request");
  assert.deepEqual((await repository.listMapDraftComments(draft.draftId)).map(({ revision }) => revision), [1, 1],
    "requests name the revision the reviewer looked at, not whatever the draft reached afterwards");
});

test("the review panel's own target shape is the one the endpoint parses", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId)).status, 200);

  // Built exactly as MapDraftCommentTarget declares it, so a rename on either
  // side fails here rather than turning every queued request into a 400.
  const queued = [{ targetKind: "slot", targetRef: "A07", body: "往右偏了一格。" }];
  const response = await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "changes_requested", note: "一處要改", targets: queued,
  }, adminCookie), draft.draftId);
  assert.equal(response.status, 200);
  assert.deepEqual((await repository.listMapDraftComments(draft.draftId)).map(({ target_kind, target_ref }) => ({ target_kind, target_ref })),
    [{ target_kind: "slot", target_ref: "A07" }]);
});

test("only a change request can carry per-element requests", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  await handlers.uploadMapDraftFile(uploadRequest(draft.draftId, mapperCookie));
  assert.equal((await handlers.submitMapDraft(request(`/drafts/${draft.draftId}/submit`, "POST", {
    expectedRevision: 1,
  }, mapperCookie), draft.draftId)).status, 200);

  assert.equal((await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "changes_requested", note: "要改",
    targets: [{ targetKind: "slot", targetRef: "Z99", body: "這格不存在。" }],
  }, adminCookie), draft.draftId)).status, 400, "a review cannot point at a booth the draft does not have");

  const targets = [{ targetKind: "slot", targetRef: "A07", body: "往右偏了一格。" }];
  for (const decision of ["reject", "approve"]) {
    const response = await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
      expectedRevision: 1, decision, note: "說明", confirmOfficialSource: true, targets,
    }, adminCookie), draft.draftId);
    assert.equal(response.status, 400, `${decision} ends the draft, so a request pointing into it could never be acted on`);
  }
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "submitted");
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 0);
});

test("a refused transition writes none of its change requests", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);

  // Never submitted, so the transition cannot apply. The requests ride the same
  // batch, so they cannot land on their own and leave a partial set behind.
  const response = await handlers.adminReviewMapDraft(request(`/admin/drafts/${draft.draftId}/review`, "POST", {
    expectedRevision: 1, decision: "changes_requested", note: "要改",
    targets: [{ targetKind: "slot", targetRef: "A07", body: "往右偏了一格。" }],
  }, adminCookie), draft.draftId);
  assert.equal(response.status, 409);
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 0);
  assert.equal((await repository.getMapDraft(draft.draftId)).status, "draft");
});

test("a grant revoked mid-request cannot slip a comment past the check", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const accountId = (await repository.getMapDraft(draft.draftId)).owner_account_id;

  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);
  // The repository call the handler would make once its own check had passed.
  const id = await repository.addMapDraftComment({
    draftId: draft.draftId, eventId: "ff47", authorAccountId: accountId, authorRole: "map_contributor",
    targetKind: null, targetRef: null, body: "權限已被撤銷。", now: NOW,
  });
  assert.equal(id, null, "the write rechecks the live grant, so a revocation cannot be raced");
  assert.equal((await repository.listMapDraftComments(draft.draftId)).length, 0);
  assert.equal((await repository.getMapDraft(draft.draftId)).last_activity_at, NOW,
    "a refused comment must not defer retention on a draft nobody was allowed to write to");
});

test("a revoked grant outranks a stale revision so the panel never offers a reload that cannot help", async () => {
  const mapperCookie = await signIn("mapper@example.test");
  const adminCookie = await signIn("admin@example.test");
  await grant("mapper@example.test", adminCookie);
  const { body: draft } = await newDraft(mapperCookie);
  const save = (expectedRevision) => handlers.updateMapDraft(request(`/drafts/${draft.draftId}`, "PUT", {
    expectedRevision, content: validContent(),
  }, mapperCookie), draft.draftId);

  // The tab is left holding revision 1 while another session moves the draft on.
  assert.equal((await save(1)).status, 200);
  assert.equal((await grant("mapper@example.test", adminCookie, "revoke")).status, 200);

  const stale = await save(1);
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    error: "沒有有效的地圖貢獻者權限。",
    conflict: { cause: "permission", revision: 2, updatedAt: NOW, updatedByRole: "map_contributor" },
  }, "both conditions hold at once; only the one a reload cannot fix is reported");
});
