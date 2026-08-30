import assert from "node:assert/strict";
import test, { after } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { IDENTITY_COLUMN_MIGRATIONS, IDENTITY_INDEXES, IDENTITY_TABLES } = await environment.runner.import("/db/identity-runtime-schema.ts");
const { parseCircleOverridesPayload } = await environment.runner.import("/app/circle-overrides.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "identity-test", LEGACY_DB: "identity-legacy-test" },
}));
const database = await miniflare.getD1Database("DB");
const legacyDatabase = await miniflare.getD1Database("LEGACY_DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

const NOW = 1_786_500_000_000;

test("creates every table and index on first use", async () => {
  await repository.ensureTables();
  // Idempotent: a second call must not throw on the IF NOT EXISTS statements.
  await repository.ensureTables();
  const tables = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
  assert.deepEqual(
    tables.results.map((row) => row.name),
    IDENTITY_TABLES.map((table) => table.name).sort(),
    "runtime tables must exactly match the schema authority",
  );

  const indexes = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  assert.deepEqual(
    indexes.results.map((row) => row.name),
    IDENTITY_INDEXES.map((index) => index.name).sort(),
    "runtime indexes must exactly match the schema authority",
  );

  for (const expected of IDENTITY_TABLES) {
    const info = await database.prepare(`PRAGMA table_info(${expected.name})`).all();
    assert.deepEqual(
      info.results.map((column) => column.name),
      [...expected.columnNames],
      `${expected.name} columns must match the schema authority`,
    );
  }
});

test("additive column migrations upgrade an existing database idempotently", async () => {
  // One CREATE per table, listing every column added after it existed: a table
  // can be behind by more than one migration, and `circle_overrides` now is.
  for (const [tableName, missingColumns] of [
    ["circle_overrides", ["post_event_hidden", "retention_choice", "retention_expires_at", "hosted_thumbnail_key"]],
    ["overrides_doc", ["phase"]],
    ["audit_log", ["shredded_at"]],
  ]) {
    const definition = IDENTITY_TABLES.find((table) => table.name === tableName);
    assert.ok(definition);
    const oldColumns = definition.columns.filter((column) => !missingColumns.some((missing) => column.startsWith(`${missing} `)));
    await legacyDatabase.prepare(`CREATE TABLE ${tableName} (${oldColumns.join(", ")})`).run();
  }

  const legacyRepository = createIdentityRepository(legacyDatabase);
  await legacyRepository.ensureTables();
  await legacyRepository.ensureTables();

  for (const migration of IDENTITY_COLUMN_MIGRATIONS) {
    const info = await legacyDatabase.prepare(`PRAGMA table_info(${migration.table})`).all();
    assert.ok(info.results.some((column) => column.name === migration.column), `missing upgraded column ${migration.table}.${migration.column}`);
  }
});

test("a login token is single use and cannot be replayed", async () => {
  await repository.createLoginToken({ tokenHash: "hash-a", email: "a@example.com", now: NOW, expiresAt: NOW + 900_000, ipHash: "ip" });

  assert.equal(await repository.consumeLoginToken("hash-a", NOW + 1_000), "a@example.com");
  assert.equal(await repository.consumeLoginToken("hash-a", NOW + 2_000), null, "a consumed token must not verify twice");
});

test("an expired token cannot be consumed", async () => {
  await repository.createLoginToken({ tokenHash: "hash-expired", email: "b@example.com", now: NOW, expiresAt: NOW + 1_000, ipHash: null });
  assert.equal(await repository.consumeLoginToken("hash-expired", NOW + 2_000), null);
});

test("consuming a link retires every other outstanding link for that inbox", async () => {
  await repository.createLoginToken({ tokenHash: "hash-c1", email: "c@example.com", now: NOW, expiresAt: NOW + 900_000, ipHash: null });
  await repository.createLoginToken({ tokenHash: "hash-c2", email: "c@example.com", now: NOW, expiresAt: NOW + 900_000, ipHash: null });

  assert.equal(await repository.consumeLoginToken("hash-c1", NOW + 1_000), "c@example.com");
  assert.equal(await repository.consumeLoginToken("hash-c2", NOW + 2_000), null, "an older link must die with the one that was used");
});

test("counts recent requests per inbox and per address for rate limiting", async () => {
  await repository.createLoginToken({ tokenHash: "hash-r1", email: "rate@example.com", now: NOW, expiresAt: NOW + 900_000, ipHash: "ip-rate" });
  await repository.createLoginToken({ tokenHash: "hash-r2", email: "rate@example.com", now: NOW + 10, expiresAt: NOW + 900_000, ipHash: "ip-rate" });

  assert.equal(await repository.countLoginTokensSince("email", "rate@example.com", NOW - 1), 2);
  assert.equal(await repository.countLoginTokensSince("request_ip_hash", "ip-rate", NOW - 1), 2);
  assert.equal(await repository.countLoginTokensSince("email", "rate@example.com", NOW + 1_000), 0, "the window must exclude older rows");
});

test("one inbox maps to one account across repeated logins", async () => {
  const first = await repository.upsertAccount("dup@example.com", NOW);
  const second = await repository.upsertAccount("dup@example.com", NOW + 5_000);
  assert.equal(first, second);
});

test("a session resolves only while live, and revocation takes effect at once", async () => {
  const accountId = await repository.upsertAccount("session@example.com", NOW);
  await repository.createSession(accountId, NOW, NOW + 100_000, "session-1");

  const resolved = await repository.getSession("session-1", NOW + 1_000);
  assert.equal(resolved?.accountId, accountId);
  assert.equal(resolved?.email, "session@example.com");

  assert.equal(await repository.getSession("session-1", NOW + 200_000), null, "an expired session must not resolve");
  await repository.revokeSession("session-1", NOW + 2_000);
  assert.equal(await repository.getSession("session-1", NOW + 3_000), null, "a revoked session must not resolve");
  assert.equal(await repository.getSession("no-such-session", NOW), null);
});

test("disabling an account revokes its sessions and blocks future login", async () => {
  const accountId = await repository.upsertAccount("disabled@example.com", NOW);
  await repository.createSession(accountId, NOW, NOW + 100_000, "session-disabled");

  assert.equal(await repository.disableAccount("disabled@example.com", NOW + 1_000), "disabled");
  assert.equal(await repository.getSession("session-disabled", NOW + 2_000), null);
  await assert.rejects(() => repository.upsertAccount("disabled@example.com", NOW + 3_000), /已停用/);
  assert.equal(await repository.disableAccount("disabled@example.com", NOW + 4_000), "already-disabled");
  assert.equal(await repository.disableAccount("missing@example.com", NOW + 4_000), "missing");
});

test("the database refuses a second owner for the same circle", async () => {
  const owner = await repository.upsertAccount("owner@example.com", NOW);
  const rival = await repository.upsertAccount("rival@example.com", NOW);
  const claim = (id, accountId) => repository.createClaim({
    id, accountId, eventId: "ff47", circleId: "ff47-contested",
    circleNameKey: "contested", circleNameAtClaim: "Contested", sourceRowAtClaim: 5,
    status: "pending", method: null, targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null,
    evidenceUrl: null, evidenceNote: null, now: NOW,
  });

  await claim("claim-owner", owner);
  await claim("claim-rival", rival);

  assert.equal(await repository.markClaimVerified("claim-owner", "admin", NOW + 1_000, "admin@example.com"), true);
  // The partial unique index is the real guard; application code cannot race it.
  assert.equal(await repository.markClaimVerified("claim-rival", "admin", NOW + 2_000, "admin@example.com"), false);

  assert.equal(await repository.ownsCircle(owner, "ff47", "ff47-contested"), true);
  assert.equal(await repository.ownsCircle(rival, "ff47", "ff47-contested"), false);
  assert.equal(await repository.hasVerifiedClaim("ff47", "ff47-contested"), true);
});

test("revoking an owner frees the circle for a new claim", async () => {
  const rival = await repository.upsertAccount("rival@example.com", NOW);
  await repository.setClaimStatus("claim-owner", "revoked", NOW + 3_000, "admin@example.com");
  assert.equal(await repository.markClaimVerified("claim-rival", "admin", NOW + 4_000, "admin@example.com"), true);
  assert.equal(await repository.ownsCircle(rival, "ff47", "ff47-contested"), true);
});

/**
 * Content only ever reaches a row through an owner, so a fixture that publishes
 * without one is not a shorter version of reality — it is a different one.
 */
const verifiedOwner = async (circleId, label) => {
  const accountId = await repository.upsertAccount(`${label}@example.com`, NOW);
  await repository.createClaim({
    id: `claim-${label}`, accountId, eventId: "ff47", circleId,
    circleNameKey: label, circleNameAtClaim: label, sourceRowAtClaim: 1,
    status: "verified", method: "admin", targetUrl: null,
    challengeTokenHash: null, challengeExpiresAt: null,
    evidenceUrl: null, evidenceNote: null, now: NOW,
  });
  return accountId;
};

test("only a withdrawn claim can be resubmitted over", async () => {
  const accountId = await repository.upsertAccount("resubmit@example.com", NOW);
  const submit = (id, status, now) => repository.createClaim({
    id, accountId, eventId: "ff47", circleId: "ff47-resubmit",
    circleNameKey: "resubmit", circleNameAtClaim: "Resubmit", sourceRowAtClaim: 3,
    status, method: null, targetUrl: null, challengeTokenHash: `hash-${id}`,
    challengeExpiresAt: now + 1_000, evidenceUrl: null, evidenceNote: null, now,
  });

  const first = await submit("claim-resubmit-1", "pending", NOW);
  assert.equal(first, "claim-resubmit-1");
  assert.equal(await submit("claim-resubmit-2", "pending", NOW + 1_000), null,
    "a pending claim must not be silently replaced by a second submission");

  assert.equal(await repository.withdrawClaim("claim-resubmit-1", accountId), true);
  const withdrawn = await repository.getClaim("claim-resubmit-1");
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.challenge_token_hash, null, "the old code must not stay verifiable");

  // The row is reused, so the id — and every audit entry pointing at it — holds.
  assert.equal(await submit("claim-resubmit-3", "pending", NOW + 2_000), "claim-resubmit-1");
  const reused = await repository.getClaim("claim-resubmit-1");
  assert.equal(reused.status, "pending");
  assert.equal(reused.challenge_token_hash, "hash-claim-resubmit-3");
  assert.equal(reused.created_at, NOW + 2_000, "a resubmission counts against the daily window as a fresh claim");

  assert.equal(await repository.withdrawClaim("claim-resubmit-1", "someone-else"), false);
});

