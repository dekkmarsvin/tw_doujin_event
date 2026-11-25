import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { resetSiteSettings } from "./support/site-settings-fixture.mjs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";
import { organizerRepositoryFixtureScript, resetOrganizerRepositoryFixture } from "./support/organizer-repository-fixture.mjs";
import { applyMigrations } from "./support/d1-migrations.mjs";

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
const { sha256Hex } = await environment.runner.import("/app/portal-crypto.ts");
const { circleRetentionExpiresAt } = await environment.runner.import("/app/circle-overrides.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: await organizerRepositoryFixtureScript(),
  d1Databases: { DB: "organizer-repository-test" },
}));
const database = await miniflare.getD1Database("DB");
await applyMigrations(database);
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const NOW = 1_788_000_000_000;
let adminId;
let ownerId;
let editorId;

before(() => repository.ensureTables());
beforeEach(async () => {
  ({ adminId, ownerId, editorId } = await resetOrganizerRepositoryFixture(miniflare, NOW));
  await resetSiteSettings(database);
});

const initialDraft = {
  schema: "organizer-event-draft/1",
  event: { id: null, name: "PF 候選活動", days: [] },
  venue: { assignments: [] },
  officialSource: { label: "", url: null },
};

/** A submitted AMEND candidate correcting second-event's date, with circle deadlines to recount. */
async function correctedDateFixture() {
  const id = "publication-candidate";
  const eventId = "second-event";
  await repository.createOrganizerCandidate({ id, tentativeName: "Publication", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify({ ...initialDraft, event: { ...initialDraft.event, id: eventId } }), now: NOW });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await database.prepare("UPDATE organizer_event_candidates SET event_id = ?2, publication_operation = 'AMEND' WHERE id = ?1").bind(id, eventId).run();
  const draft = { schema: "organizer-event-draft/1", event: { id: eventId, name: "第二場", days: [{ id: "1", label: "第一天", date: "2026-11-07" }] },
    venue: { assignments: [] }, officialSource: { label: "", url: null } };
  const snapshotJson = JSON.stringify({ schema: "organizer-submission-snapshot/4", operation: "AMEND", candidateId: id, candidateVersion: 1,
    eventId, draft, amendment: { changes: [], settings: { days: [{ id: "1", date: "2026-11-21" }] } } });
  const hash = await sha256Hex(snapshotJson);
  const snapshot = await repository.storeOrganizerSubmissionSnapshot({ candidateId: id, candidateVersion: 1,
    actorAccountId: ownerId, snapshotJson, sha256: hash, now: NOW + 2 });
  await repository.submitOrganizerCandidate({ candidateId: id, actorAccountId: ownerId, expectedVersion: 1, now: NOW + 3 });
  const rows = [["early", eventId, "purge", 1], ["late", eventId, "purge", 9_999_999_999_999],
    ["kept", eventId, "keep", null], ["unanswered", eventId, null, null], ["other", "other-event", "purge", 1]];
  await database.batch(rows.map(([circle, event, choice, expires]) => database.prepare(`INSERT INTO circle_overrides
      (id,event_id,circle_id,fields_json,updated_by,created_at,updated_at,retention_choice,retention_expires_at)
      VALUES (?1,?2,?3,'{}',?4,?5,?5,?6,?7)`).bind(`override-${circle}`, event, circle, ownerId, NOW, choice, expires)));
  const claim = (actorAccountId = adminId, approvalHash = hash) => repository.claimOrganizerApproval({ candidateId: id, expectedVersion: 1,
    actorAccountId, snapshotId: snapshot.snapshotId, approvalHash, now: NOW + 4 });
  const publish = async () => {
    await claim();
    return repository.publishOrganizerCandidate({ candidateId: id, expectedVersion: 1,
      actorAccountId: adminId, snapshotId: snapshot.snapshotId, approvalHash: hash, eventEndsAt: "2026-11-21T23:59:59+08:00", now: NOW + 5 });
  };
  const deadlines = async () => Object.fromEntries((await database.prepare("SELECT circle_id, retention_expires_at FROM circle_overrides").all()).results
    .map((row) => [row.circle_id, row.retention_expires_at]));
  const recounted = circleRetentionExpiresAt("purge", Date.parse("2026-11-21T23:59:59+08:00"));
  return { id, claim, publish, deadlines, recounted };
}

