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

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-repository-test" },
}));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const NOW = 1_788_000_000_000;
let adminId;
let ownerId;
let editorId;

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
  adminId = await repository.upsertAccount("admin@example.test", NOW);
  ownerId = await repository.upsertAccount("owner@example.test", NOW);
  editorId = await repository.upsertAccount("editor@example.test", NOW);
});

const initialDraft = {
  schema: "organizer-event-draft/1",
  event: { id: null, name: "PF 候選活動", days: [] },
  venue: { assignments: [] },
  officialSource: { label: "", url: null },
};

test("an admin creates an empty event entry and its invited owner gains only that event", async () => {
  const created = await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  assert.deepEqual(created, { ok: true, version: 1 });

  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: ownerId,
    email: "owner@example.test",
    now: NOW + 1,
  }), [{ candidateId: "candidate-pf", role: "owner" }]);

  const ownerEvents = await repository.listOrganizerCandidatesForAccount(ownerId, false);
  assert.equal(ownerEvents.length, 1);
  assert.equal(ownerEvents[0].id, "candidate-pf");
  assert.equal(ownerEvents[0].role, "owner");
  assert.equal(ownerEvents[0].status, "draft");
  assert.deepEqual(await repository.listOrganizerCandidatesForAccount(editorId, false), []);

  const adminEvents = await repository.listOrganizerCandidatesForAccount(adminId, true);
  assert.equal(adminEvents.length, 1);
  assert.equal(adminEvents[0].role, "admin");
});

test("account deletion refuses a sole Owner and preserves candidate history after ownership transfer", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-account-deletion",
    tentativeName: "需交接的活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  assert.deepEqual(await repository.listSoleOwnerOrganizerCandidates(ownerId), [
    { id: "candidate-account-deletion", tentative_name: "需交接的活動" },
  ]);
  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 2,
  }), false);

  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-account-deletion",
    actorAccountId: adminId,
    email: "editor@example.test",
    action: "invite",
    now: NOW + 3,
  }), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 4 });
  assert.deepEqual(await repository.listSoleOwnerOrganizerCandidates(ownerId), []);
  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 5,
  }), true);
  assert.equal(await repository.deleteAccount({
    accountId: ownerId,
    email: "owner@example.test",
    emailAuditDigest: "email-digest",
    legacyEmailAuditDigest: "legacy-email-digest",
    now: NOW + 6,
  }), true);
  assert.equal(await repository.organizerRole("candidate-account-deletion", ownerId), null);
  assert.equal(await repository.organizerRole("candidate-account-deletion", editorId), "owner");
  const candidate = await repository.getOrganizerCandidate("candidate-account-deletion");
  assert.equal(candidate.created_by, adminId);
  assert.equal(candidate.last_updated_by, adminId);
});

test("optimistic versions refuse stale edits and editors cannot submit", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  assert.deepEqual(await repository.manageOrganizerCollaborator({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    email: "editor@example.test",
    role: "editor",
    action: "invite",
    now: NOW + 2,
  }), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const edited = structuredClone(initialDraft);
  edited.event.id = "pf45-rf14";
  edited.event.days = [{ id: "1", label: "第一日", date: "2026-11-07" }];
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: editorId,
    expectedVersion: 1,
    eventId: "pf45-rf14",
    draftJson: JSON.stringify(edited),
    now: NOW + 4,
  }), { ok: true, version: 2 });

  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    expectedVersion: 1,
    eventId: "stale-id",
    draftJson: JSON.stringify(initialDraft),
    now: NOW + 5,
  }), {
    ok: false,
    reason: "conflict",
    currentVersion: 2,
    updatedAt: NOW + 4,
    updatedByRole: "editor",
  });

  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: editorId,
    expectedVersion: 2,
    now: NOW + 6,
  }), { ok: false, reason: "forbidden" });
  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    expectedVersion: 2,
    now: NOW + 7,
  }), { ok: true, status: "submitted" });
});