test("the published document is a valid overrides payload and grows a revision per write", async () => {
  await verifiedOwner("ff47-doc", "doc-owner");
  await repository.putOverride({ eventId: "ff47", circleId: "ff47-doc", fieldsJson: JSON.stringify({ saleInfo: "新刊 300 元" }), updatedBy: "account-1", now: NOW });
  const first = await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW);

  const parsed = parseCircleOverridesPayload(JSON.parse(first.json));
  assert.ok(parsed, "the generated document must satisfy the reader's guard");
  assert.equal(parsed.overrides.length, 1);
  assert.equal(parsed.overrides[0].circleId, "ff47-doc");
  assert.equal(parsed.overrides[0].fields.saleInfo, "新刊 300 元");

  await repository.putOverride({ eventId: "ff47", circleId: "ff47-doc", fieldsJson: JSON.stringify({ saleInfo: "改價 250 元" }), updatedBy: "account-1", now: NOW + 1_000 });
  const second = await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW + 1_000);
  assert.equal(second.revision, first.revision + 1, "revision must advance so the ETag changes");

  const stored = await repository.getOverride("ff47", "ff47-doc");
  assert.equal(stored.revision, 2);
  assert.equal(JSON.parse(stored.previous_fields_json).saleInfo, "新刊 300 元", "one level of undo is retained");
});