// ADR-0068: deadlines count from the event's end, so a corrected date moves
// every purge deadline of that event once the correction is live, and nothing else.
test("publishing a corrected event date recounts that event's purge deadlines and nothing else", async () => {
  const { id, publish, deadlines, recounted } = await correctedDateFixture();
  assert.deepEqual(await publish(), { ok: true, alreadyPublished: false });
  assert.deepEqual(await deadlines(), { early: recounted, late: recounted, kept: null, unanswered: null, other: 1 });
  const candidate = await repository.getOrganizerCandidate(id);
  assert.deepEqual([candidate.status, candidate.published_version, candidate.approved_by], ["published", 1, adminId]);
  assert.deepEqual(await publish(), { ok: true, alreadyPublished: true }, "approving again after a lost response is harmless");
});

// The status change and the recount commit together: a candidate marked
// published on its own would keep the old deadlines for good.
test("a completion that fails to commit leaves the candidate submitted, and approving again recounts the deadlines", async () => {
  const { id, publish, deadlines, recounted } = await correctedDateFixture();
  const before = await deadlines();
  await database.prepare(`CREATE TRIGGER fail_retention_recount BEFORE UPDATE OF retention_expires_at ON circle_overrides
    BEGIN SELECT RAISE(ABORT, 'injected retention failure'); END`).run();
  try { await assert.rejects(publish()); }
  finally { await database.prepare("DROP TRIGGER IF EXISTS fail_retention_recount").run(); }
  assert.equal((await repository.getOrganizerCandidate(id)).status, "approved", "the claim stands for the retry");
  assert.deepEqual(await deadlines(), before, "no part of the completion landed");
  assert.deepEqual(await publish(), { ok: true, alreadyPublished: false });
  assert.deepEqual(await deadlines(), { early: recounted, late: recounted, kept: null, unanswered: null, other: 1 });
});

test("only an active admin approving the submitted snapshot can claim it, and a claimed version cannot be sent back", async () => {
  const { id, claim } = await correctedDateFixture();
  assert.equal(await claim(ownerId), false, "an owner cannot approve");
  assert.equal(await claim(adminId, "f".repeat(64)), false, "a different approval hash is not the submitted snapshot");
  assert.equal((await repository.getOrganizerCandidate(id)).status, "submitted");
  assert.equal(await claim(), true);
  assert.equal((await repository.reviewOrganizerCandidate({ candidateId: id, expectedVersion: 1, actorAccountId: adminId, now: NOW + 5 })).ok, false);
  await repository.releaseOrganizerApproval({ candidateId: id, expectedVersion: 1, now: NOW + 6 });
  assert.equal((await repository.reviewOrganizerCandidate({ candidateId: id, expectedVersion: 1, actorAccountId: adminId, now: NOW + 7 })).ok, true,
    "a refused publication returns to review");
});

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