test("event id locks at submission while requested changes can produce a new reviewed revision", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const complete = structuredClone(initialDraft);
  complete.event.id = "pf45-rf14";
  complete.event.days = [{ id: "1", label: "第一日", date: "2026-11-07" }];
  await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "pf45-rf14", draftJson: JSON.stringify(complete), now: NOW + 2,
  });
  await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2, now: NOW + 3,
  });

  assert.deepEqual(await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 2, decision: "changes_requested",
    actorAccountId: adminId, note: "補上第二日", now: NOW + 4,
  }), { ok: true, status: "changes_requested" });

  const changed = structuredClone(complete);
  changed.event.id = "different-id";
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2,
    eventId: "different-id", draftJson: JSON.stringify(changed), now: NOW + 5,
  }), { ok: false, reason: "event_id_locked", eventId: "pf45-rf14" });

  changed.event.id = "pf45-rf14";
  changed.event.days.push({ id: "2", label: "第二日", date: "2026-11-08" });
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2,
    eventId: "pf45-rf14", draftJson: JSON.stringify(changed), now: NOW + 6,
  }), { ok: true, version: 3 });
  await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 3, now: NOW + 7,
  });
  assert.deepEqual(await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 3, decision: "approve",
    actorAccountId: adminId, note: "ready", now: NOW + 8,
  }), { ok: true, status: "approved" });

  const candidate = await repository.getOrganizerCandidate("candidate-pf");
  assert.equal(candidate.status, "approved");
  assert.equal(candidate.current_version, 3);
  assert.equal(candidate.event_id, "pf45-rf14");
  const revisions = await repository.listOrganizerCandidateRevisions("candidate-pf");
  assert.deepEqual(revisions.map(({ version }) => version), [1, 2, 3]);
});

test("normalized import rows advance the candidate version without storing workbook bytes", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF 候選活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });

  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 2,
    source: {
      fileName: "official.xlsx", worksheet: "Day 1", sha256: "a".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ day: { fixed: "1" } }),
    },
    rows: [{
      sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "A",
      boothCode: "A01", circleName: "甲社", stableKey: "circle-1", identityGroup: "stable:circle-1",
    }],
  }), { ok: true, version: 2 });

  const imported = await repository.getOrganizerImport("candidate-pf");
  assert.equal(imported.source.file_name, "official.xlsx");
  assert.equal(imported.source.worksheet, "Day 1");
  assert.equal(Object.hasOwn(imported.source, "raw_bytes"), false);
  assert.deepEqual(imported.rows.map(({ day_id, booth_code, circle_name, identity_group }) => ({ day_id, booth_code, circle_name, identity_group })), [{
    day_id: "1", booth_code: "A01", circle_name: "甲社", identity_group: "stable:circle-1",
  }]);

  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 3,
    source: {
      fileName: "stale.csv", worksheet: null, sha256: "b".repeat(64),
      sourceDescription: "stale", mappingJson: "{}",
    }, rows: [],
  }), { ok: false, reason: "conflict", currentVersion: 2, updatedAt: NOW + 2, updatedByRole: "owner" });
});