test("a takedown removes the entry from the published document immediately", async () => {
  assert.equal(await repository.takedownOverride({ eventId: "ff47", circleId: "ff47-doc", reason: "冒名", by: "admin@example.com", now: NOW + 2_000 }), true);
  const doc = await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW + 2_000);
  assert.deepEqual(JSON.parse(doc.json).overrides, [], "taken-down content must not be served at all");

  assert.equal(await repository.takedownOverride({ eventId: "ff47", circleId: "ff47-doc", reason: "again", by: "admin@example.com", now: NOW + 3_000 }), false);
});

test("a later edit republishes after a takedown", async () => {
  await repository.putOverride({ eventId: "ff47", circleId: "ff47-doc", fieldsJson: JSON.stringify({ saleInfo: "重新填寫" }), updatedBy: "account-1", now: NOW + 4_000 });
  const doc = await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW + 4_000);
  assert.equal(JSON.parse(doc.json).overrides.length, 1);
});

test("revoking the claim withdraws that circle's content from the published document", async () => {
  const owner = await verifiedOwner("ff47-revoked", "revoked-owner");
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-revoked", fieldsJson: JSON.stringify({ saleInfo: "由錯誤的人填寫" }),
    updatedBy: owner, now: NOW,
  });
  const published = async () => JSON.parse(
    (await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW + 1_000)).json,
  ).overrides.map((override) => override.circleId);
  assert.ok((await published()).includes("ff47-revoked"), "a verified owner's content is public");

  assert.equal(await repository.setClaimStatus("claim-revoked-owner", "revoked", NOW + 2_000, "admin@example.com"), true);

  assert.ok(
    !(await published()).includes("ff47-revoked"),
    "revoking ownership must withdraw the content without a second takedown step",
  );
  assert.equal(await repository.ownsCircle(owner, "ff47", "ff47-revoked"), false, "the former owner cannot write again");

  // Withdrawing the projection is not a delete: the row and its history stay so
  // the audit trail and one level of undo survive an ownership correction.
  const stored = await repository.getOverride("ff47", "ff47-revoked");
  assert.equal(stored.status, "live", "the row is untouched; only the projection dropped it");
  assert.equal(JSON.parse(stored.fields_json).saleInfo, "由錯誤的人填寫");

  // The point of revoking is to let the right circle take over.
  const rightful = await repository.upsertAccount("rightful@example.com", NOW + 3_000);
  await repository.createClaim({
    id: "claim-rightful", accountId: rightful, eventId: "ff47", circleId: "ff47-revoked",
    circleNameKey: "revoked", circleNameAtClaim: "Revoked", sourceRowAtClaim: 1,
    status: "pending", method: null, targetUrl: null, challengeTokenHash: null,
    challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now: NOW + 3_000,
  });
  assert.equal(await repository.markClaimVerified("claim-rightful", "admin", NOW + 4_000, "admin@example.com"), true);
  assert.ok((await published()).includes("ff47-revoked"), "the new owner's circle publishes through the normal path");
});