test("an admin named as their own event's owner is granted it in the creating transaction", async () => {
  const created = await repository.createOrganizerCandidate({
    id: "candidate-self-owned",
    tentativeName: "自己負責的候選活動",
    ownerEmail: "admin@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
    ownerGrant: { accountId: adminId, audit: {
      at: NOW, actorAccountId: adminId, actorRole: "admin",
      action: "organizer_event.owner_granted_on_create", subjectType: "organizer_event",
      subjectId: "candidate-self-owned", detail: { reason: "creator_is_owner" },
    } },
  });
  assert.deepEqual(created, { ok: true, version: 1 });
  assert.equal(await repository.organizerRole("candidate-self-owned", adminId), "owner");

  // The grant and the audit row that explains it are in the same batch: an
  // account holding owner with nothing saying why is not an outcome to allow.
  const audit = await database.prepare(
    "SELECT action, actor_role FROM audit_log WHERE subject_id = ?1",
  ).bind("candidate-self-owned").all();
  assert.deepEqual(audit.results.map((row) => `${row.actor_role}:${row.action}`),
    ["admin:organizer_event.owner_granted_on_create"]);

  // The invitation is stamped accepted at creation, so the ordinary sign-in
  // path finds nothing pending and cannot mint a second grant.
  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: adminId, email: "admin@example.test", now: NOW + 1,
  }), []);
  assert.equal((await database.prepare(
    "SELECT COUNT(*) AS total FROM organizer_event_grants WHERE candidate_id = ?1",
  ).bind("candidate-self-owned").first()).total, 1);

  // Everyone else still reaches the workspace through the invitation.
  await repository.createOrganizerCandidate({
    id: "candidate-invited",
    tentativeName: "別人負責的候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  assert.equal(await repository.organizerRole("candidate-invited", ownerId), null);
  assert.deepEqual(await repository.acceptOrganizerInvitations({
    accountId: ownerId, email: "owner@example.test", now: NOW + 2,
  }), [{ candidateId: "candidate-invited", role: "owner" }]);
});

test("workspace progress is per candidate and resume location is per collaborator without candidate revisions", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-workspace",
    tentativeName: "PF 候選活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-workspace", actorAccountId: ownerId,
    email: "editor@example.test", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });

  const ownerWorkspace = await repository.getOrganizerWorkspace("candidate-workspace", ownerId);
  assert.equal(ownerWorkspace.state.onboarding_completed_at, null);
  assert.equal(ownerWorkspace.preference, null);
  assert.equal((await repository.listOrganizerCandidatesForAccount(ownerId, false))[0].workspace_mode, "guided");

  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-workspace", accountId: ownerId,
    guidedTask: "days", lastSection: "import", now: NOW + 4,
  }), true);
  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-workspace", accountId: editorId,
    guidedTask: "venue", lastSection: "map", now: NOW + 5,
  }), true);
  assert.equal((await repository.getOrganizerWorkspace("candidate-workspace", ownerId)).preference.last_section, "import");
  assert.equal((await repository.getOrganizerWorkspace("candidate-workspace", editorId)).preference.last_section, "map");
  assert.deepEqual((await repository.listOrganizerCandidateRevisions("candidate-workspace")).map((row) => row.version), [1]);

  const completions = await Promise.all([
    repository.completeOrganizerOnboarding({
      candidateId: "candidate-workspace", actorAccountId: ownerId, expectedVersion: 1, now: NOW + 6,
    }),
    repository.completeOrganizerOnboarding({
      candidateId: "candidate-workspace", actorAccountId: editorId, expectedVersion: 1, now: NOW + 7,
    }),
  ]);
  assert.equal(completions.every((result) => result.ok), true);
  assert.equal(completions.filter((result) => result.ok && !result.alreadyCompleted).length, 1);
  assert.equal(completions.filter((result) => result.ok && result.alreadyCompleted).length, 1);
  const completedAt = completions.find((result) => result.ok && !result.alreadyCompleted).completedAt;
  assert.deepEqual(await repository.completeOrganizerOnboarding({
    candidateId: "candidate-workspace", actorAccountId: editorId, expectedVersion: 99, now: NOW + 8,
  }), { ok: true, completedAt, alreadyCompleted: true });
  assert.equal((await repository.listOrganizerCandidatesForAccount(ownerId, false))[0].workspace_mode, "binder");
  assert.equal((await repository.getOrganizerCandidate("candidate-workspace")).current_version, 1);
  assert.deepEqual((await repository.listOrganizerCandidateRevisions("candidate-workspace")).map((row) => row.version), [1]);
});

