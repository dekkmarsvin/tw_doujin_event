import { CIRCLE_OVERRIDES_SCHEMA, type CircleRetentionChoice } from "../app/circle-overrides";
import { IDENTITY_COLUMN_MIGRATIONS, IDENTITY_SCHEMA_STATEMENTS } from "./identity-runtime-schema";

/**
 * Identity, claims and circle-authored overrides.
 *
 * Deliberately raw prepared statements rather than the query builder used by
 * `event-map-repository.ts`: the security-load-bearing operations here are
 * conditional writes checked through `meta.changes` (single-use tokens, one
 * verified owner per circle), and those read far more clearly as SQL.
 *
 * Runtime schema authority lives in `db/identity-runtime-schema.ts`. Pages has
 * no migration step, so the repository consumes its generated SQL on first use.
 */

export type OverridesPhase = "during" | "after";
export type ClaimStatus = "pending" | "verified" | "rejected" | "revoked";
export type ClaimMethod = "email_domain" | "link_token" | "admin";
export type MapDraftStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected" | "exported" | "withdrawn";

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
  post_event_hidden?: number;
  /** `null` where the circle has not answered yet; never defaulted here. */
  retention_choice?: CircleRetentionChoice | null;
  retention_expires_at?: number | null;
  hosted_thumbnail_key?: string | null;
};

