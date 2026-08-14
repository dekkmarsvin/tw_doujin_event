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
  for (const [tableName, missingColumn] of [["circle_overrides", "post_event_hidden"], ["overrides_doc", "phase"]]) {
    const definition = IDENTITY_TABLES.find((table) => table.name === tableName);
    assert.ok(definition);
    const oldColumns = definition.columns.filter((column) => !column.startsWith(`${missingColumn} `));
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

test("the published document is a valid overrides payload and grows a revision per write", async () => {
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

test("audit rows are written and retrievable by subject", async () => {
  await repository.writeAudit({ at: NOW, actorRole: "admin", action: "claim.admin_approved", subjectType: "claim", subjectId: "claim-owner", detail: { method: "admin" }, ipHash: "ip" });
  const rows = await database.prepare("SELECT * FROM audit_log WHERE subject_id = ?1").bind("claim-owner").all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].action, "claim.admin_approved");
  assert.equal(JSON.parse(rows.results[0].detail_json).method, "admin");
});

test("no raw login token is recoverable from the database", async () => {
  const rows = await database.prepare("SELECT * FROM login_tokens").all();
  assert.ok(rows.results.length > 0);
  for (const row of rows.results) {
    assert.equal(Object.keys(row).includes("token"), false, "only the hash may be stored");
  }
});