test("map revisions are scoped by candidate, period and venue-space while owner and editor share editing", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerCollaborator({
    candidateId: "candidate-pf", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  const content = JSON.stringify({ schema: "map-contribution-draft/1", layout: {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
    floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
  } });

  assert.deepEqual(await repository.createOrganizerMapDraft({
    id: "map-pf-day1", candidateId: "candidate-pf", periodKey: "1", venueSpaceId: "hall-a",
    actorAccountId: editorId, expectedVersion: 1, contentJson: content, now: NOW + 4,
  }), { ok: true, version: 2, mapRevision: 1 });
  const maps = await repository.listOrganizerMapDrafts("candidate-pf");
  assert.deepEqual(maps.map(({ id, candidate_id, period_key, venue_space_id }) => ({ id, candidate_id, period_key, venue_space_id })), [{
    id: "map-pf-day1", candidate_id: "candidate-pf", period_key: "1", venue_space_id: "hall-a",
  }]);

  const changed = JSON.parse(content);
  changed.layout.landmarks.push({ id: "stage", kind: "stage", label: "舞台", rect: { x: 5, y: 5, width: 10, height: 10 } });
  assert.deepEqual(await repository.saveOrganizerMapDraft({
    candidateId: "candidate-pf", draftId: "map-pf-day1", actorAccountId: ownerId,
    expectedVersion: 2, expectedMapRevision: 1, contentJson: JSON.stringify(changed), now: NOW + 5,
  }), { ok: true, version: 3, mapRevision: 2 });
  assert.equal((await repository.getOrganizerMapDraft("candidate-pf", "map-pf-day1")).current_revision, 2);
});

test("approved snapshots create one leased publication job and webhook deliveries are idempotent", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-pf", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const draft = structuredClone(initialDraft);
  draft.event.id = "pf45";
  await repository.saveOrganizerCandidate({
    candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "pf45", draftJson: JSON.stringify(draft), now: NOW + 2,
  });
  const snapshotJson = JSON.stringify({ schema: "organizer-submission-snapshot/1", candidateId: "candidate-pf", candidateVersion: 2 });
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({
    candidateId: "candidate-pf", candidateVersion: 2, actorAccountId: ownerId,
    snapshotJson, sha256: "a".repeat(64), now: NOW + 3,
  });
  assert.equal(snapshot.ok, true);
  await repository.submitOrganizerCandidate({ candidateId: "candidate-pf", actorAccountId: ownerId, expectedVersion: 2, now: NOW + 4 });
  await repository.reviewOrganizerCandidate({
    candidateId: "candidate-pf", expectedVersion: 2, decision: "approve",
    actorAccountId: adminId, now: NOW + 5,
  });
  const publication = await repository.createOrganizerPublicationJob({
    candidateId: "candidate-pf", candidateVersion: 2, snapshotId: snapshot.snapshotId,
    approvalHash: "a".repeat(64), now: NOW + 6,
  });
  assert.equal(publication.ok, true);
  const lease = await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 7, ttlMs: 60_000 });
  assert.equal(lease.ok, true);
  assert.deepEqual(await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 8, ttlMs: 60_000 }), { ok: false, reason: "busy" });
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: lease.token, expectedStep: "assemble", nextStep: "assemble",
    status: "failed", error: "simulated", now: NOW + 9,
  }), true);
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId: publication.jobId, now: NOW + 10 }), {
    ok: true, step: "assemble",
  });
  assert.deepEqual(await repository.retryOrganizerPublicationJob({ jobId: publication.jobId, now: NOW + 11 }), {
    ok: false, reason: "status", status: "queued",
  });
  const retriedLease = await repository.claimOrganizerPublicationLease({ jobId: publication.jobId, now: NOW + 12, ttlMs: 60_000 });
  assert.equal(retriedLease.ok, true);
  assert.equal(await repository.updateOrganizerPublicationJob({
    jobId: publication.jobId, leaseToken: retriedLease.token, expectedStep: "assemble", nextStep: "smoke",
    status: "published", now: NOW + 13,
  }), true);
  assert.equal((await repository.getOrganizerCandidate("candidate-pf")).status, "published");

  const delivery = { deliveryId: "delivery-1", event: "check_run", payloadSha256: "b".repeat(64), now: NOW + 14 };
  assert.equal(await repository.recordGitHubWebhookDelivery(delivery), "recorded");
  assert.equal(await repository.completeGitHubWebhookDelivery({ deliveryId: delivery.deliveryId, processed: true, now: NOW + 15 }), true);
  assert.equal(await repository.recordGitHubWebhookDelivery(delivery), "duplicate");
  assert.equal(await repository.recordGitHubWebhookDelivery({ ...delivery, payloadSha256: "c".repeat(64) }), "mismatch");
});

/**
 * Organizer candidates share the map_drafts table, and their event_id is the
 * candidate's own — which an organizer may set to an already published event.
 * The candidate_id column is the only thing separating the two pipelines, so
 * the public map-contribution statements have to restate it. Without that a
 * candidate map is submittable, approvable and exportable as a public map.
 */