test("a content-only save leaves the circle's retention choice alone", async () => {
  const row = () => database.prepare("SELECT retention_choice, retention_expires_at FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2")
    .bind("ff47", "ff47-retention").first();

  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-retention", fieldsJson: JSON.stringify({ saleInfo: "初次填寫" }),
    updatedBy: "account-1", now: NOW,
  });
  assert.deepEqual(await row(), { retention_choice: null, retention_expires_at: null }, "no answer must not be stored as one");

  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-retention", fieldsJson: JSON.stringify({ saleInfo: "選了清除" }),
    updatedBy: "account-1", now: NOW + 1_000, retention: { choice: "purge", expiresAt: NOW + 90_000 },
  });
  assert.deepEqual(await row(), { retention_choice: "purge", retention_expires_at: NOW + 90_000 });

  // The editor can save content without re-answering; that must not silently
  // revert a choice the circle already made.
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-retention", fieldsJson: JSON.stringify({ saleInfo: "只改內容" }),
    updatedBy: "account-1", now: NOW + 2_000,
  });
  assert.deepEqual(await row(), { retention_choice: "purge", retention_expires_at: NOW + 90_000 });

  // Switching back to keep clears the deadline rather than leaving a stale one.
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-retention", fieldsJson: JSON.stringify({ saleInfo: "改回保留" }),
    updatedBy: "account-1", now: NOW + 3_000, retention: { choice: "keep", expiresAt: null },
  });
  assert.deepEqual(await row(), { retention_choice: "keep", retention_expires_at: null });
});

test("a row waiting to be purged is still published", async () => {
  await verifiedOwner("ff47-waiting", "waiting-owner");
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-waiting", fieldsJson: JSON.stringify({ saleInfo: "會在 90 天後消失" }),
    updatedBy: "account-1", now: NOW + 4_000, retention: { choice: "purge", expiresAt: NOW + 90_000 },
  });
  const doc = await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW + 4_000);
  const published = JSON.parse(doc.json).overrides.map((override) => override.circleId);
  assert.ok(published.includes("ff47-waiting"), "the deadline is a lifespan, not an early withdrawal (ADR-0018)");
});

test("audit rows are written and retrievable by subject", async () => {
  await repository.writeAudit({ at: NOW, actorRole: "admin", action: "claim.admin_approved", subjectType: "claim", subjectId: "claim-owner", detail: { method: "admin" }, ipHash: "ip" });
  const rows = await database.prepare("SELECT * FROM audit_log WHERE subject_id = ?1").bind("claim-owner").all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].action, "claim.admin_approved");
  assert.equal(JSON.parse(rows.results[0].detail_json).method, "admin");
});