test("a revoked collaborator cannot change workspace navigation or complete onboarding", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-revoked-workspace",
    tentativeName: "撤銷測試活動",
    ownerEmail: "owner@example.test",
    createdByAccountId: adminId,
    draftJson: JSON.stringify(initialDraft),
    now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({
    candidateId: "candidate-revoked-workspace", actorAccountId: ownerId,
    email: "editor@example.test", action: "invite", now: NOW + 2,
  });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-revoked-workspace", accountId: editorId,
    guidedTask: "days", lastSection: "event", now: NOW + 4,
  }), true);
  await repository.manageOrganizerOwner({
    candidateId: "candidate-revoked-workspace", actorAccountId: ownerId,
    email: "editor@example.test", action: "revoke", now: NOW + 5,
  });

  assert.equal(await repository.saveOrganizerWorkspacePreference({
    candidateId: "candidate-revoked-workspace", accountId: editorId,
    guidedTask: "venue", lastSection: "map", now: NOW + 6,
  }), false);
  assert.equal((await repository.getOrganizerWorkspace("candidate-revoked-workspace", editorId)).preference.last_section, "event");
  assert.deepEqual(await repository.completeOrganizerOnboarding({
    candidateId: "candidate-revoked-workspace", actorAccountId: editorId,
    expectedVersion: 1, now: NOW + 7,
  }), { ok: false, reason: "forbidden" });
  assert.equal((await repository.getOrganizerWorkspace("candidate-revoked-workspace", ownerId)).state.onboarding_completed_at, null);
});

test("a candidate without ADR-0047 state is treated as a legacy binder", async () => {
  await database.prepare(
    `INSERT INTO organizer_event_candidates (
       id, tentative_name, status, current_version, current_draft_json,
       created_by, created_at, updated_at, last_updated_by, last_updated_role
     ) VALUES ('legacy-candidate', '既有活動', 'draft', 1, ?1, ?2, ?3, ?3, ?2, 'admin')`,
  ).bind(JSON.stringify(initialDraft), adminId, NOW).run();
  assert.equal(await repository.markOrganizerValidated("legacy-candidate", 1, NOW + 1), true);
  const workspace = await repository.getOrganizerWorkspace("legacy-candidate", adminId);
  assert.equal(workspace.state.onboarding_completed_at, NOW);
  assert.equal(workspace.state.onboarding_completed_by, null);
  assert.equal(workspace.state.last_validated_version, 1);
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
  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    email: "editor@example.test",
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
    updatedByRole: "owner",
  });

  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-pf",
    actorAccountId: ownerId,
    expectedVersion: 2,
    now: NOW + 7,
  }), { ok: true, status: "submitted" });
});

test("a site admin without the Owner grant submits and manages collaborators, and loses both with the roster", async () => {
  // ADR-0080. The write itself rechecks the roster, as it does the Owner grant.
  await repository.createOrganizerCandidate({
    id: "candidate-admin-acts", tentativeName: "管理者代辦", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  const complete = structuredClone(initialDraft);
  complete.event.id = "admin-acts";
  complete.event.days = [{ id: "1", label: "第一日", date: "2026-11-07" }];
  await repository.saveOrganizerCandidate({
    candidateId: "candidate-admin-acts", actorAccountId: adminId, expectedVersion: 1,
    eventId: "admin-acts", draftJson: JSON.stringify(complete), now: NOW + 1, admin: true,
  });
  assert.equal(await repository.organizerRole("candidate-admin-acts", adminId), null, "the admin holds no grant");
  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-admin-acts", actorAccountId: adminId, email: "editor@example.test", action: "invite", now: NOW + 2,
  }), { ok: true, result: "invited" });
  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-admin-acts", actorAccountId: editorId, email: "other@example.test", action: "invite", now: NOW + 2,
  }), { ok: false, reason: "forbidden" }, "an account with neither grant nor roster place still cannot");

  await database.prepare("DELETE FROM admins WHERE email = 'admin@example.test'").run();
  assert.deepEqual(await repository.manageOrganizerOwner({
    candidateId: "candidate-admin-acts", actorAccountId: adminId, email: "editor@example.test", action: "revoke", now: NOW + 3,
  }), { ok: false, reason: "forbidden" });
  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-admin-acts", actorAccountId: adminId, expectedVersion: 2, now: NOW + 3,
  }), { ok: false, reason: "forbidden" });
  await repository.addAdmin("admin@example.test", "bootstrap", NOW + 4);

  assert.deepEqual(await repository.submitOrganizerCandidate({
    candidateId: "candidate-admin-acts", actorAccountId: adminId, expectedVersion: 2, now: NOW + 5,
  }), { ok: true, status: "submitted" });
  const submitted = await repository.getOrganizerCandidate("candidate-admin-acts");
  assert.equal(submitted.submitted_by, adminId);
  assert.equal(submitted.last_updated_role, "admin");
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
  const candidate = await repository.getOrganizerCandidate("candidate-pf");
  assert.equal(candidate.status, "submitted");
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
      codes: ["A01", "A02"], circleName: "甲社", stableKey: "circle-1", identityGroup: "stable:circle-1",
    }],
  }), { ok: true, version: 2 });

  const imported = await repository.getOrganizerImport("candidate-pf");
  assert.equal(imported.source.file_name, "official.xlsx");
  assert.equal(imported.source.worksheet, "Day 1");
  assert.equal(Object.hasOwn(imported.source, "raw_bytes"), false);
  assert.deepEqual(imported.rows.map(({ day_id, booth_code, circle_name, identity_group }) => ({ day_id, booth_code, circle_name, identity_group })), [{
    day_id: "1", booth_code: "A01", circle_name: "甲社", identity_group: "stable:circle-1",
  }]);

  assert.deepEqual(imported.rows[0].codes, ["A01", "A02"]);
  // Existing scalar records must stay literal until the organizer confirms a reimport.
  await database.prepare("UPDATE organizer_import_rows SET codes_json = NULL, booth_code = 'A01A02' WHERE source_id = ?1").bind(imported.source.id).run();
  assert.deepEqual((await repository.getOrganizerImport("candidate-pf")).rows[0].codes, ["A01A02"]);

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
  await repository.manageOrganizerOwner({
    candidateId: "candidate-pf", actorAccountId: ownerId, email: "editor@example.test", action: "invite", now: NOW + 2,
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

  assert.equal((await repository.getOrganizerMapDraft("candidate-crossover", "map-crossover")).current_revision, 1);
});