test("a candidate map never enters the public map-contribution pipeline", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-crossover", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  // The candidate claims the very event id this deployment already serves.
  assert.deepEqual(await repository.saveOrganizerCandidate({
    candidateId: "candidate-crossover", actorAccountId: ownerId, expectedVersion: 1,
    eventId: "ff47", draftJson: JSON.stringify({ ...initialDraft, event: { ...initialDraft.event, id: "ff47" } }),
    now: NOW + 2,
  }), { ok: true, version: 2 });
  // The same person is also a map contributor for the published event.
  assert.equal(await repository.manageMapContributor({
    email: "owner@example.test", action: "grant", by: adminId, now: NOW + 3,
  }), "granted");

  const content = JSON.stringify({ schema: "map-contribution-draft/1", layout: {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80,
    floor: { x: 0, y: 0, width: 100, height: 80 }, rows: [], pillars: [], accessPoints: [], landmarks: [],
  } });
  assert.deepEqual(await repository.createOrganizerMapDraft({
    id: "map-crossover", candidateId: "candidate-crossover", periodKey: "1", venueSpaceId: "hall-a",
    actorAccountId: ownerId, expectedVersion: 2, contentJson: content, now: NOW + 4,
  }), { ok: true, version: 3, mapRevision: 1 });
  const stored = await database.prepare("SELECT event_id, candidate_id FROM map_drafts WHERE id = 'map-crossover'").first();
  assert.deepEqual(stored, { event_id: "ff47", candidate_id: "candidate-crossover" });

  // Invisible to every contributor and admin read scoped by that event id.
  assert.deepEqual(await repository.listMapDraftsForOwner(ownerId, "ff47"), []);
  assert.deepEqual(await repository.listMapDraftsForAdmin("ff47"), []);
  assert.equal(await repository.getMapDraft("map-crossover", "ff47"), null);
  assert.equal(await repository.getMapDraft("map-crossover"), null);
  assert.equal(await repository.getActiveApprovedMapDraft("ff47", "1", "hall-a"), null);

  // And unwritable through them: the candidate's own API stays the only door.
  assert.equal(await repository.writeMapDraftRevision({
    draftId: "map-crossover", eventId: "ff47", ownerAccountId: ownerId,
    expectedRevision: 1, contentJson: content, now: NOW + 5,
  }), null);
  assert.equal(await repository.submitMapDraft({
    draftId: "map-crossover", eventId: "ff47", ownerAccountId: ownerId,
    expectedRevision: 1, now: NOW + 6,
  }), false);
  assert.equal(await repository.addMapDraftFile({
    id: "file-crossover", draftId: "map-crossover", eventId: "ff47", revision: 1,
    objectKey: "raw/crossover", sourceUrl: "https://example.test/plan.png", documentDate: "2026-08-31",
    pageNumber: null, sha256: "0".repeat(64), mime: "image/png", sizeBytes: 10,
    width: 10, height: 10, pageCount: null, uploadedBy: ownerId, now: NOW + 7,
  }), false);
  assert.equal((await repository.getOrganizerMapDraft("candidate-crossover", "map-crossover")).current_revision, 1);
});

test("revoking an editor who has not signed in yet withdraws the pending invitation", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-revoke", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const invite = (now) => repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "invite", now,
  });
  const revoke = (now) => repository.manageOrganizerCollaborator({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test",
    role: "editor", action: "revoke", now,
  });

  // Never accepted: only an invitation row exists, and revoking it must report
  // success rather than "nothing changed".
  assert.deepEqual(await invite(NOW + 2), { ok: true, result: "invited" });
  assert.deepEqual(await revoke(NOW + 3), { ok: true, result: "revoked" });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 4 });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);

  // Nothing left to revoke reports missing.
  assert.deepEqual(await revoke(NOW + 5), { ok: false, reason: "missing" });

  // An accepted editor still revokes through the grant.
  assert.deepEqual(await invite(NOW + 6), { ok: true, result: "invited" });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 7 });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), "editor");
  assert.deepEqual(await revoke(NOW + 8), { ok: true, result: "revoked" });
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), null);
});