export function createIdentityRepository(database: D1Database, options: { bootstrapAdmins?: string[] } = {}) {
  let tablesReady: Promise<void> | null = null;

  async function ensureTables() {
    if (!tablesReady) {
      tablesReady = database.batch(IDENTITY_SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)))
        .then(() => addMissingColumns())
        .then(() => seedAdmins())
        .catch((error: unknown) => {
          tablesReady = null;
          throw error;
        });
    }
    return tablesReady;
  }

  async function addMissingColumns() {
    for (const migration of IDENTITY_COLUMN_MIGRATIONS) {
      try {
        await database.prepare(migration.sql).run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/duplicate column name/i.test(message)) throw error;
      }
    }
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
    actorRole: "circle" | "map_contributor" | "admin" | "system";
    action: string;
    subjectType: string;
    subjectId: string;
    detail?: unknown;
    ipHash?: string | null;
  }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO audit_log (
         id, at, actor_account_id, actor_role, action, subject_type, subject_id,
         detail_json, ip_hash, shredded_at
       ) SELECT ?1, ?2,
         CASE WHEN actor_allowed = 1 THEN ?3 ELSE NULL END,
         ?4, ?5, ?6, ?7,
         CASE WHEN actor_allowed = 1 THEN ?8 ELSE NULL END,
         CASE WHEN actor_allowed = 1 THEN ?9 ELSE NULL END,
         CASE WHEN actor_allowed = 1 THEN NULL ELSE ?2 END
       FROM (
         SELECT CASE WHEN ?3 IS NULL OR EXISTS (
           SELECT 1 FROM accounts WHERE id = ?3 AND deletion_started_at IS NULL
         ) THEN 1 ELSE 0 END AS actor_allowed
       )`,
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
    const existing = await database.prepare(`SELECT id, disabled_at, deletion_started_at FROM accounts WHERE email = ?1`)
      .bind(email).first<{ id: string; disabled_at: number | null; deletion_started_at: number | null }>();
    if (existing) {
      if (existing.disabled_at !== null) throw new Error("此帳號已停用。");
      if (existing.deletion_started_at !== null) throw new Error("此帳號正在刪除，請稍後再試。");
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
    const result = await database.prepare(
      `INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
       SELECT ?1, ?2, ?3, ?4, ?3 FROM accounts
       WHERE id = ?2 AND disabled_at IS NULL AND deletion_started_at IS NULL`,
    ).bind(id, accountId, now, expiresAt).run();
    if (result.meta.changes !== 1) throw new Error("此帳號目前無法建立登入狀態。");
  }

  async function getSession(sessionId: string, now: number, allowDeleting = false): Promise<SessionAccount | null> {
    await ensureTables();
    const row = await database.prepare(
      `SELECT s.account_id, s.created_at, a.email FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.id = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2
         AND a.disabled_at IS NULL AND (?3 = 1 OR a.deletion_started_at IS NULL)`,
    ).bind(sessionId, now, allowDeleting ? 1 : 0).first<{ account_id: string; created_at: number; email: string }>();
    if (!row) return null;
    await database.prepare(`UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2`).bind(now, sessionId).run();
    return { accountId: row.account_id, email: row.email, sessionCreatedAt: row.created_at };
  }

  async function revokeSession(sessionId: string, now: number) {
    await ensureTables();
    await database.prepare(`UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL`)
      .bind(now, sessionId).run();
  }

  async function disableAccount(email: string, now: number) {
    await ensureTables();
    const results = await database.batch([
      database.prepare(
        `UPDATE accounts SET disabled_at = ?1
         WHERE email = ?2 AND disabled_at IS NULL AND deletion_started_at IS NULL`,
      ).bind(now, email),
      database.prepare(
        `UPDATE sessions SET revoked_at = ?1
         WHERE account_id = (
           SELECT id FROM accounts WHERE email = ?2 AND disabled_at = ?1 AND deletion_started_at IS NULL
         ) AND revoked_at IS NULL`,
      ).bind(now, email),
    ]);
    if (results[0].meta.changes === 1) {
      return "disabled" as const;
    }
    const row = await database.prepare(`SELECT disabled_at, deletion_started_at FROM accounts WHERE email = ?1`)
      .bind(email).first<{ disabled_at: number | null; deletion_started_at: number | null }>();
    return row?.deletion_started_at !== null && row?.deletion_started_at !== undefined
      ? "deleting" as const
      : row ? "already-disabled" as const : "missing" as const;
  }

  /**
   * Delete an account and the data that still identifies its owner.
   *
   * Only overlays covered by this account's currently verified claims are
   * removed. A revoked former owner cannot delete a successor's contribution.
   * The published documents are updated in the same D1 batch as the rows so a
   * successful deletion never leaves personal content in the read model.
   */
  async function deleteAccount(input: { accountId: string; email: string; emailAuditDigest: string; legacyEmailAuditDigest: string; now: number }) {
    await ensureTables();
    const account = await database.prepare(`SELECT id FROM accounts WHERE id = ?1 AND email = ?2 AND deletion_started_at IS NOT NULL`)
      .bind(input.accountId, input.email).first<{ id: string }>();
    if (!account) return false;

    const owned = await database.prepare(
      `SELECT event_id, circle_id FROM circle_claims WHERE account_id = ?1 AND status = 'verified'`,
    ).bind(input.accountId).all<{ event_id: string; circle_id: string }>();
    const circlesByEvent = new Map<string, Set<string>>();
    for (const row of owned.results) {
      const circles = circlesByEvent.get(row.event_id) ?? new Set<string>();
      circles.add(row.circle_id);
      circlesByEvent.set(row.event_id, circles);
    }

    const statements: D1PreparedStatement[] = [];
    for (const [eventId, circleIds] of circlesByEvent) {
      for (const circleId of circleIds) {
        statements.push(database.prepare(`DELETE FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2`).bind(eventId, circleId));
      }
      const current = await database.prepare(`SELECT revision, json FROM overrides_doc WHERE event_id = ?1`)
        .bind(eventId).first<{ revision: number; json: string }>();
      if (current) {
        const document = JSON.parse(current.json) as { overrides: { circleId: string }[] };
        const overrides = document.overrides.filter((override) => !circleIds.has(override.circleId));
        if (overrides.length !== document.overrides.length) {
          const revision = current.revision + 1;
          statements.push(database.prepare(
            `UPDATE overrides_doc SET revision = ?1, json = ?2, updated_at = ?3 WHERE event_id = ?4`,
          ).bind(revision, JSON.stringify({ ...document, revision, overrides }), input.now, eventId));
        }
      }
    }

    statements.push(
      database.prepare(`DELETE FROM map_draft_exports WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft')`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_files WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft')`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_comments WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft')`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_revisions WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft')`).bind(input.accountId),
      database.prepare(`DELETE FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft'`).bind(input.accountId),
      database.prepare(`UPDATE map_drafts SET owner_account_id = '[shredded]' WHERE owner_account_id = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_draft_revisions SET created_by = NULL WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_draft_reviews SET actor_account_id = NULL WHERE actor_account_id = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_draft_comments SET author_account_id = NULL WHERE author_account_id = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_draft_files SET uploaded_by = NULL WHERE uploaded_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_draft_exports SET created_by = NULL WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE map_contributor_grants SET granted_by = '[shredded]' WHERE granted_by = ?1`).bind(input.email),
      database.prepare(`UPDATE map_contributor_grants SET revoked_by = '[shredded]' WHERE revoked_by = ?1`).bind(input.email),
      database.prepare(`UPDATE map_contributor_grants SET suspended_by = '[shredded]' WHERE suspended_by = ?1`).bind(input.email),
      database.prepare(`DELETE FROM map_contributor_grants WHERE account_id = ?1`).bind(input.accountId),
      database.prepare(`DELETE FROM login_tokens WHERE email = ?1`).bind(input.email),
      database.prepare(`DELETE FROM sessions WHERE account_id = ?1`).bind(input.accountId),
      database.prepare(`DELETE FROM circle_claims WHERE account_id = ?1`).bind(input.accountId),
      database.prepare(`UPDATE circle_claims SET reviewed_by = '[shredded]' WHERE reviewed_by = ?1`).bind(input.email),
      database.prepare(`UPDATE circle_overrides SET takendown_by = '[shredded]' WHERE takendown_by = ?1`).bind(input.email),
      database.prepare(`UPDATE admins SET added_by = '[shredded]' WHERE added_by = ?1`).bind(input.email),
      database.prepare(
        `UPDATE audit_log SET actor_account_id = NULL, detail_json = NULL, ip_hash = NULL,
           shredded_at = COALESCE(shredded_at, ?1) WHERE actor_account_id = ?2`,
      ).bind(input.now, input.accountId),
      database.prepare(
        `UPDATE audit_log SET subject_id = '[shredded]', detail_json = NULL, ip_hash = NULL,
           shredded_at = COALESCE(shredded_at, ?1)
         WHERE (subject_type = 'account' AND subject_id = ?2)
            OR (subject_type = 'email' AND subject_id IN (?3, ?4))
            OR (subject_type = 'admin' AND subject_id = ?5)`,
      ).bind(input.now, input.accountId, input.emailAuditDigest, input.legacyEmailAuditDigest, input.email),
      database.prepare(`DELETE FROM accounts WHERE id = ?1`).bind(input.accountId),
      database.prepare(
        `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash, shredded_at)
         VALUES (?1, ?2, NULL, 'system', 'account.deleted', 'account', '[shredded]', NULL, NULL, ?2)`,
      ).bind(crypto.randomUUID(), input.now),
    );
    await database.batch(statements);
    return true;
  }

  async function beginAccountDeletion(input: { accountId: string; email: string; now: number; retrySessionId?: string }) {
    await ensureTables();
    const results = await database.batch([
      database.prepare(
       `UPDATE accounts SET deletion_started_at = COALESCE(deletion_started_at, ?1)
         WHERE id = ?2 AND email = ?3 AND disabled_at IS NULL`,
      ).bind(input.now, input.accountId, input.email),
      database.prepare(
        `UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?1)
         WHERE account_id = ?2 AND (?3 IS NULL OR id != ?3)
           AND EXISTS (
             SELECT 1 FROM accounts WHERE id = ?2 AND disabled_at IS NULL AND deletion_started_at IS NOT NULL
           )`,
      ).bind(input.now, input.accountId, input.retrySessionId ?? null),
      // Removing this in the same transaction makes every in-flight map file
      // bind fail after its R2 put; the handler then removes that object.
      database.prepare(
        `DELETE FROM map_contributor_grants WHERE account_id = ?1 AND EXISTS (
           SELECT 1 FROM accounts WHERE id = ?1 AND disabled_at IS NULL AND deletion_started_at IS NOT NULL
         )`,
      ).bind(input.accountId),
    ]);
    return results[0].meta.changes === 1;
  }

  async function isAccountWritable(accountId: string) {
    await ensureTables();
    const row = await database.prepare(
      "SELECT id FROM accounts WHERE id = ?1 AND disabled_at IS NULL AND deletion_started_at IS NULL",
    ).bind(accountId).first<{ id: string }>();
    return !!row;
  }

  /** R2 must be cleared before the D1 account deletion commits. */
  async function listHostedThumbnailKeysForAccount(accountId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT DISTINCT o.hosted_thumbnail_key AS object_key
       FROM circle_overrides o
       JOIN circle_claims c ON c.event_id = o.event_id AND c.circle_id = o.circle_id
       WHERE c.account_id = ?1 AND c.status = 'verified' AND o.hosted_thumbnail_key IS NOT NULL`,
    ).bind(accountId).all<{ object_key: string }>();
    return result.results.map((row) => row.object_key);
  }

  /** Private map evidence must be deleted before an unsubmitted draft row is removed. */
  async function listUnsubmittedMapDraftObjectKeysForAccount(accountId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT f.object_key FROM map_draft_files f
       JOIN map_drafts d ON d.id = f.draft_id
       WHERE d.owner_account_id = ?1 AND d.status = 'draft' AND f.object_key IS NOT NULL`,
    ).bind(accountId).all<{ object_key: string }>();
    return result.results.map(({ object_key }) => object_key);
  }

  async function listHostedThumbnailKeys() {
    await ensureTables();
    const result = await database.prepare(
      `SELECT DISTINCT hosted_thumbnail_key AS object_key FROM circle_overrides WHERE hosted_thumbnail_key IS NOT NULL`,
    ).all<{ object_key: string }>();
    return result.results.map((row) => row.object_key);
  }

  async function createClaim(input: {
    id: string; accountId: string; eventId: string; circleId: string;
    circleNameKey: string; circleNameAtClaim: string; sourceRowAtClaim: number | null;
    status: ClaimStatus; method: ClaimMethod | null; targetUrl: string | null;
    challengeTokenHash: string | null; challengeExpiresAt: number | null;
    evidenceUrl: string | null; evidenceNote: string | null; now: number;
  }) {
    await ensureTables();
    const result = await database.prepare(
      `INSERT INTO circle_claims (
         id, account_id, event_id, circle_id, circle_name_key, circle_name_at_claim, source_row_at_claim,
         status, method, target_url, challenge_token_hash, challenge_expires_at,
         evidence_url, evidence_note, created_at, verified_at
       ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
         FROM accounts WHERE id = ?2 AND disabled_at IS NULL AND deletion_started_at IS NULL`,
    ).bind(
      input.id, input.accountId, input.eventId, input.circleId, input.circleNameKey,
      input.circleNameAtClaim, input.sourceRowAtClaim, input.status, input.method, input.targetUrl,
      input.challengeTokenHash, input.challengeExpiresAt, input.evidenceUrl, input.evidenceNote,
      input.now, input.status === "verified" ? input.now : null,
    ).run();
    return result.meta.changes === 1;
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

  /** All historical scopes matter when deleting an account: staged R2 objects
   * are keyed by event/circle even when they were never published to D1. */
  async function listClaimScopesForAccount(accountId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT DISTINCT event_id, circle_id FROM circle_claims WHERE account_id = ?1 ORDER BY event_id, circle_id`,
    ).bind(accountId).all<{ event_id: string; circle_id: string }>();
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
      `SELECT c.id FROM circle_claims c JOIN accounts a ON a.id = c.account_id
       WHERE c.account_id = ?1 AND c.event_id = ?2 AND c.circle_id = ?3 AND c.status = 'verified'
         AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL`,
    ).bind(accountId, eventId, circleId).first<{ id: string }>();
    return !!row;
  }

  /** Verification races the partial unique index; a loser is reported, not crashed. */
  async function markClaimVerified(id: string, method: ClaimMethod, now: number, reviewedBy: string | null) {
    await ensureTables();
    try {
      const result = await database.prepare(
        `UPDATE circle_claims SET status = 'verified', method = ?1, verified_at = ?2, reviewed_by = ?3, reviewed_at = ?2
         WHERE id = ?4 AND status = 'pending' AND EXISTS (
           SELECT 1 FROM accounts a WHERE a.id = circle_claims.account_id
             AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
         )`,
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
    const result = await database.prepare(
      `UPDATE circle_claims SET challenge_attempts = challenge_attempts + 1
       WHERE id = ?1 AND EXISTS (
         SELECT 1 FROM accounts a WHERE a.id = circle_claims.account_id
           AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
       )`,
    ).bind(id).run();
    return result.meta.changes === 1;
  }

  async function getOverride(eventId: string, circleId: string) {
    await ensureTables();
    return database.prepare(`SELECT * FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2`)
      .bind(eventId, circleId).first<OverrideRow & { fields_json: string; revision: number }>();
  }

  /**
   * `retention` is optional, and its absence means "unchanged" rather than
   * "none": a save that only carries content must not wipe a choice the circle
   * made earlier, so the update coalesces onto the stored value.
   */
  async function putOverride(input: {
    accountId?: string;
    eventId: string;
    circleId: string;
    fieldsJson: string;
    updatedBy: string;
    now: number;
    retention?: { choice: CircleRetentionChoice; expiresAt: number | null };
    /** Absent preserves the current object; null explicitly detaches it. */
    hostedThumbnailKey?: string | null;
  }) {
    await ensureTables();
    const changesHostedThumbnail = Object.prototype.hasOwnProperty.call(input, "hostedThumbnailKey");
    const result = await database.prepare(
      `INSERT INTO circle_overrides (id, event_id, circle_id, fields_json, updated_by, created_at, updated_at, retention_choice, retention_expires_at, hosted_thumbnail_key)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9
       WHERE ?11 IS NULL OR EXISTS (
         SELECT 1 FROM accounts a WHERE a.id = ?11
           AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
       )
       ON CONFLICT(event_id, circle_id) DO UPDATE SET
         previous_fields_json = circle_overrides.fields_json,
         fields_json = excluded.fields_json,
         revision = circle_overrides.revision + 1,
         status = 'live',
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         retention_choice = COALESCE(excluded.retention_choice, circle_overrides.retention_choice),
         retention_expires_at = CASE WHEN excluded.retention_choice IS NULL
           THEN circle_overrides.retention_expires_at ELSE excluded.retention_expires_at END,
         hosted_thumbnail_key = CASE WHEN ?10 = 1 THEN excluded.hosted_thumbnail_key ELSE circle_overrides.hosted_thumbnail_key END,
         takedown_reason = NULL, takendown_by = NULL, takendown_at = NULL`,
    ).bind(
      crypto.randomUUID(), input.eventId, input.circleId, input.fieldsJson, input.updatedBy, input.now,
      input.retention?.choice ?? null, input.retention?.expiresAt ?? null,
      input.hostedThumbnailKey ?? null, changesHostedThumbnail ? 1 : 0, input.accountId ?? null,
    ).run();
    return result.meta.changes === 1;
  }

  /**
   * Self-service deletion: the row goes, not a flag on it.
   *
   * The same thing the scheduled purge does to an expired row, so "I deleted
   * it" and "its deadline passed" cannot leave different remains — including
   * `previous_fields_json`, which a status change would have kept.
   */
  async function deleteOverride(input: { accountId: string; eventId: string; circleId: string }) {
    await ensureTables();
    const result = await database.prepare(
      `DELETE FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2 AND EXISTS (
         SELECT 1 FROM circle_claims c JOIN accounts a ON a.id = c.account_id
         WHERE c.account_id = ?3 AND c.event_id = ?1 AND c.circle_id = ?2 AND c.status = 'verified'
           AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
       )`,
    ).bind(input.eventId, input.circleId, input.accountId).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async function takedownOverride(input: { eventId: string; circleId: string; reason: string; by: string; now: number; fieldsJson?: string }) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE circle_overrides SET status = 'takendown', takedown_reason = ?1, takendown_by = ?2, takendown_at = ?3,
         fields_json = CASE WHEN ?6 = 1 THEN ?7 ELSE fields_json END,
         hosted_thumbnail_key = CASE WHEN ?6 = 1 THEN NULL ELSE hosted_thumbnail_key END
       WHERE event_id = ?4 AND circle_id = ?5 AND status = 'live'`,
    ).bind(
      input.reason, input.by, input.now, input.eventId, input.circleId,
      input.fieldsJson === undefined ? 0 : 1, input.fieldsJson ?? null,
    ).run();
    return result.meta.changes === 1;
  }

  async function listLiveOverrides(eventId: string, phase: OverridesPhase = "during") {
    await ensureTables();
    // After the event, a circle that opted out is simply absent from the query,
    // so its content never reaches the published document at all.
    const hiddenClause = phase === "after" ? " AND post_event_hidden = 0" : "";
    const result = await database.prepare(
      `SELECT circle_id, fields_json, status, updated_at FROM circle_overrides
       WHERE event_id = ?1 AND status = 'live'${hiddenClause} ORDER BY circle_id ASC`,
    ).bind(eventId).all<OverrideRow>();
    return result.results;
  }

  async function setPostEventHidden(accountId: string, eventId: string, circleId: string, hidden: boolean) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE circle_overrides SET post_event_hidden = ?1
       WHERE event_id = ?2 AND circle_id = ?3 AND EXISTS (
         SELECT 1 FROM circle_claims c JOIN accounts a ON a.id = c.account_id
         WHERE c.account_id = ?4 AND c.event_id = ?2 AND c.circle_id = ?3 AND c.status = 'verified'
           AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
       )`,
    ).bind(hidden ? 1 : 0, eventId, circleId, accountId).run();
    return result.meta.changes === 1;
  }

  /**
   * Re-serialize the public document on every write. At the expected scale this
   * is trivial, and it turns each edge-cache miss into a single row read
   * instead of a scan — which is what keeps venue traffic inside the D1 quota.
   */
  async function rebuildOverridesDoc(eventId: string, generatedAt: string, now: number, phase: OverridesPhase = "during") {
    const rows = await listLiveOverrides(eventId, phase);
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
      `INSERT INTO overrides_doc (event_id, revision, json, updated_at, phase) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(event_id) DO UPDATE SET revision = excluded.revision, json = excluded.json,
         updated_at = excluded.updated_at, phase = excluded.phase`,
    ).bind(eventId, revision, json, now, phase).run();
    return { revision, json, phase };
  }

  async function getOverridesDoc(eventId: string) {
    await ensureTables();
    return database.prepare(`SELECT revision, json, updated_at, phase FROM overrides_doc WHERE event_id = ?1`)
      .bind(eventId).first<{ revision: number; json: string; updated_at: number; phase: OverridesPhase }>();
  }

  async function manageMapContributor(input: {
    email: string;
    action: "grant" | "revoke" | "suspend";
    by: string;
    now: number;
  }) {
    await ensureTables();
    const account = await database.prepare("SELECT id FROM accounts WHERE email = ?1 AND disabled_at IS NULL AND deletion_started_at IS NULL")
      .bind(input.email).first<{ id: string }>();
    if (!account) return "missing" as const;
    if (input.action === "grant") {
      const result = await database.prepare(
        `INSERT INTO map_contributor_grants (account_id, granted_by, granted_at, revoked_by, revoked_at, suspended_by, suspended_at)
         VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL)
         ON CONFLICT(account_id) DO UPDATE SET
           granted_by = excluded.granted_by, granted_at = excluded.granted_at,
           revoked_by = NULL, revoked_at = NULL, suspended_by = NULL, suspended_at = NULL
         WHERE map_contributor_grants.revoked_at IS NOT NULL OR map_contributor_grants.suspended_at IS NOT NULL`,
      ).bind(account.id, input.by, input.now).run();
      return result.meta.changes === 1 ? "granted" as const : "unchanged" as const;
    }
    const column = input.action === "revoke" ? "revoked" : "suspended";
    const result = await database.prepare(
      `UPDATE map_contributor_grants SET ${column}_by = ?1, ${column}_at = ?2
       WHERE account_id = ?3 AND revoked_at IS NULL AND suspended_at IS NULL`,
    ).bind(input.by, input.now, account.id).run();
    return result.meta.changes === 1
      ? (input.action === "revoke" ? "revoked" as const : "suspended" as const)
      : "unchanged" as const;
  }

  async function hasActiveMapContributor(accountId: string) {
    await ensureTables();
    const row = await database.prepare(
      `SELECT account_id FROM map_contributor_grants
       WHERE account_id = ?1 AND revoked_at IS NULL AND suspended_at IS NULL`,
    ).bind(accountId).first<{ account_id: string }>();
    return !!row;
  }

  async function createMapDraft(input: {
    id: string;
    eventId: string;
    periodKey: string;
    venueSpaceId: string;
    ownerAccountId: string;
    contentJson: string;
    now: number;
  }) {
    await ensureTables();
    const revisionId = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `INSERT INTO map_drafts (
           id, event_id, period_key, venue_space_id, owner_account_id, status,
           current_revision, created_at, updated_at, last_activity_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, 'draft', 1, ?6, ?6, ?6
         WHERE EXISTS (
           SELECT 1 FROM map_contributor_grants
           WHERE account_id = ?5 AND revoked_at IS NULL AND suspended_at IS NULL
         )`,
      ).bind(input.id, input.eventId, input.periodKey, input.venueSpaceId, input.ownerAccountId, input.now),
      database.prepare(
        `INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
         SELECT ?1, id, 1, ?2, ?3, ?4 FROM map_drafts WHERE id = ?5 AND owner_account_id = ?3`,
      ).bind(revisionId, input.contentJson, input.ownerAccountId, input.now, input.id),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  async function getMapDraft(draftId: string, eventId?: string) {
    await ensureTables();
    return database.prepare(
      `SELECT d.*, r.content_json FROM map_drafts d
       JOIN map_draft_revisions r ON r.draft_id = d.id AND r.revision = d.current_revision
       WHERE d.id = ?1 AND (?2 IS NULL OR d.event_id = ?2)`,
    ).bind(draftId, eventId ?? null).first<{
      id: string; event_id: string; period_key: string; venue_space_id: string; owner_account_id: string;
      status: MapDraftStatus; current_revision: number; created_at: number; updated_at: number;
      last_activity_at: number; decision_at: number | null; content_json: string | null;
    }>();
  }

  /** One-time lazy normalization for aliases accepted by the active event.
   * The active-approval unique index makes conflicting legacy state fail
   * closed instead of preserving two spellings for one logical scope. */
  async function normalizeMapDraftPeriodAliases(input: {
    eventId: string; venueSpaceId: string; periodKey: string; periodAliases: readonly string[];
  }) {
    await ensureTables();
    const aliases = [...new Set(input.periodAliases)]
      .filter((alias) => alias !== input.periodKey);
    if (aliases.length > 16 || aliases.some((alias) => !/^[a-z0-9][a-z0-9-]*$/.test(alias))) {
      throw new Error("Invalid map period aliases.");
    }
    if (!aliases.length) return true;
    try {
      await database.batch(aliases.map((alias) => database.prepare(
        `UPDATE map_drafts SET period_key = ?1
         WHERE event_id = ?2 AND venue_space_id = ?3 AND period_key = ?4`,
      ).bind(input.periodKey, input.eventId, input.venueSpaceId, alias)));
      return true;
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) return false;
      throw error;
    }
  }

  async function listMapDraftsForOwner(ownerAccountId: string, eventId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, event_id, period_key, venue_space_id, status, current_revision,
              created_at, updated_at, decision_at
       FROM map_drafts WHERE owner_account_id = ?1 AND event_id = ?2 ORDER BY updated_at DESC`,
    ).bind(ownerAccountId, eventId).all<{
      id: string; event_id: string; period_key: string; venue_space_id: string; status: MapDraftStatus;
      current_revision: number; created_at: number; updated_at: number; decision_at: number | null;
    }>();
    return result.results;
  }

  async function listMapDraftsForAdmin(eventId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT d.id, d.event_id, d.period_key, d.venue_space_id, d.status, d.current_revision,
              d.created_at, d.updated_at, d.decision_at, a.email AS owner_email
       FROM map_drafts d LEFT JOIN accounts a ON a.id = d.owner_account_id
       WHERE d.event_id = ?1 AND d.status <> 'draft' ORDER BY d.updated_at DESC`,
    ).bind(eventId).all<{
      id: string; event_id: string; period_key: string; venue_space_id: string; status: MapDraftStatus;
      current_revision: number; created_at: number; updated_at: number; decision_at: number | null;
      owner_email: string | null;
    }>();
    return result.results;
  }

  async function listMapDraftFiles(draftId: string, revision?: number) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, draft_id, revision, object_key, source_url, document_date, page_number, sha256, mime,
              size_bytes, width, height, page_count, uploaded_at, review_result, raw_deleted_at
       FROM map_draft_files WHERE draft_id = ?1 AND (?2 IS NULL OR revision = ?2)
       ORDER BY uploaded_at ASC`,
    ).bind(draftId, revision ?? null).all<{
      id: string; draft_id: string; revision: number; object_key: string | null; source_url: string;
      document_date: string; page_number: number | null; sha256: string; mime: string; size_bytes: number;
      width: number | null; height: number | null; page_count: number | null; uploaded_at: number;
      review_result: string | null; raw_deleted_at: number | null;
    }>();
    return result.results;
  }

  async function listMapDraftReviews(draftId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT revision, from_status, to_status, actor_role, note, at
       FROM map_draft_reviews WHERE draft_id = ?1 ORDER BY at ASC, rowid ASC`,
    ).bind(draftId).all<{
      revision: number; from_status: MapDraftStatus; to_status: MapDraftStatus;
      actor_role: string; note: string | null; at: number;
    }>();
    return result.results;
  }

  /** Discussion is read without the author account id: participants on a draft
   * are never identified to one another, only their role is. */
  async function listMapDraftComments(draftId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, revision, author_role, target_kind, target_ref, body, at
       FROM map_draft_comments WHERE draft_id = ?1 ORDER BY at ASC, rowid ASC`,
    ).bind(draftId).all<{
      id: string; revision: number; author_role: string;
      target_kind: string | null; target_ref: string | null; body: string; at: number;
    }>();
    return result.results;
  }

  /** Writes one comment against the draft's revision as it stands, and returns
   * null when the draft is gone or already claimed by retention. Discussion is
   * not a state transition, so it carries no optimistic lock: a comment about
   * revision 3 stays a comment about revision 3 even after the draft moves on. */
  async function addMapDraftComment(input: {
    draftId: string;
    eventId: string;
    authorAccountId: string;
    authorRole: "map_contributor" | "admin";
    /** Pins the comment to a specific revision. Defaults to the draft's current
     * one, which is right for a comment written about what is on screen; a
     * review's change requests pass the revision that was actually reviewed. */
    revision?: number;
    targetKind: "slot" | "landmark" | null;
    targetRef: string | null;
    body: string;
    now: number;
  }) {
    await ensureTables();
    const id = crypto.randomUUID();
    // Discussion is activity. Without the touch, a draft under review could sit
    // out its inactivity window while it was being talked about and be purged
    // on the next run. Batched with the insert so the two cannot disagree.
    //
    // The contributor branch rechecks ownership and the live grant inside the
    // write, the way a revision write does: a grant revoked between the
    // handler's check and this statement must refuse the comment, not race it.
    const results = await database.batch([
      database.prepare(
        `INSERT INTO map_draft_comments (id, draft_id, revision, author_account_id, author_role, target_kind, target_ref, body, at)
         SELECT ?1, id, COALESCE(?2, current_revision), ?3, ?4, ?5, ?6, ?7, ?8 FROM map_drafts
         WHERE id = ?9 AND event_id = ?10 AND retention_action IS NULL
           AND (?4 <> 'map_contributor' OR (owner_account_id = ?3 AND EXISTS (
             SELECT 1 FROM map_contributor_grants
             WHERE account_id = ?3 AND revoked_at IS NULL AND suspended_at IS NULL
           )))`,
      ).bind(id, input.revision ?? null, input.authorAccountId, input.authorRole, input.targetKind, input.targetRef, input.body, input.now, input.draftId, input.eventId),
      database.prepare(
        `UPDATE map_drafts SET last_activity_at = ?1
         WHERE id = ?2 AND event_id = ?3 AND retention_action IS NULL AND last_activity_at < ?1`,
      ).bind(input.now, input.draftId, input.eventId),
    ]);
    return (results[0].meta.changes ?? 0) === 1 ? id : null;
  }

  async function getActiveApprovedMapDraft(eventId: string, periodKey: string, venueSpaceId: string) {
    await ensureTables();
    return database.prepare(
      `SELECT id, current_revision, status FROM map_drafts
       WHERE event_id = ?1 AND period_key = ?2 AND venue_space_id = ?3
         AND status IN ('approved', 'exported') LIMIT 1`,
    ).bind(eventId, periodKey, venueSpaceId).first<{
      id: string; current_revision: number; status: "approved" | "exported";
    }>();
  }

  async function listStaleSubmittedMapDrafts(before: number, eventId?: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, event_id, period_key, venue_space_id, current_revision, updated_at
       FROM map_drafts WHERE status = 'submitted' AND updated_at < ?1
         AND (?2 IS NULL OR event_id = ?2) ORDER BY updated_at ASC`,
    ).bind(before, eventId ?? null).all<{
      id: string; event_id: string; period_key: string; venue_space_id: string;
      current_revision: number; updated_at: number;
    }>();
    return result.results;
  }

  async function writeMapDraftRevision(input: {
    draftId: string;
    eventId: string;
    ownerAccountId: string;
    expectedRevision: number;
    contentJson: string;
    now: number;
  }) {
    await ensureTables();
    const nextRevision = input.expectedRevision + 1;
    const results = await database.batch([
      database.prepare(
        `UPDATE map_drafts SET current_revision = ?1, updated_at = ?2, last_activity_at = ?2
         WHERE id = ?3 AND owner_account_id = ?4 AND current_revision = ?5
           AND event_id = ?6
           AND status IN ('draft', 'changes_requested')
           AND retention_action IS NULL
           AND EXISTS (
             SELECT 1 FROM map_contributor_grants
             WHERE account_id = ?4 AND revoked_at IS NULL AND suspended_at IS NULL
           )`,
      ).bind(nextRevision, input.now, input.draftId, input.ownerAccountId, input.expectedRevision, input.eventId),
      database.prepare(
        `INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
         SELECT ?1, id, ?2, ?3, ?4, ?5 FROM map_drafts
         WHERE id = ?6 AND owner_account_id = ?4 AND current_revision = ?2 AND updated_at = ?5
           AND NOT EXISTS (SELECT 1 FROM map_draft_revisions WHERE draft_id = ?6 AND revision = ?2)`,
      ).bind(crypto.randomUUID(), nextRevision, input.contentJson, input.ownerAccountId, input.now, input.draftId),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1 ? nextRevision : null;
  }

  async function submitMapDraft(input: { draftId: string; eventId: string; ownerAccountId: string; expectedRevision: number; now: number }) {
    await ensureTables();
    const reviewId = crypto.randomUUID();
    const transitionToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `UPDATE map_drafts SET status = 'submitted', updated_at = ?1, last_activity_at = ?1, transition_token = ?2
         WHERE id = ?3 AND owner_account_id = ?4 AND current_revision = ?5
           AND event_id = ?6
           AND status IN ('draft', 'changes_requested')
           AND retention_action IS NULL
           AND EXISTS (
             SELECT 1 FROM map_contributor_grants
             WHERE account_id = ?4 AND revoked_at IS NULL AND suspended_at IS NULL
           )`,
      ).bind(input.now, transitionToken, input.draftId, input.ownerAccountId, input.expectedRevision, input.eventId),
      database.prepare(
        `INSERT INTO map_draft_reviews (id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, at)
         SELECT ?1, d.id, d.current_revision,
           CASE WHEN EXISTS (SELECT 1 FROM map_draft_reviews WHERE draft_id = d.id AND to_status = 'changes_requested')
             THEN 'changes_requested' ELSE 'draft' END,
           'submitted', ?2, 'map_contributor', ?3
         FROM map_drafts d WHERE d.id = ?4 AND d.owner_account_id = ?2 AND d.status = 'submitted' AND d.transition_token = ?5`,
      ).bind(reviewId, input.ownerAccountId, input.now, input.draftId, transitionToken),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  async function transitionMapDraft(input: {
    draftId: string;
    expectedRevision: number;
    toStatus: "changes_requested" | "rejected";
    actorAccountId: string | null;
    actorRole: "admin" | "system";
    note?: string | null;
    now: number;
  }) {
    await ensureTables();
    const fromStatus = "submitted";
    const decisionAt = input.toStatus === "changes_requested" ? null : input.now;
    const transitionToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `UPDATE map_drafts SET status = ?1, updated_at = ?2, last_activity_at = ?2, decision_at = ?3, transition_token = ?4
         WHERE id = ?5 AND current_revision = ?6 AND status = ?7 AND retention_action IS NULL`,
      ).bind(input.toStatus, input.now, decisionAt, transitionToken, input.draftId, input.expectedRevision, fromStatus),
      database.prepare(
        `INSERT INTO map_draft_reviews (
           id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, note, at
         ) SELECT ?1, id, current_revision, ?2, ?3, ?4, ?5, ?6, ?7
           FROM map_drafts WHERE id = ?8 AND current_revision = ?9 AND status = ?3 AND transition_token = ?10`,
      ).bind(
        crypto.randomUUID(), fromStatus, input.toStatus, input.actorAccountId, input.actorRole,
        input.note ?? null, input.now, input.draftId, input.expectedRevision, transitionToken,
      ),
      database.prepare(
        `UPDATE map_draft_files SET review_result = ?1
         WHERE draft_id = ?2 AND revision = ?3
           AND EXISTS (SELECT 1 FROM map_drafts d WHERE d.id = ?2 AND d.current_revision = ?3
             AND d.status = ?4 AND d.transition_token = ?5)`,
      ).bind(input.toStatus, input.draftId, input.expectedRevision, input.toStatus, transitionToken),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  /** Explicitly withdraws the current approved/exported draft before approving
   * its replacement. Every row change and both immutable review records share
   * one D1 batch, so the unique scope invariant never has an open window. */
  async function approveMapDraft(input: {
    draftId: string;
    expectedRevision: number;
    replacementDraftId?: string | null;
    actorAccountId: string;
    note?: string | null;
    now: number;
  }) {
    await ensureTables();
    const evidence = await database.prepare(
      `SELECT id FROM map_draft_files WHERE draft_id = ?1 AND revision = ?2 LIMIT 1`,
    ).bind(input.draftId, input.expectedRevision).first<{ id: string }>();
    if (!evidence) return { ok: false as const, reason: "missing_evidence" as const };
    const active = await database.prepare(
      `SELECT current.id, current.status FROM map_drafts target
       JOIN map_drafts current
         ON current.event_id = target.event_id
        AND current.period_key = target.period_key
        AND current.venue_space_id = target.venue_space_id
       WHERE target.id = ?1 AND target.current_revision = ?2 AND target.status = 'submitted'
         AND current.status IN ('approved', 'exported') LIMIT 1`,
    ).bind(input.draftId, input.expectedRevision).first<{ id: string; status: "approved" | "exported" }>();
    if (active && active.id !== input.replacementDraftId) return { ok: false as const, reason: "replacement_required" as const, activeDraftId: active.id };
    if (!active && input.replacementDraftId) return { ok: false as const, reason: "replacement_mismatch" as const };
    if (!active) {
      const approvedToken = crypto.randomUUID();
      const results = await database.batch([
        database.prepare(
          `UPDATE map_drafts SET status = 'approved', updated_at = ?1, last_activity_at = ?1,
               decision_at = ?1, transition_token = ?2
           WHERE id = ?3 AND current_revision = ?4 AND status = 'submitted' AND retention_action IS NULL
             AND EXISTS (SELECT 1 FROM map_draft_files WHERE draft_id = ?3 AND revision = ?4)`,
        ).bind(input.now, approvedToken, input.draftId, input.expectedRevision),
        database.prepare(
          `INSERT INTO map_draft_reviews (
             id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, note, at
           ) SELECT ?1, id, current_revision, 'submitted', 'approved', ?2, 'admin', ?3, ?4
             FROM map_drafts WHERE id = ?5 AND current_revision = ?6 AND status = 'approved' AND transition_token = ?7`,
        ).bind(crypto.randomUUID(), input.actorAccountId, input.note ?? null, input.now, input.draftId, input.expectedRevision, approvedToken),
        database.prepare(
          `UPDATE map_draft_files SET review_result = 'approved_official_source'
           WHERE draft_id = ?1 AND revision = ?2
             AND EXISTS (SELECT 1 FROM map_drafts d WHERE d.id = ?1 AND d.current_revision = ?2
               AND d.status = 'approved' AND d.transition_token = ?3)`,
        ).bind(input.draftId, input.expectedRevision, approvedToken),
      ]);
      const ok = results.every((result) => result.meta.changes >= 1);
      return ok ? { ok: true as const, replacedDraftId: null } : { ok: false as const, reason: "conflict" as const };
    }

    const withdrawnToken = crypto.randomUUID();
    const approvedToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `UPDATE map_drafts SET status = 'withdrawn', updated_at = ?1, last_activity_at = ?1,
             decision_at = ?1, transition_token = ?2
         WHERE id = ?3 AND status IN ('approved', 'exported')
           AND EXISTS (SELECT 1 FROM map_drafts target
             WHERE target.id = ?4 AND target.current_revision = ?5 AND target.status = 'submitted'
               AND EXISTS (SELECT 1 FROM map_draft_files evidence
                 WHERE evidence.draft_id = target.id AND evidence.revision = target.current_revision)
               AND target.event_id = map_drafts.event_id AND target.period_key = map_drafts.period_key
               AND target.venue_space_id = map_drafts.venue_space_id)`,
      ).bind(input.now, withdrawnToken, active.id, input.draftId, input.expectedRevision),
      database.prepare(
        `INSERT INTO map_draft_reviews (
           id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, note, at
         ) SELECT ?1, id, current_revision, ?2, 'withdrawn', ?3, 'admin', ?4, ?5
           FROM map_drafts WHERE id = ?6 AND status = 'withdrawn' AND transition_token = ?7`,
      ).bind(crypto.randomUUID(), active.status, input.actorAccountId, input.note ?? null, input.now, active.id, withdrawnToken),
      database.prepare(
        `UPDATE map_drafts SET status = 'approved', updated_at = ?1, last_activity_at = ?1,
             decision_at = ?1, transition_token = ?2
         WHERE id = ?3 AND current_revision = ?4 AND status = 'submitted'
           AND EXISTS (SELECT 1 FROM map_draft_files WHERE draft_id = ?3 AND revision = ?4)
           AND NOT EXISTS (SELECT 1 FROM map_drafts current
             WHERE current.event_id = map_drafts.event_id AND current.period_key = map_drafts.period_key
               AND current.venue_space_id = map_drafts.venue_space_id
               AND current.status IN ('approved', 'exported'))`,
      ).bind(input.now, approvedToken, input.draftId, input.expectedRevision),
      database.prepare(
        `INSERT INTO map_draft_reviews (
           id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, note, at
         ) SELECT ?1, id, current_revision, 'submitted', 'approved', ?2, 'admin', ?3, ?4
           FROM map_drafts WHERE id = ?5 AND current_revision = ?6 AND status = 'approved' AND transition_token = ?7`,
      ).bind(crypto.randomUUID(), input.actorAccountId, input.note ?? null, input.now, input.draftId, input.expectedRevision, approvedToken),
      database.prepare(
        `UPDATE map_draft_files SET review_result = 'approved_official_source'
         WHERE draft_id = ?1 AND revision = ?2
           AND EXISTS (SELECT 1 FROM map_drafts d WHERE d.id = ?1 AND d.current_revision = ?2
             AND d.status = 'approved' AND d.transition_token = ?3)`,
      ).bind(input.draftId, input.expectedRevision, approvedToken),
    ]);
    const ok = results.slice(0, 4).every((result) => result.meta.changes === 1)
      && results[4].meta.changes >= 1;
    return ok ? { ok: true as const, replacedDraftId: active.id } : { ok: false as const, reason: "conflict" as const };
  }

  async function getMapDraftExport(draftId: string, revision: number) {
    await ensureTables();
    return database.prepare(
      `SELECT id, draft_id, revision, target_path, candidate_json, diff_json, candidate_sha256, created_at
       FROM map_draft_exports WHERE draft_id = ?1 AND revision = ?2`,
    ).bind(draftId, revision).first<{
      id: string; draft_id: string; revision: number; target_path: string; candidate_json: string;
      diff_json: string; candidate_sha256: string; created_at: number;
    }>();
  }

  async function exportMapDraft(input: {
    draftId: string;
    expectedRevision: number;
    targetPath: string;
    candidateJson: string;
    diffJson: string;
    candidateSha256: string;
    actorAccountId: string;
    now: number;
  }) {
    await ensureTables();
    const existing = await getMapDraftExport(input.draftId, input.expectedRevision);
    if (existing) return existing;
    const exportId = crypto.randomUUID();
    const transitionToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `INSERT INTO map_draft_exports (
           id, draft_id, revision, target_path, candidate_json, diff_json, candidate_sha256, created_by, created_at
         ) SELECT ?1, id, current_revision, ?2, ?3, ?4, ?5, ?6, ?7
           FROM map_drafts WHERE id = ?8 AND current_revision = ?9 AND status = 'approved'`,
      ).bind(exportId, input.targetPath, input.candidateJson, input.diffJson, input.candidateSha256,
        input.actorAccountId, input.now, input.draftId, input.expectedRevision),
      database.prepare(
        `UPDATE map_drafts SET status = 'exported', updated_at = ?1, last_activity_at = ?1,
             decision_at = ?1, transition_token = ?2
         WHERE id = ?3 AND current_revision = ?4 AND status = 'approved'
           AND EXISTS (SELECT 1 FROM map_draft_exports e WHERE e.id = ?5 AND e.draft_id = map_drafts.id)`,
      ).bind(input.now, transitionToken, input.draftId, input.expectedRevision, exportId),
      database.prepare(
        `INSERT INTO map_draft_reviews (
           id, draft_id, revision, from_status, to_status, actor_account_id, actor_role, note, at
         ) SELECT ?1, id, current_revision, 'approved', 'exported', ?2, 'admin', ?3, ?4
           FROM map_drafts WHERE id = ?5 AND current_revision = ?6 AND status = 'exported' AND transition_token = ?7`,
      ).bind(crypto.randomUUID(), input.actorAccountId, `候選匯出：${input.targetPath}`, input.now,
        input.draftId, input.expectedRevision, transitionToken),
    ]);
    if (!results.every((result) => result.meta.changes === 1)) return null;
    return getMapDraftExport(input.draftId, input.expectedRevision);
  }

  async function addMapDraftFile(input: {
    id: string; draftId: string; eventId: string; revision: number; objectKey: string; sourceUrl: string; documentDate: string;
    pageNumber: number | null; sha256: string; mime: string; sizeBytes: number; width: number | null;
    height: number | null; pageCount: number | null; uploadedBy: string; now: number;
  }) {
    await ensureTables();
    const result = await database.prepare(
      `INSERT INTO map_draft_files (
         id, draft_id, revision, object_key, source_url, document_date, page_number, sha256, mime,
         size_bytes, width, height, page_count, uploaded_by, uploaded_at
       ) SELECT ?1, d.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
         FROM map_drafts d
         WHERE d.id = ?15 AND d.owner_account_id = ?13 AND d.current_revision = ?2
           AND d.event_id = ?16
           AND d.status IN ('draft', 'changes_requested')
           AND d.retention_action IS NULL
           AND EXISTS (
             SELECT 1 FROM map_contributor_grants
             WHERE account_id = ?13 AND revoked_at IS NULL AND suspended_at IS NULL
           )`,
    ).bind(
      input.id, input.revision, input.objectKey, input.sourceUrl, input.documentDate, input.pageNumber,
      input.sha256, input.mime, input.sizeBytes, input.width, input.height, input.pageCount,
      input.uploadedBy, input.now, input.draftId, input.eventId,
    ).run();
    return result.meta.changes === 1;
  }

  async function getMapDraftFile(fileId: string, eventId?: string) {
    await ensureTables();
    return database.prepare(
      `SELECT f.*, d.owner_account_id, d.event_id, d.status FROM map_draft_files f
       JOIN map_drafts d ON d.id = f.draft_id
       WHERE f.id = ?1 AND (?2 IS NULL OR d.event_id = ?2)`,
    ).bind(fileId, eventId ?? null).first<{
      id: string; draft_id: string; revision: number; object_key: string | null; source_url: string;
      document_date: string; page_number: number | null; sha256: string; mime: string; size_bytes: number;
      width: number | null; height: number | null; page_count: number | null; uploaded_by: string | null;
      uploaded_at: number; review_result: string | null; raw_deleted_at: number | null;
      owner_account_id: string; event_id: string; status: MapDraftStatus;
    }>();
  }

  async function markMapDraftRawDeleted(fileId: string, now: number) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE map_draft_files SET object_key = NULL, raw_deleted_at = COALESCE(raw_deleted_at, ?1)
       WHERE id = ?2 AND object_key IS NOT NULL`,
    ).bind(now, fileId).run();
    return result.meta.changes === 1;
  }

  async function storePreviewMail(message: { email: string; subject: string; text: string; now: number }) {
    await ensureTables();
    await database.prepare(
      "INSERT INTO preview_mail_sink (id, email, subject, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(crypto.randomUUID(), message.email, message.subject, message.text, message.now).run();
  }

  async function latestPreviewMail(email: string) {
    await ensureTables();
    return database.prepare(
      "SELECT id, email, subject, text, created_at FROM preview_mail_sink WHERE email = ?1 ORDER BY created_at DESC LIMIT 1",
    ).bind(email).first<{ id: string; email: string; subject: string; text: string; created_at: number }>();
  }

  /** Disposable preview reset. Admin roster is deliberately retained. */
  async function clearPreviewData() {
    await ensureTables();
    await database.batch([
      "map_draft_exports", "map_draft_files", "map_draft_reviews", "map_draft_comments", "map_draft_revisions", "map_drafts", "map_contributor_grants",
      "login_tokens", "sessions", "circle_claims", "circle_overrides", "overrides_doc", "audit_log", "preview_mail_sink", "accounts",
    ].map((table) => database.prepare(`DELETE FROM ${table}`)));
  }

  return {
    ensureTables, writeAudit,
    listAdmins, isAdminEmail, addAdmin, removeAdmin,
    countLoginTokensSince, createLoginToken, consumeLoginToken,
    upsertAccount, createSession, getSession, revokeSession, disableAccount, beginAccountDeletion, isAccountWritable, deleteAccount,
    listHostedThumbnailKeysForAccount, listHostedThumbnailKeys, listUnsubmittedMapDraftObjectKeysForAccount,
    createClaim, getClaim, listClaimsForAccount, listClaimScopesForAccount, listClaimsByStatus,
    hasVerifiedClaim, ownsCircle, markClaimVerified, setClaimStatus, recordChallengeAttempt,
    getOverride, putOverride, deleteOverride, takedownOverride, listLiveOverrides, setPostEventHidden,
    rebuildOverridesDoc, getOverridesDoc,
    manageMapContributor, hasActiveMapContributor,
    createMapDraft, getMapDraft, normalizeMapDraftPeriodAliases,
    listMapDraftsForOwner, listMapDraftsForAdmin, listMapDraftFiles, listMapDraftReviews,
    listMapDraftComments, addMapDraftComment,
    getActiveApprovedMapDraft, listStaleSubmittedMapDrafts, writeMapDraftRevision, submitMapDraft, transitionMapDraft,
    approveMapDraft, getMapDraftExport, exportMapDraft,
    addMapDraftFile, getMapDraftFile, markMapDraftRawDeleted,
    storePreviewMail, latestPreviewMail, clearPreviewData,
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