test("account deletion releases claims, removes owned overlays and shreds personal audit fields", async () => {
  const email = "delete-account@example.com";
  const accountId = await repository.upsertAccount(email, NOW);
  await repository.createSession(accountId, NOW, NOW + 100_000, "delete-account-session");
  await repository.createLoginToken({ tokenHash: "delete-account-token", email, now: NOW, expiresAt: NOW + 100_000, ipHash: "ip-delete" });
  await repository.createClaim({
    id: "delete-account-claim", accountId, eventId: "ff47", circleId: "ff47-delete-account",
    circleNameKey: "delete", circleNameAtClaim: "Delete", sourceRowAtClaim: 1,
    status: "verified", method: "admin", targetUrl: "https://personal.example/", challengeTokenHash: null,
    challengeExpiresAt: null, evidenceUrl: "https://personal.example/evidence", evidenceNote: "personal note", now: NOW,
  });
  await repository.putOverride({
    eventId: "ff47", circleId: "ff47-delete-account", fieldsJson: JSON.stringify({ saleInfo: "personal content" }),
    updatedBy: accountId, now: NOW,
  });
  await repository.rebuildOverridesDoc("ff47", "2026-08-13T00:00:00.000Z", NOW);
  const emailAuditDigest = "keyed-email-digest";
  await repository.writeAudit({
    at: NOW, actorAccountId: accountId, actorRole: "circle", action: "claim.created",
    subjectType: "email", subjectId: emailAuditDigest, detail: { evidenceUrl: "https://personal.example/evidence" }, ipHash: "ip-delete",
  });

  assert.equal(await repository.beginAccountDeletion({
    accountId, email, now: NOW + 4_000, retrySessionId: "delete-account-session",
  }), true);
  assert.equal(await repository.getSession("delete-account-session", NOW + 4_001), null, "normal routes reject a deleting account");
  assert.equal((await repository.getSession("delete-account-session", NOW + 4_001, true))?.accountId, accountId,
    "only the deletion route may retain its retry session");
  assert.equal(await repository.deleteAccount({ accountId, email, emailAuditDigest, legacyEmailAuditDigest: "legacy-email-digest", now: NOW + 5_000 }), true);
  for (const table of ["accounts", "sessions", "login_tokens", "circle_claims", "circle_overrides"]) {
    assert.equal((await database.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${table === "accounts" ? "id" : table === "sessions" || table === "circle_claims" ? "account_id" : table === "login_tokens" ? "email" : "circle_id"} = ?1`).bind(
      table === "login_tokens" ? email : table === "circle_overrides" ? "ff47-delete-account" : accountId,
    ).first()).total, 0, `${table} must not retain the account`);
  }
  assert.equal(JSON.parse((await repository.getOverridesDoc("ff47")).json).overrides.some((item) => item.circleId === "ff47-delete-account"), false);

  const shredded = await database.prepare(`SELECT * FROM audit_log WHERE action = 'claim.created' AND shredded_at IS NOT NULL`).first();
  assert.equal(shredded.actor_account_id, null);
  assert.equal(shredded.subject_id, "[shredded]");
  assert.equal(shredded.detail_json, null);
  assert.equal(shredded.ip_hash, null);
  assert.equal((await database.prepare(`SELECT COUNT(*) AS total FROM audit_log WHERE action = 'account.deleted' AND shredded_at IS NOT NULL`).first()).total, 1);

  const successor = await repository.upsertAccount("successor@example.com", NOW + 6_000);
  await repository.createClaim({
    id: "successor-claim", accountId: successor, eventId: "ff47", circleId: "ff47-delete-account",
    circleNameKey: "delete", circleNameAtClaim: "Delete", sourceRowAtClaim: 1,
    status: "verified", method: "admin", targetUrl: null, challengeTokenHash: null,
    challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now: NOW + 6_000,
  });
  assert.equal(await repository.ownsCircle(successor, "ff47", "ff47-delete-account"), true, "deletion must release the one-owner slot");
});

test("a deletion tombstone blocks in-flight circle writes and strips late audit identity", async () => {
  const email = "delete-race@example.com";
  const accountId = await repository.upsertAccount(email, NOW);
  await repository.createSession(accountId, NOW, NOW + 100_000, "delete-race-session");
  await repository.createClaim({
    id: "delete-race-owner", accountId, eventId: "ff47", circleId: "ff47-delete-race",
    circleNameKey: "race", circleNameAtClaim: "Race", sourceRowAtClaim: 1,
    status: "verified", method: "admin", targetUrl: null, challengeTokenHash: null,
    challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now: NOW,
  });

  assert.equal(await repository.beginAccountDeletion({
    accountId, email, now: NOW + 1, retrySessionId: "delete-race-session",
  }), true);
  assert.equal(await repository.disableAccount(email, NOW + 2), "deleting",
    "an admin disable must not revoke the only session that can retry failed R2 cleanup");
  assert.equal((await repository.getSession("delete-race-session", NOW + 3, true))?.accountId, accountId);
  assert.equal(await repository.ownsCircle(accountId, "ff47", "ff47-delete-race"), false);
  assert.equal(await repository.createClaim({
    id: "delete-race-late-claim", accountId, eventId: "ff47", circleId: "ff47-delete-race-late",
    circleNameKey: "late", circleNameAtClaim: "Late", sourceRowAtClaim: 2,
    status: "pending", method: null, targetUrl: null, challengeTokenHash: null,
    challengeExpiresAt: null, evidenceUrl: null, evidenceNote: null, now: NOW + 2,
  }), null);
  assert.equal(await repository.putOverride({
    accountId, eventId: "ff47", circleId: "ff47-delete-race",
    fieldsJson: JSON.stringify({ saleInfo: "must not survive" }), updatedBy: accountId, now: NOW + 2,
  }), false);
  assert.equal(await repository.getOverride("ff47", "ff47-delete-race"), null);

  await repository.writeAudit({
    at: NOW + 2, actorAccountId: accountId, actorRole: "circle", action: "override.late",
    subjectType: "override", subjectId: "ff47-delete-race", detail: { text: "must be shredded" }, ipHash: "late-ip",
  });
  assert.deepEqual(
    await database.prepare("SELECT actor_account_id, detail_json, ip_hash, shredded_at FROM audit_log WHERE action = 'override.late'").first(),
    { actor_account_id: null, detail_json: null, ip_hash: null, shredded_at: NOW + 2 },
  );
});

test("an admin disable wins atomically over a later deletion start", async () => {
  const email = "disable-before-delete@example.com";
  const accountId = await repository.upsertAccount(email, NOW);
  await repository.createSession(accountId, NOW, NOW + 100_000, "disable-before-delete-session");

  assert.equal(await repository.disableAccount(email, NOW + 1), "disabled");
  assert.equal(await repository.beginAccountDeletion({
    accountId, email, now: NOW + 2, retrySessionId: "disable-before-delete-session",
  }), false);
  assert.deepEqual(
    await database.prepare("SELECT disabled_at, deletion_started_at FROM accounts WHERE id = ?1").bind(accountId).first(),
    { disabled_at: NOW + 1, deletion_started_at: null },
  );
  assert.equal(await repository.getSession("disable-before-delete-session", NOW + 3, true), null);
});

test("no raw login token is recoverable from the database", async () => {
  const rows = await database.prepare("SELECT * FROM login_tokens").all();
  assert.ok(rows.results.length > 0);
  for (const row of rows.results) {
    assert.equal(Object.keys(row).includes("token"), false, "only the hash may be stored");
  }
});

test("preview mail is captured in D1 and disposable data can be reset without deleting admins", async () => {
  await repository.storePreviewMail({ email: "preview-admin@example.test", subject: "login", text: "secret link", now: NOW + 20_000 });
  assert.equal((await repository.latestPreviewMail("preview-admin@example.test"))?.text, "secret link");
  await repository.upsertAccount("disposable@example.test", NOW + 20_000);
  await repository.addAdmin("preview-admin@example.test", "bootstrap", NOW + 20_000);
  await repository.writeAudit({ at: NOW + 20_000, actorRole: "system", action: "preview.fixture", subjectType: "preview", subjectId: "fixture" });

  await repository.clearPreviewData();
  assert.equal(await repository.latestPreviewMail("preview-admin@example.test"), null);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM accounts").first()).total, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM audit_log").first()).total, 0);
  assert.equal(await repository.isAdminEmail("preview-admin@example.test"), true);
});