test("a booth list larger than one bound parameter still imports atomically", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-bulk", tentativeName: "大型活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  // Past the 500-row chunk boundary, and past what one JSON parameter should
  // carry: a two-day event with this many circles is an ordinary large event.
  const rows = Array.from({ length: 1_700 }, (unused, index) => ({
    sourceRow: index + 2,
    dayId: String((index % 2) + 1),
    venueSpaceId: "hall-a",
    areaId: "a",
    boothCode: `A-${String(index).padStart(5, "0")}`,
    circleName: `サークル${index}・${"名".repeat(40)}`,
    stableKey: null,
    identityGroup: null,
  }));
  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-bulk", actorAccountId: ownerId, expectedVersion: 1,
    source: {
      fileName: "booths.xlsx", worksheet: "Sheet1", sha256: "b".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ boothCode: { column: 0 } }),
    },
    rows, now: NOW + 2,
  }), { ok: true, version: 2 });

  const imported = await repository.getOrganizerImport("candidate-bulk");
  assert.equal(imported.rows.length, rows.length);
  assert.equal(imported.rows[0].booth_code, "A-00000");
  assert.equal(imported.rows.at(-1).booth_code, "A-01699");
  assert.equal(new Set(imported.rows.map(({ id }) => id)).size, rows.length);
  assert.equal(new Set(imported.rows.map(({ source_id }) => source_id)).size, 1);

  // Replacing it retires the old source and leaves exactly the new rows.
  assert.deepEqual(await repository.replaceOrganizerImport({
    candidateId: "candidate-bulk", actorAccountId: ownerId, expectedVersion: 2,
    source: {
      fileName: "booths-v2.xlsx", worksheet: "Sheet1", sha256: "c".repeat(64),
      sourceDescription: "主辦提供", mappingJson: JSON.stringify({ boothCode: { column: 0 } }),
    },
    rows: rows.slice(0, 3), now: NOW + 3,
  }), { ok: true, version: 3 });
  const replaced = await repository.getOrganizerImport("candidate-bulk");
  assert.equal(replaced.rows.length, 3);
  assert.equal(replaced.source.sha256, "c".repeat(64));
});

test("account deletion shreds the private workbook name alongside its uploader", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-shred", tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-shred", actorAccountId: adminId, email: "editor@example.test",
    action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  await repository.replaceOrganizerImport({
    candidateId: "candidate-shred", actorAccountId: ownerId, expectedVersion: 1,
    source: {
      fileName: "PF45 內部攤位表 最終版.xlsx", worksheet: "不要外流", sha256: "d".repeat(64),
      sourceDescription: "主辦提供", mappingJson: "{}",
    },
    rows: [{
      sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "a",
      boothCode: "A-01", circleName: "測試社團", stableKey: null, identityGroup: null,
    }],
    now: NOW + 4,
  });

  assert.equal(await repository.beginAccountDeletion({
    accountId: ownerId, email: "owner@example.test", now: NOW + 5,
  }), true);
  assert.equal(await repository.deleteAccount({
    accountId: ownerId, email: "owner@example.test",
    emailAuditDigest: "email-digest", legacyEmailAuditDigest: "legacy-email-digest", now: NOW + 6,
  }), true);

  const source = await database.prepare(
    "SELECT created_by, file_name, worksheet, sha256 FROM organizer_import_sources WHERE candidate_id = 'candidate-shred'",
  ).first();
  assert.equal(source.created_by, "[shredded]");
  assert.equal(source.file_name, "[shredded]");
  assert.equal(source.worksheet, null);
  // The provenance hash is not personal data and outlives the account.
  assert.equal(source.sha256, "d".repeat(64));
});

test("the last Owner survives two admins revoking the final two at once", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-race", tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-race", actorAccountId: adminId, email: "editor@example.test",
    action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const revoke = (email) => repository.manageOrganizerOwner({
    candidateId: "candidate-race", actorAccountId: adminId, email, action: "revoke", now: NOW + 4,
  });
  // Both see two active Owners; a count read before the write would let both
  // through and leave the candidate with none.
  const [first, second] = await Promise.all([revoke("owner@example.test"), revoke("editor@example.test")]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((result) => result.ok).length, 1, "exactly one revoke may win");
  assert.deepEqual(outcomes.find((result) => !result.ok), { ok: false, reason: "last_owner" });

  const owners = await database.prepare(
    "SELECT COUNT(*) AS n FROM organizer_event_grants WHERE candidate_id = 'candidate-race' AND role = 'owner' AND revoked_at IS NULL",
  ).first();
  assert.equal(owners.n, 1, "the candidate must never be left ownerless");
});
