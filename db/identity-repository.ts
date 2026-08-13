import { CIRCLE_OVERRIDES_SCHEMA } from "../app/circle-overrides";

/**
 * Identity, claims and circle-authored overrides.
 *
 * Deliberately raw prepared statements rather than the query builder used by
 * `event-map-repository.ts`: the security-load-bearing operations here are
 * conditional writes checked through `meta.changes` (single-use tokens, one
 * verified owner per circle), and those read far more clearly as SQL.
 *
 * Schema of record lives in `db/identity-schema.ts` for `npm run db:generate`.
 */

export type ClaimStatus = "pending" | "verified" | "rejected" | "revoked";
export type ClaimMethod = "email_domain" | "link_token" | "admin";

export type SessionAccount = { accountId: string; email: string; sessionCreatedAt: number };

export type ClaimRow = {
  id: string;
  account_id: string;
  event_id: string;
  circle_id: string;
  circle_name_at_claim: string;
  status: ClaimStatus;
  method: ClaimMethod | null;
  target_url: string | null;
  challenge_token_hash: string | null;
  challenge_expires_at: number | null;
  challenge_attempts: number;
  evidence_url: string | null;
  evidence_note: string | null;
  created_at: number;
  verified_at: number | null;
};

export type OverrideRow = {
  circle_id: string;
  fields_json: string;
  status: string;
  updated_at: number;
};