// #546 5b review: an invitation that raced an acceptance can leave a member
// with a pending invitation too. Removing them has to withdraw it, or their
// next sign-in would accept it and restore access.
test("removing a member also withdraws a pending invitation for them", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-race", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({ candidateId: "candidate-race", actorAccountId: ownerId, email: "editor@example.test", action: "invite", now: NOW + 2 });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  await database.prepare(`INSERT INTO organizer_event_invitations (id, candidate_id, email, role, invited_by, created_at)
    VALUES ('raced', 'candidate-race', 'editor@example.test', 'owner', ?1, ?2)`).bind(ownerId, NOW + 4).run();
  assert.deepEqual(await repository.manageOrganizerOwner({ candidateId: "candidate-race", actorAccountId: ownerId, email: "editor@example.test", action: "revoke", now: NOW + 5 }),
    { ok: true, result: "revoked" });
  assert.deepEqual(await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 6 }), []);
  assert.equal(await repository.organizerRole("candidate-race", editorId), null);
});

test("revoking an editor who has not signed in yet withdraws the pending invitation", async () => {
  await repository.createOrganizerCandidate({
    id: "candidate-revoke", tentativeName: "PF", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW,
  });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const invite = (now) => repository.manageOrganizerOwner({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test", action: "invite", now,
  });
  const revoke = (now) => repository.manageOrganizerOwner({
    candidateId: "candidate-revoke", actorAccountId: ownerId, email: "editor@example.test", action: "revoke", now,
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
  assert.equal(await repository.organizerRole("candidate-revoke", editorId), "owner");
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
    codes: [`A-${String(index).padStart(5, "0")}`],
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

test("account deletion removes the uploader and keeps the workbook names the approval record holds", async () => {
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
      codes: ["A-01"], circleName: "測試社團", stableKey: null, identityGroup: null,
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
  // The organizer's file and sheet names describe the event's data, as the
  // approved snapshot does (#573).
  assert.equal(source.file_name, "PF45 內部攤位表 最終版.xlsx");
  assert.equal(source.worksheet, "不要外流");
  // The provenance hash is not personal data and outlives the account.
  assert.equal(source.sha256, "d".repeat(64));
});

for (const actors of ["admins", "owners"]) {
test(`the last Owner survives two ${actors} revoking the final two at once`, async () => {
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

  const revoke = (email, actorId) => repository.manageOrganizerOwner({
    candidateId: "candidate-race", actorAccountId: actors === "admins" ? adminId : actorId, email, action: "revoke", now: NOW + 4,
  });
  // Both see two active Owners; a count read before the write would let both
  // through and leave the candidate with none.
  const [first, second] = await Promise.all([revoke("owner@example.test", ownerId), revoke("editor@example.test", editorId)]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((result) => result.ok).length, 1, "exactly one revoke may win");
  assert.deepEqual(outcomes.find((result) => !result.ok), { ok: false, reason: "last_owner" });

  const owners = await database.prepare(
    "SELECT COUNT(*) AS n FROM organizer_event_grants WHERE candidate_id = 'candidate-race' AND role = 'owner' AND revoked_at IS NULL",
  ).first();
  assert.equal(owners.n, 1, "the candidate must never be left ownerless");
});
}

for (const operation of ["invite", "resend", "revoke-grant", "revoke-invitation"]) {
test(`collaborator management rechecks a grantless admin's roster place at ${operation}`, async () => {
  // ADR-0080: an admin with no grant here acts on the roster alone, so losing
  // it between the check and the write must stop the write.
  const candidateId = "collaborator-admin-race";
  await repository.createOrganizerCandidate({ id: candidateId, tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  const editor = { candidateId, actorAccountId: ownerId, role: "editor" };
  await repository.manageOrganizerOwner({ ...editor, email: "editor@example.test", action: "invite", now: NOW + 2 });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  await repository.manageOrganizerOwner({ ...editor, email: "pending@example.test", action: "invite", now: NOW + 4 });
  assert.equal(await repository.organizerRole(candidateId, adminId), null);
  const email = operation === "revoke-grant" ? "editor@example.test" : operation === "invite" ? "new@example.test" : "pending@example.test";
  let armed = false;
  let authorityReads = 0;
  const loseRoster = () => database.prepare("DELETE FROM admins WHERE email = 'admin@example.test'").run();
  const racing = createIdentityRepository(new Proxy(database, { get(target, key) {
    if (key === "batch") return async statements => {
      if (armed && operation.startsWith("revoke")) { armed = false; await loseRoster(); }
      return target.batch(statements);
    };
    if (key === "prepare") return sql => {
      const statement = target.prepare(sql);
      return { bind: (...args) => {
        const bound = statement.bind(...args);
        const shouldRevoke = armed && (operation === "resend"
          ? sql.includes("SELECT 1 AS allowed") && ++authorityReads === 2
          : (operation === "invite" && sql.includes("INSERT INTO organizer_event_invitations"))
            || (operation === "revoke-invitation" && sql.includes("UPDATE organizer_event_invitations")));
        if (!shouldRevoke) return bound;
        const method = operation === "resend" ? "first" : "run";
        return new Proxy(bound, { get(inner, member) {
          if (member === method) return async (...values) => { armed = false; await loseRoster(); return inner[method](...values); };
          const value = Reflect.get(inner, member);
          return typeof value === "function" ? value.bind(inner) : value;
        } });
      }, run: statement.run.bind(statement), all: statement.all.bind(statement), first: statement.first.bind(statement) };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }));
  await racing.ensureTables();
  armed = true;
  const action = operation.startsWith("revoke") ? "revoke" : operation;
  assert.deepEqual(await racing.manageOrganizerOwner({ candidateId, actorAccountId: adminId, email, action, now: NOW + 6 }),
    { ok: false, reason: "forbidden" });
  assert.equal(armed, false, "the roster change must occur at the operation boundary");
  assert.equal(await repository.organizerRole(candidateId, editorId), "owner");
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM organizer_event_invitations WHERE candidate_id = ?1 AND email = 'pending@example.test' AND revoked_at IS NULL")
    .bind(candidateId).first()).n, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM organizer_event_invitations WHERE candidate_id = ?1 AND email = 'new@example.test'")
    .bind(candidateId).first()).n, 0);
});
}

for (const actor of ["owner", "admin"]) {
for (const operation of ["invite", "resend", "revoke-grant", "revoke-invitation"]) {
test(`owner management rechecks ${actor} authority at ${operation}`, async () => {
  const candidateId = "owner-authority-race";
  await repository.createOrganizerCandidate({ id: candidateId, tentativeName: "活動", ownerEmail: "owner@example.test",
    createdByAccountId: adminId, draftJson: JSON.stringify(initialDraft), now: NOW });
  await repository.acceptOrganizerInvitations({ accountId: ownerId, email: "owner@example.test", now: NOW + 1 });
  await repository.manageOrganizerOwner({ candidateId, actorAccountId: ownerId, email: "editor@example.test", action: "invite", now: NOW + 2 });
  await repository.acceptOrganizerInvitations({ accountId: editorId, email: "editor@example.test", now: NOW + 3 });
  await repository.manageOrganizerOwner({ candidateId, actorAccountId: ownerId, email: "pending@example.test", action: "invite", now: NOW + 4 });
  const actorAccountId = actor === "admin" ? adminId : ownerId;
  const email = operation === "revoke-grant" ? "editor@example.test" : operation === "invite" ? "new@example.test" : "pending@example.test";
  let armed = false;
  let authorityReads = 0;
  const racing = createIdentityRepository(new Proxy(database, { get(target, key) {
    // Revoking a grant and its notification now commit together. Inject the
    // authority loss immediately before that transaction, rather than a .run()
    // that batch does not execute. Keep the same authorization assertions.
    if (key === "batch") return async statements => {
      if (armed && operation === "revoke-grant") {
        armed = false;
        if (actor === "admin") await database.prepare("DELETE FROM admins WHERE email = 'admin@example.test'").run();
        else await database.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = ?2 AND account_id = ?3")
          .bind(NOW + 5, candidateId, ownerId).run();
      }
      return target.batch(statements);
    };
    if (key === "prepare") return sql => {
      const statement = target.prepare(sql);
      return { bind: (...args) => {
        const bound = statement.bind(...args);
        const shouldRevoke = armed && (operation === "resend"
          ? sql.includes("SELECT 1 AS allowed") && ++authorityReads === 2
          : (operation === "invite" ? sql.includes("INSERT INTO organizer_event_invitations")
            : operation === "revoke-grant" ? sql.includes("UPDATE organizer_event_grants")
              : sql.includes("UPDATE organizer_event_invitations")));
        if (!shouldRevoke) return bound;
        const method = operation === "resend" ? "first" : "run";
        return new Proxy(bound, { get(statement, key) {
          if (key === method) return async (...values) => {
            armed = false;
            if (actor === "admin") await database.prepare("DELETE FROM admins WHERE email = 'admin@example.test'").run();
            else await database.prepare("UPDATE organizer_event_grants SET revoked_at = ?1 WHERE candidate_id = ?2 AND account_id = ?3")
              .bind(NOW + 5, candidateId, ownerId).run();
            return statement[method](...values);
          };
          const value = Reflect.get(statement, key);
          return typeof value === "function" ? value.bind(statement) : value;
        } });
      }, run: statement.run.bind(statement), all: statement.all.bind(statement), first: statement.first.bind(statement) };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }));
  await racing.ensureTables();
  armed = true;
  const action = operation.startsWith("revoke") ? "revoke" : operation;
  assert.deepEqual(await racing.manageOrganizerOwner({ candidateId, actorAccountId, email, action, now: NOW + 6 }),
    { ok: false, reason: "forbidden" });
  assert.equal(armed, false, "the authority change must occur at the operation boundary");
  assert.equal(await repository.organizerRole(candidateId, editorId), "owner");
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM organizer_event_invitations WHERE candidate_id = ?1 AND email = 'pending@example.test' AND revoked_at IS NULL")
    .bind(candidateId).first()).n, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM organizer_event_invitations WHERE candidate_id = ?1 AND email = 'new@example.test'")
    .bind(candidateId).first()).n, 0);
});
}
}