const TABLES = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER,
    disabled_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_idx ON accounts(email)`,
  `CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY NOT NULL,
    added_by TEXT,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    request_ip_hash TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS login_tokens_hash_idx ON login_tokens(token_hash)`,
  `CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens(email, created_at)`,
  `CREATE INDEX IF NOT EXISTS login_tokens_ip_idx ON login_tokens(request_ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS login_tokens_expiry_idx ON login_tokens(expires_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS circle_claims (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    circle_id TEXT NOT NULL,
    circle_name_key TEXT NOT NULL,
    circle_name_at_claim TEXT NOT NULL,
    source_row_at_claim INTEGER,
    status TEXT NOT NULL,
    method TEXT,
    target_url TEXT,
    challenge_token_hash TEXT,
    challenge_expires_at INTEGER,
    challenge_attempts INTEGER NOT NULL DEFAULT 0,
    evidence_url TEXT,
    evidence_note TEXT,
    created_at INTEGER NOT NULL,
    verified_at INTEGER,
    reviewed_by TEXT,
    reviewed_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS circle_claims_account_circle_idx ON circle_claims(event_id, circle_id, account_id)`,
  // The invariant that matters: at most one owner per circle, enforced by the
  // database rather than by application code that could be raced.
  `CREATE UNIQUE INDEX IF NOT EXISTS circle_claims_one_owner_idx ON circle_claims(event_id, circle_id) WHERE status = 'verified'`,
  `CREATE INDEX IF NOT EXISTS circle_claims_status_idx ON circle_claims(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS circle_claims_account_idx ON circle_claims(account_id)`,
  `CREATE TABLE IF NOT EXISTS circle_overrides (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL,
    circle_id TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    previous_fields_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'live',
    updated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    takedown_reason TEXT,
    takendown_by TEXT,
    takendown_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS circle_overrides_key_idx ON circle_overrides(event_id, circle_id)`,
  `CREATE INDEX IF NOT EXISTS circle_overrides_live_idx ON circle_overrides(event_id, status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS overrides_doc (
    event_id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    at INTEGER NOT NULL,
    actor_account_id TEXT,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    detail_json TEXT,
    ip_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at)`,
  `CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_log(subject_type, subject_id, at)`,
];

export function createIdentityRepository(database: D1Database, options: { bootstrapAdmins?: string[] } = {}) {
  let tablesReady: Promise<void> | null = null;

  async function ensureTables() {
    if (!tablesReady) {
      tablesReady = database.batch(TABLES.map((statement) => database.prepare(statement)))
        .then(() => seedAdmins())
        .catch((error: unknown) => {
          tablesReady = null;
          throw error;
        });
    }
    return tablesReady;
  }

  /**
   * Seed only while the roster is empty. That makes `ADMIN_EMAILS` the
   * bootstrap for a fresh database and the recovery path if every admin is
   * somehow removed, without resurrecting anyone who was deliberately deleted
   * — the last-admin guard keeps the table from legitimately reaching zero.
   */
  async function seedAdmins() {
    const seeds = (options.bootstrapAdmins ?? []).filter(Boolean);
    if (seeds.length === 0) return;
    const existing = await database.prepare("SELECT COUNT(*) AS total FROM admins").first<{ total: number }>();
    if ((existing?.total ?? 0) > 0) return;
    const now = Date.now();
    await database.batch(seeds.map((email) => database
      .prepare("INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?1, 'bootstrap', ?2)")
      .bind(email, now)));
  }

  async function listAdmins() {
    await ensureTables();
    const result = await database.prepare("SELECT email, added_by, added_at FROM admins ORDER BY added_at ASC")
      .all<{ email: string; added_by: string | null; added_at: number }>();
    return result.results;
  }

  async function isAdminEmail(email: string) {
    await ensureTables();
    const row = await database.prepare("SELECT email FROM admins WHERE email = ?1").bind(email).first<{ email: string }>();
    return !!row;
  }

  async function addAdmin(email: string, addedBy: string, now: number) {
    await ensureTables();
    const result = await database
      .prepare("INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?1, ?2, ?3)")
      .bind(email, addedBy, now).run();
    return result.meta.changes === 1;
  }

  /** Refuses the final row, so the roster can never be emptied into a lockout. */
  async function removeAdmin(email: string) {
    await ensureTables();
    const total = await database.prepare("SELECT COUNT(*) AS total FROM admins").first<{ total: number }>();
    if ((total?.total ?? 0) <= 1) return "last" as const;
    const result = await database.prepare("DELETE FROM admins WHERE email = ?1").bind(email).run();
    return result.meta.changes === 1 ? "removed" as const : "missing" as const;
  }

  async function writeAudit(entry: {
    at: number;
    actorAccountId?: string | null;
    actorRole: "circle" | "admin" | "system";
    action: string;
    subjectType: string;
    subjectId: string;
    detail?: unknown;
    ipHash?: string | null;
  }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      crypto.randomUUID(), entry.at, entry.actorAccountId ?? null, entry.actorRole,
      entry.action, entry.subjectType, entry.subjectId,
      entry.detail === undefined ? null : JSON.stringify(entry.detail), entry.ipHash ?? null,
    ).run();
  }

  async function countLoginTokensSince(column: "email" | "request_ip_hash", value: string, since: number) {
    await ensureTables();
    const row = await database.prepare(
      `SELECT COUNT(*) AS total FROM login_tokens WHERE ${column} = ?1 AND created_at >= ?2`,
    ).bind(value, since).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async function createLoginToken(input: { tokenHash: string; email: string; now: number; expiresAt: number; ipHash: string | null }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO login_tokens (id, token_hash, email, created_at, expires_at, request_ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(crypto.randomUUID(), input.tokenHash, input.email, input.now, input.expiresAt, input.ipHash).run();
  }

  /**
   * Single-use, enforced by the write itself. A read-then-write would let two
   * concurrent clicks on the same emailed link both succeed.
   */
  async function consumeLoginToken(tokenHash: string, now: number): Promise<string | null> {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE login_tokens SET consumed_at = ?1
       WHERE token_hash = ?2 AND consumed_at IS NULL AND expires_at > ?1`,
    ).bind(now, tokenHash).run();
    if (result.meta.changes !== 1) return null;

    const row = await database.prepare(`SELECT email FROM login_tokens WHERE token_hash = ?1`)
      .bind(tokenHash).first<{ email: string }>();
    if (!row) return null;

    // A consumed link retires every other outstanding link for that inbox.
    await database.prepare(
      `UPDATE login_tokens SET consumed_at = ?1 WHERE email = ?2 AND consumed_at IS NULL`,
    ).bind(now, row.email).run();
    return row.email;
  }

  async function upsertAccount(email: string, now: number): Promise<string> {
    await ensureTables();
    const existing = await database.prepare(`SELECT id, disabled_at FROM accounts WHERE email = ?1`)
      .bind(email).first<{ id: string; disabled_at: number | null }>();
    if (existing) {
      if (existing.disabled_at !== null) throw new Error("此帳號已停用。");
      await database.prepare(`UPDATE accounts SET last_login_at = ?1 WHERE id = ?2`).bind(now, existing.id).run();
      return existing.id;
    }
    const id = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)`,
    ).bind(id, email, now).run();
    return id;
  }

  async function createSession(accountId: string, now: number, expiresAt: number, id: string) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?3)`,
    ).bind(id, accountId, now, expiresAt).run();
  }

  async function getSession(sessionId: string, now: number): Promise<SessionAccount | null> {
    await ensureTables();
    const row = await database.prepare(
      `SELECT s.account_id, s.created_at, a.email FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.id = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND a.disabled_at IS NULL`,
    ).bind(sessionId, now).first<{ account_id: string; created_at: number; email: string }>();
    if (!row) return null;
    await database.prepare(`UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2`).bind(now, sessionId).run();
    return { accountId: row.account_id, email: row.email, sessionCreatedAt: row.created_at };
  }

  async function revokeSession(sessionId: string, now: number) {
    await ensureTables();
    await database.prepare(`UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL`)
      .bind(now, sessionId).run();
  }

  async function createClaim(input: {
    id: string; accountId: string; eventId: string; circleId: string;
    circleNameKey: string; circleNameAtClaim: string; sourceRowAtClaim: number | null;
    status: ClaimStatus; method: ClaimMethod | null; targetUrl: string | null;
    challengeTokenHash: string | null; challengeExpiresAt: number | null;
    evidenceUrl: string | null; evidenceNote: string | null; now: number;
  }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO circle_claims (
         id, account_id, event_id, circle_id, circle_name_key, circle_name_at_claim, source_row_at_claim,
         status, method, target_url, challenge_token_hash, challenge_expires_at,
         evidence_url, evidence_note, created_at, verified_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).bind(
      input.id, input.accountId, input.eventId, input.circleId, input.circleNameKey,
      input.circleNameAtClaim, input.sourceRowAtClaim, input.status, input.method, input.targetUrl,
      input.challengeTokenHash, input.challengeExpiresAt, input.evidenceUrl, input.evidenceNote,
      input.now, input.status === "verified" ? input.now : null,
    ).run();
  }

  async function getClaim(id: string) {
    await ensureTables();
    return database.prepare(`SELECT * FROM circle_claims WHERE id = ?1`).bind(id).first<ClaimRow>();
  }

  async function listClaimsForAccount(accountId: string, eventId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT * FROM circle_claims WHERE account_id = ?1 AND event_id = ?2 ORDER BY created_at DESC`,
    ).bind(accountId, eventId).all<ClaimRow>();
    return result.results;
  }

  async function listClaimsByStatus(eventId: string, status: ClaimStatus, limit = 100) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT * FROM circle_claims WHERE event_id = ?1 AND status = ?2 ORDER BY created_at ASC LIMIT ?3`,
    ).bind(eventId, status, limit).all<ClaimRow>();
    return result.results;
  }

  async function hasVerifiedClaim(eventId: string, circleId: string) {
    await ensureTables();
    const row = await database.prepare(
      `SELECT id FROM circle_claims WHERE event_id = ?1 AND circle_id = ?2 AND status = 'verified'`,
    ).bind(eventId, circleId).first<{ id: string }>();
    return !!row;
  }

  async function ownsCircle(accountId: string, eventId: string, circleId: string) {
    await ensureTables();
    const row = await database.prepare(
      `SELECT id FROM circle_claims
       WHERE account_id = ?1 AND event_id = ?2 AND circle_id = ?3 AND status = 'verified'`,
    ).bind(accountId, eventId, circleId).first<{ id: string }>();
    return !!row;
  }

  /** Verification races the partial unique index; a loser is reported, not crashed. */
  async function markClaimVerified(id: string, method: ClaimMethod, now: number, reviewedBy: string | null) {
    await ensureTables();
    try {
      const result = await database.prepare(
        `UPDATE circle_claims SET status = 'verified', method = ?1, verified_at = ?2, reviewed_by = ?3, reviewed_at = ?2
         WHERE id = ?4 AND status = 'pending'`,
      ).bind(method, now, reviewedBy, id).run();
      return result.meta.changes === 1;
    } catch {
      return false;
    }
  }

  async function setClaimStatus(id: string, status: ClaimStatus, now: number, reviewedBy: string | null) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE circle_claims SET status = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4`,
    ).bind(status, reviewedBy, now, id).run();
    return result.meta.changes === 1;
  }

  async function recordChallengeAttempt(id: string) {
    await ensureTables();
    await database.prepare(`UPDATE circle_claims SET challenge_attempts = challenge_attempts + 1 WHERE id = ?1`)
      .bind(id).run();
  }

  async function getOverride(eventId: string, circleId: string) {
    await ensureTables();
    return database.prepare(`SELECT * FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2`)
      .bind(eventId, circleId).first<OverrideRow & { fields_json: string; revision: number }>();
  }

  async function putOverride(input: { eventId: string; circleId: string; fieldsJson: string; updatedBy: string; now: number }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO circle_overrides (id, event_id, circle_id, fields_json, updated_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(event_id, circle_id) DO UPDATE SET
         previous_fields_json = circle_overrides.fields_json,
         fields_json = excluded.fields_json,
         revision = circle_overrides.revision + 1,
         status = 'live',
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         takedown_reason = NULL, takendown_by = NULL, takendown_at = NULL`,
    ).bind(crypto.randomUUID(), input.eventId, input.circleId, input.fieldsJson, input.updatedBy, input.now).run();
  }

  async function takedownOverride(input: { eventId: string; circleId: string; reason: string; by: string; now: number }) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE circle_overrides SET status = 'takendown', takedown_reason = ?1, takendown_by = ?2, takendown_at = ?3
       WHERE event_id = ?4 AND circle_id = ?5 AND status = 'live'`,
    ).bind(input.reason, input.by, input.now, input.eventId, input.circleId).run();
    return result.meta.changes === 1;
  }

  async function listLiveOverrides(eventId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT circle_id, fields_json, status, updated_at FROM circle_overrides
       WHERE event_id = ?1 AND status = 'live' ORDER BY circle_id ASC`,
    ).bind(eventId).all<OverrideRow>();
    return result.results;
  }

  /**
   * Re-serialize the public document on every write. At the expected scale this
   * is trivial, and it turns each edge-cache miss into a single row read
   * instead of a scan — which is what keeps venue traffic inside the D1 quota.
   */
  async function rebuildOverridesDoc(eventId: string, generatedAt: string, now: number) {
    const rows = await listLiveOverrides(eventId);
    const overrides = rows.map((row) => ({
      circleId: row.circle_id,
      updatedAt: new Date(row.updated_at).toISOString(),
      fields: JSON.parse(row.fields_json) as unknown,
    }));
    const current = await database.prepare(`SELECT revision FROM overrides_doc WHERE event_id = ?1`)
      .bind(eventId).first<{ revision: number }>();
    const revision = (current?.revision ?? 0) + 1;
    const json = JSON.stringify({
      schema: CIRCLE_OVERRIDES_SCHEMA,
      eventId,
      generatedAt,
      revision,
      overrides,
    });
    await database.prepare(
      `INSERT INTO overrides_doc (event_id, revision, json, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(event_id) DO UPDATE SET revision = excluded.revision, json = excluded.json, updated_at = excluded.updated_at`,
    ).bind(eventId, revision, json, now).run();
    return { revision, json };
  }

  async function getOverridesDoc(eventId: string) {
    await ensureTables();
    return database.prepare(`SELECT revision, json, updated_at FROM overrides_doc WHERE event_id = ?1`)
      .bind(eventId).first<{ revision: number; json: string; updated_at: number }>();
  }

  return {
    ensureTables, writeAudit,
    listAdmins, isAdminEmail, addAdmin, removeAdmin,
    countLoginTokensSince, createLoginToken, consumeLoginToken,
    upsertAccount, createSession, getSession, revokeSession,
    createClaim, getClaim, listClaimsForAccount, listClaimsByStatus,
    hasVerifiedClaim, ownsCircle, markClaimVerified, setClaimStatus, recordChallengeAttempt,
    getOverride, putOverride, takedownOverride, listLiveOverrides,
    rebuildOverridesDoc, getOverridesDoc,
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
