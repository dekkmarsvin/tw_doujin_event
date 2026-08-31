import { CIRCLE_OVERRIDES_SCHEMA, type CircleRetentionChoice } from "../app/circle-overrides";
import { IDENTITY_COLUMN_MIGRATIONS, IDENTITY_INDEXES, IDENTITY_TABLES } from "./identity-runtime-schema";

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
/** `withdrawn` is the claimant's own doing; `rejected` and `revoked` are an admin's. */
export type ClaimStatus = "pending" | "verified" | "rejected" | "revoked" | "withdrawn";
export type ClaimMethod = "email_domain" | "link_token" | "admin";
export type MapDraftStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected" | "exported" | "withdrawn";
export type OrganizerRole = "owner" | "editor";
export type OrganizerCandidateStatus = "draft" | "changes_requested" | "submitted" | "approved" | "publishing" | "published" | "failed";

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

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export function createIdentityRepository(database: D1Database, options: { bootstrapAdmins?: string[] } = {}) {
  let tablesReady: Promise<void> | null = null;

  /**
   * Three ordered steps, and the order is load-bearing. `CREATE TABLE IF NOT
   * EXISTS` is a no-op against a database that already has the table, so a
   * column added later exists only by way of `IDENTITY_COLUMN_MIGRATIONS` — and
   * an index over that column has to be created after the ALTER, never in the
   * same batch as the tables. Getting this wrong does not degrade gracefully:
   * the batch rejects with `no such column`, `tablesReady` resets, and every
   * repository-backed request fails on a database that was previously fine.
   */
  async function ensureTables() {
    if (!tablesReady) {
      tablesReady = database.batch(IDENTITY_TABLES.map(({ sql }) => database.prepare(sql)))
        .then(() => addMissingColumns())
        .then(() => database.batch(IDENTITY_INDEXES.map(({ sql }) => database.prepare(sql))))
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
    actorRole: "circle" | "map_contributor" | "organizer_owner" | "organizer_editor" | "admin" | "system";
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

  /** `origin` splits the two budgets that share this table. "self" counts only
   * links an inbox asked for, so an inviter cannot spend someone else's quota;
   * "invited" counts only links minted for that inbox by someone else, which is
   * what caps invitation spam. "any" stays the right answer per IP, where the
   * requester is the one being metered either way. */
  async function countLoginTokensSince(
    column: "email" | "request_ip_hash", value: string, since: number,
    origin: "self" | "invited" | "any" = "any",
  ) {
    await ensureTables();
    const filter = origin === "self" ? "AND minted_by IS NULL"
      : origin === "invited" ? "AND minted_by IS NOT NULL" : "";
    const row = await database.prepare(
      `SELECT COUNT(*) AS total FROM login_tokens WHERE ${column} = ?1 AND created_at >= ?2 ${filter}`,
    ).bind(value, since).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async function createLoginToken(input: {
    tokenHash: string; email: string; now: number; expiresAt: number; ipHash: string | null;
    audience?: "circle" | "organizer";
    /** Set only when another account minted this link by inviting the address. */
    mintedBy?: string | null;
  }) {
    await ensureTables();
    await database.prepare(
      `INSERT INTO login_tokens (id, token_hash, email, created_at, expires_at, request_ip_hash, audience, minted_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(crypto.randomUUID(), input.tokenHash, input.email, input.now, input.expiresAt, input.ipHash,
      input.audience ?? "circle", input.mintedBy ?? null).run();
  }

  /**
   * Single-use, enforced by the write itself. A read-then-write would let two
   * concurrent clicks on the same emailed link both succeed.
   */
  async function consumeLoginTokenDetails(tokenHash: string, now: number): Promise<{
    email: string;
    audience: "circle" | "organizer";
  } | null> {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE login_tokens SET consumed_at = ?1
       WHERE token_hash = ?2 AND consumed_at IS NULL AND expires_at > ?1`,
    ).bind(now, tokenHash).run();
    if (result.meta.changes !== 1) return null;

    const row = await database.prepare(`SELECT email, audience FROM login_tokens WHERE token_hash = ?1`)
      .bind(tokenHash).first<{ email: string; audience: string }>();
    if (!row) return null;

    // A consumed link retires every other outstanding link for that inbox.
    await database.prepare(
      `UPDATE login_tokens SET consumed_at = ?1 WHERE email = ?2 AND consumed_at IS NULL`,
    ).bind(now, row.email).run();
    return { email: row.email, audience: row.audience === "organizer" ? "organizer" : "circle" };
  }

  async function consumeLoginToken(tokenHash: string, now: number): Promise<string | null> {
    return (await consumeLoginTokenDetails(tokenHash, now))?.email ?? null;
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
      database.prepare(`DELETE FROM map_draft_exports WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft' AND candidate_id IS NULL)`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_files WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft' AND candidate_id IS NULL)`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_comments WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft' AND candidate_id IS NULL)`).bind(input.accountId),
      database.prepare(`DELETE FROM map_draft_revisions WHERE draft_id IN (SELECT id FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft' AND candidate_id IS NULL)`).bind(input.accountId),
      database.prepare(`DELETE FROM map_drafts WHERE owner_account_id = ?1 AND status = 'draft' AND candidate_id IS NULL`).bind(input.accountId),
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
      database.prepare(`UPDATE organizer_event_candidates SET created_by = '[shredded]' WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_candidates SET last_updated_by = '[shredded]' WHERE last_updated_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_candidates SET submitted_by = '[shredded]' WHERE submitted_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_candidates SET approved_by = '[shredded]' WHERE approved_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_revisions SET created_by = '[shredded]' WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_grants SET granted_by = '[shredded]' WHERE granted_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_grants SET revoked_by = '[shredded]' WHERE revoked_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_invitations SET invited_by = '[shredded]' WHERE invited_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_invitations SET accepted_by = '[shredded]', email = '[shredded]' WHERE accepted_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_invitations SET revoked_by = '[shredded]' WHERE revoked_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_event_invitations SET email = '[shredded]' WHERE email = ?1`).bind(input.email),
      database.prepare(`UPDATE organizer_event_reviews SET actor_account_id = '[shredded]' WHERE actor_account_id = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_workspace_state SET onboarding_completed_by = NULL WHERE onboarding_completed_by = ?1`).bind(input.accountId),
      database.prepare(`DELETE FROM organizer_workspace_preferences WHERE account_id = ?1`).bind(input.accountId),
      // The private workbook's file and sheet names identify the person who
      // uploaded it as much as the actor column does, so they go in the same
      // statement — a later one would no longer find the row by created_by.
      database.prepare(`UPDATE organizer_import_sources SET created_by = '[shredded]', file_name = '[shredded]', worksheet = NULL WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`UPDATE organizer_submission_snapshots SET created_by = '[shredded]' WHERE created_by = ?1`).bind(input.accountId),
      database.prepare(`DELETE FROM organizer_event_grants WHERE account_id = ?1`).bind(input.accountId),
      // Links this account minted for other inboxes outlive it; the invitee
      // keeps their budget but the departed actor stops being named.
      database.prepare(`UPDATE login_tokens SET minted_by = '[shredded]' WHERE minted_by = ?1`).bind(input.accountId),
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
         WHERE id = ?2 AND email = ?3 AND disabled_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM organizer_event_grants own
             WHERE own.account_id = ?2 AND own.role = 'owner' AND own.revoked_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM organizer_event_grants other
                 WHERE other.candidate_id = own.candidate_id AND other.role = 'owner'
                   AND other.revoked_at IS NULL AND other.account_id <> ?2
               )
           )`,
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
      database.prepare(
        `UPDATE organizer_event_grants SET revoked_by = '[account-deletion]', revoked_at = ?2
         WHERE account_id = ?1 AND revoked_at IS NULL AND EXISTS (
           SELECT 1 FROM accounts WHERE id = ?1 AND disabled_at IS NULL AND deletion_started_at IS NOT NULL
         )`,
      ).bind(input.accountId, input.now),
    ]);
    return results[0].meta.changes === 1;
  }

  async function listSoleOwnerOrganizerCandidates(accountId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT c.id, c.tentative_name
       FROM organizer_event_candidates c
       JOIN organizer_event_grants own ON own.candidate_id = c.id
       WHERE own.account_id = ?1 AND own.role = 'owner' AND own.revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM organizer_event_grants other
           WHERE other.candidate_id = c.id AND other.role = 'owner'
             AND other.revoked_at IS NULL AND other.account_id <> ?1
         )
       ORDER BY c.created_at`,
    ).bind(accountId).all<{ id: string; tentative_name: string }>();
    return result.results;
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
       WHERE d.owner_account_id = ?1 AND d.status = 'draft' AND d.candidate_id IS NULL AND f.object_key IS NOT NULL`,
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
    // One row per (event, circle, account) is a unique index, so a resubmission
    // after a withdrawal reuses the row rather than adding one. The guard is
    // the point: only a claim the account itself withdrew may be overwritten,
    // and `created_at` moves to now so a resubmission counts against the daily
    // limit exactly like a first submission — withdrawing is not a way to buy
    // more attempts. Everything else conflicts and reports no change.
    const result = await database.prepare(
      `INSERT INTO circle_claims (
         id, account_id, event_id, circle_id, circle_name_key, circle_name_at_claim, source_row_at_claim,
         status, method, target_url, challenge_token_hash, challenge_expires_at,
         evidence_url, evidence_note, created_at, verified_at
       ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
         FROM accounts WHERE id = ?2 AND disabled_at IS NULL AND deletion_started_at IS NULL
       ON CONFLICT(event_id, circle_id, account_id) DO UPDATE SET
         circle_name_key = excluded.circle_name_key,
         circle_name_at_claim = excluded.circle_name_at_claim,
         source_row_at_claim = excluded.source_row_at_claim,
         status = excluded.status, method = excluded.method, target_url = excluded.target_url,
         challenge_token_hash = excluded.challenge_token_hash,
         challenge_expires_at = excluded.challenge_expires_at,
         challenge_attempts = 0,
         evidence_url = excluded.evidence_url, evidence_note = excluded.evidence_note,
         created_at = excluded.created_at, verified_at = excluded.verified_at,
         reviewed_by = NULL, reviewed_at = NULL
       WHERE circle_claims.status = 'withdrawn'
       RETURNING id`,
    ).bind(
      input.id, input.accountId, input.eventId, input.circleId, input.circleNameKey,
      input.circleNameAtClaim, input.sourceRowAtClaim, input.status, input.method, input.targetUrl,
      input.challengeTokenHash, input.challengeExpiresAt, input.evidenceUrl, input.evidenceNote,
      input.now, input.status === "verified" ? input.now : null,
    ).first<{ id: string }>();
    // The id of the claim now in force, which is the reused row's own id after a
    // resubmission: the audit trail already points at it, and moving it would
    // orphan those entries. Null when nothing was written.
    return result?.id ?? null;
  }

  async function getClaim(id: string) {
    await ensureTables();
    return database.prepare(`SELECT * FROM circle_claims WHERE id = ?1`).bind(id).first<ClaimRow>();
  }

  /**
   * Withdrawing is the claimant's own escape from a lost or expired challenge.
   * Only a pending claim, and only the account that made it: an owner cannot
   * drop their own verified claim this way, and nobody can touch a decision an
   * admin already made. Clearing the hash is what makes the old code dead — the
   * plaintext was never stored, so this is the only thing left to invalidate.
   */
  async function withdrawClaim(id: string, accountId: string) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE circle_claims SET status = 'withdrawn', challenge_token_hash = NULL, challenge_expires_at = NULL
       WHERE id = ?1 AND account_id = ?2 AND status = 'pending'`,
    ).bind(id, accountId).run();
    return result.meta.changes === 1;
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

  async function listLiveOverrides(eventId: string, phase: OverridesPhase) {
    await ensureTables();
    // After the event, a circle that opted out is simply absent from the query,
    // so its content never reaches the published document at all.
    const hiddenClause = phase === "after" ? " AND o.post_event_hidden = 0" : "";
    // Circle-owned content is published as *this circle's own* supplement, so
    // it is only public while someone actually holds the circle. Ownership is
    // the live predicate rather than a flag copied onto the row: revoking a
    // claim then has one effect in one place, and no caller has to remember a
    // second "take it down" step. The row, its previous value and the audit
    // trail all stay put — this withdraws the projection, not the record.
    const result = await database.prepare(
      `SELECT o.circle_id, o.fields_json, o.status, o.updated_at FROM circle_overrides o
       WHERE o.event_id = ?1 AND o.status = 'live'${hiddenClause}
         AND EXISTS (
           SELECT 1 FROM circle_claims c
           WHERE c.event_id = o.event_id AND c.circle_id = o.circle_id AND c.status = 'verified'
         )
       ORDER BY o.circle_id ASC`,
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
   *
   * `phase` is required and has no default. A rebuild that assumes "during"
   * re-publishes every circle that asked to be withdrawn after the event
   * (ADR-0018), so which phase this is has to be stated by whoever is writing,
   * not guessed here: a default made three separate call sites wrong at once.
   */
  async function rebuildOverridesDoc(eventId: string, generatedAt: string, now: number, phase: OverridesPhase) {
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

  /** Organizer candidates borrow this table but carry a candidate_id, and their
   * event_id is the candidate's own — which can name a published event. Every
   * contributor-flow statement therefore restates `candidate_id IS NULL`: a
   * candidate map must never be readable, submittable or approvable through the
   * public map-contribution pipeline, whatever event id it happens to hold. */
  async function getMapDraft(draftId: string, eventId?: string) {
    await ensureTables();
    return database.prepare(
      `SELECT d.*, r.content_json FROM map_drafts d
       JOIN map_draft_revisions r ON r.draft_id = d.id AND r.revision = d.current_revision
       WHERE d.id = ?1 AND d.candidate_id IS NULL AND (?2 IS NULL OR d.event_id = ?2)`,
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
         WHERE event_id = ?2 AND candidate_id IS NULL AND venue_space_id = ?3 AND period_key = ?4`,
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
       FROM map_drafts WHERE owner_account_id = ?1 AND event_id = ?2 AND candidate_id IS NULL
       ORDER BY updated_at DESC`,
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
       WHERE d.event_id = ?1 AND d.candidate_id IS NULL AND d.status <> 'draft'
       ORDER BY d.updated_at DESC`,
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
    // The touch then keys off the inserted row - the statements share one
    // transaction and run in order - so a refused comment cannot defer
    // retention on a draft nobody was allowed to write to.
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
         WHERE id = ?2 AND event_id = ?3 AND retention_action IS NULL AND last_activity_at < ?1
           AND EXISTS (SELECT 1 FROM map_draft_comments WHERE id = ?4)`,
      ).bind(input.now, input.draftId, input.eventId, id),
    ]);
    return (results[0].meta.changes ?? 0) === 1 ? id : null;
  }

  async function getActiveApprovedMapDraft(eventId: string, periodKey: string, venueSpaceId: string) {
    await ensureTables();
    return database.prepare(
      `SELECT id, current_revision, status FROM map_drafts
       WHERE event_id = ?1 AND candidate_id IS NULL AND period_key = ?2 AND venue_space_id = ?3
         AND status IN ('approved', 'exported') LIMIT 1`,
    ).bind(eventId, periodKey, venueSpaceId).first<{
      id: string; current_revision: number; status: "approved" | "exported";
    }>();
  }

  async function listStaleSubmittedMapDrafts(before: number, eventId?: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, event_id, period_key, venue_space_id, current_revision, updated_at
       FROM map_drafts WHERE status = 'submitted' AND updated_at < ?1 AND candidate_id IS NULL
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
           AND event_id = ?6 AND candidate_id IS NULL
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
           AND event_id = ?6 AND candidate_id IS NULL
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
    /** Per-element change requests recorded with the decision. They are written
     * in the same batch, guarded by the same transition token, so a transition
     * can never land without its requests or leave a partial set behind that a
     * retry could not restore - the retry would conflict on the new status. */
    targets?: readonly { targetKind: "slot" | "landmark"; targetRef: string; body: string }[];
    now: number;
  }) {
    await ensureTables();
    const fromStatus = "submitted";
    const decisionAt = input.toStatus === "changes_requested" ? null : input.now;
    const transitionToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `UPDATE map_drafts SET status = ?1, updated_at = ?2, last_activity_at = ?2, decision_at = ?3, transition_token = ?4
         WHERE id = ?5 AND current_revision = ?6 AND status = ?7 AND retention_action IS NULL
           AND candidate_id IS NULL`,
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
      ...(input.targets ?? []).map((target) => database.prepare(
        `INSERT INTO map_draft_comments (id, draft_id, revision, author_account_id, author_role, target_kind, target_ref, body, at)
         SELECT ?1, id, ?2, ?3, 'admin', ?4, ?5, ?6, ?7 FROM map_drafts
         WHERE id = ?8 AND current_revision = ?2 AND status = ?9 AND transition_token = ?10`,
      ).bind(
        crypto.randomUUID(), input.expectedRevision, input.actorAccountId, target.targetKind,
        target.targetRef, target.body, input.now, input.draftId, input.toStatus, transitionToken,
      )),
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
        AND current.candidate_id IS NULL
       WHERE target.id = ?1 AND target.current_revision = ?2 AND target.status = 'submitted'
         AND target.candidate_id IS NULL
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
             AND candidate_id IS NULL
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
         WHERE id = ?3 AND status IN ('approved', 'exported') AND candidate_id IS NULL
           AND EXISTS (SELECT 1 FROM map_drafts target
             WHERE target.id = ?4 AND target.current_revision = ?5 AND target.status = 'submitted'
               AND target.candidate_id IS NULL
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
         WHERE id = ?3 AND current_revision = ?4 AND status = 'submitted' AND candidate_id IS NULL
           AND EXISTS (SELECT 1 FROM map_draft_files WHERE draft_id = ?3 AND revision = ?4)
           AND NOT EXISTS (SELECT 1 FROM map_drafts current
             WHERE current.event_id = map_drafts.event_id AND current.period_key = map_drafts.period_key
               AND current.venue_space_id = map_drafts.venue_space_id
               AND current.candidate_id IS NULL
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
           FROM map_drafts WHERE id = ?8 AND current_revision = ?9 AND status = 'approved'
             AND candidate_id IS NULL`,
      ).bind(exportId, input.targetPath, input.candidateJson, input.diffJson, input.candidateSha256,
        input.actorAccountId, input.now, input.draftId, input.expectedRevision),
      database.prepare(
        `UPDATE map_drafts SET status = 'exported', updated_at = ?1, last_activity_at = ?1,
             decision_at = ?1, transition_token = ?2
         WHERE id = ?3 AND current_revision = ?4 AND status = 'approved' AND candidate_id IS NULL
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
           AND d.event_id = ?16 AND d.candidate_id IS NULL
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
       WHERE f.id = ?1 AND d.candidate_id IS NULL AND (?2 IS NULL OR d.event_id = ?2)`,
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

  type OrganizerCandidateRow = {
    id: string;
    tentative_name: string;
    event_id: string | null;
    event_id_locked_at: number | null;
    status: OrganizerCandidateStatus;
    current_version: number;
    current_draft_json: string;
    created_by: string;
    created_at: number;
    updated_at: number;
    last_updated_by: string;
    last_updated_role: "admin" | OrganizerRole;
    submitted_by: string | null;
    submitted_at: number | null;
    approved_by: string | null;
    approved_at: number | null;
    published_version: number | null;
    published_at: number | null;
  };

  type OrganizerWorkspaceStateRow = {
    candidate_id: string;
    onboarding_completed_at: number | null;
    onboarding_completed_by: string | null;
    last_validated_version: number | null;
    created_at: number;
    updated_at: number;
  };

  type OrganizerWorkspacePreferenceRow = {
    guided_task: string;
    last_section: string;
    updated_at: number;
  };

  async function organizerRole(candidateId: string, accountId: string): Promise<OrganizerRole | null> {
    await ensureTables();
    const row = await database.prepare(
      `SELECT role FROM organizer_event_grants
       WHERE candidate_id = ?1 AND account_id = ?2 AND revoked_at IS NULL`,
    ).bind(candidateId, accountId).first<{ role: string }>();
    return row?.role === "owner" || row?.role === "editor" ? row.role : null;
  }

  async function hasOrganizerAccess(accountId: string) {
    await ensureTables();
    const row = await database.prepare(
      `SELECT 1 AS allowed FROM organizer_event_grants
       WHERE account_id = ?1 AND revoked_at IS NULL LIMIT 1`,
    ).bind(accountId).first<{ allowed: number }>();
    return !!row;
  }

  async function createOrganizerCandidate(input: {
    id: string;
    tentativeName: string;
    ownerEmail: string;
    createdByAccountId: string;
    draftJson: string;
    now: number;
  }) {
    await ensureTables();
    try {
      const results = await database.batch([
        database.prepare(
          `INSERT INTO organizer_event_candidates (
             id, tentative_name, status, current_version, current_draft_json,
             created_by, created_at, updated_at, last_updated_by, last_updated_role
           ) VALUES (?1, ?2, 'draft', 1, ?3, ?4, ?5, ?5, ?4, 'admin')`,
        ).bind(input.id, input.tentativeName, input.draftJson, input.createdByAccountId, input.now),
        database.prepare(
          `INSERT INTO organizer_event_revisions (
             id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at
           ) VALUES (?1, ?2, 1, NULL, ?3, ?4, 'admin', ?5)`,
        ).bind(crypto.randomUUID(), input.id, input.draftJson, input.createdByAccountId, input.now),
        database.prepare(
          `INSERT INTO organizer_workspace_state (
             candidate_id, onboarding_completed_at, onboarding_completed_by,
             last_validated_version, created_at, updated_at
           ) VALUES (?1, NULL, NULL, NULL, ?2, ?2)`,
        ).bind(input.id, input.now),
        database.prepare(
          `INSERT INTO organizer_event_invitations (
             id, candidate_id, email, role, invited_by, created_at
           ) VALUES (?1, ?2, ?3, 'owner', ?4, ?5)`,
        ).bind(crypto.randomUUID(), input.id, input.ownerEmail, input.createdByAccountId, input.now),
      ]);
      return results.every((result) => result.meta.changes === 1)
        ? { ok: true as const, version: 1 }
        : { ok: false as const, reason: "conflict" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique constraint/i.test(message)) return { ok: false as const, reason: "conflict" as const };
      throw error;
    }
  }

  async function acceptOrganizerInvitations(input: { accountId: string; email: string; now: number }) {
    await ensureTables();
    const pending = await database.prepare(
      `SELECT id, candidate_id, role, invited_by FROM organizer_event_invitations
       WHERE email = ?1 AND accepted_at IS NULL AND revoked_at IS NULL
       ORDER BY created_at, id`,
    ).bind(input.email).all<{ id: string; candidate_id: string; role: OrganizerRole; invited_by: string }>();
    const accepted: Array<{ candidateId: string; role: OrganizerRole }> = [];
    for (const invitation of pending.results) {
      const results = await database.batch([
        database.prepare(
          `UPDATE organizer_event_invitations
           SET accepted_by = ?1, accepted_at = ?2
           WHERE id = ?3 AND accepted_at IS NULL AND revoked_at IS NULL`,
        ).bind(input.accountId, input.now, invitation.id),
        database.prepare(
          `INSERT INTO organizer_event_grants (
             id, candidate_id, account_id, role, granted_by, granted_at, revoked_by, revoked_at
           ) SELECT ?1, candidate_id, ?2, role, invited_by, ?3, NULL, NULL
             FROM organizer_event_invitations WHERE id = ?4 AND accepted_by = ?2
           ON CONFLICT(candidate_id, account_id) DO UPDATE SET
             role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at,
             revoked_by = NULL, revoked_at = NULL`,
        ).bind(crypto.randomUUID(), input.accountId, input.now, invitation.id),
      ]);
      if (results.every((result) => result.meta.changes === 1)) {
        accepted.push({ candidateId: invitation.candidate_id, role: invitation.role });
      }
    }
    return accepted;
  }

  async function listOrganizerCandidatesForAccount(accountId: string, admin: boolean) {
    await ensureTables();
    if (admin) {
      const rows = await database.prepare(
        `SELECT c.id, c.tentative_name, c.event_id, c.status, c.current_version, c.updated_at,
                c.last_updated_role, 'admin' AS role,
                CASE WHEN w.candidate_id IS NULL OR w.onboarding_completed_at IS NOT NULL
                  THEN 'binder' ELSE 'guided' END AS workspace_mode
         FROM organizer_event_candidates c
         LEFT JOIN organizer_workspace_state w ON w.candidate_id = c.id
         ORDER BY c.updated_at DESC, c.id`,
      ).all<{
        id: string; tentative_name: string; event_id: string | null; status: OrganizerCandidateStatus;
        current_version: number; updated_at: number; last_updated_role: string; role: "admin";
        workspace_mode: "guided" | "binder";
      }>();
      return rows.results;
    }
    const rows = await database.prepare(
      `SELECT c.id, c.tentative_name, c.event_id, c.status, c.current_version, c.updated_at,
              c.last_updated_role, g.role,
              CASE WHEN w.candidate_id IS NULL OR w.onboarding_completed_at IS NOT NULL
                THEN 'binder' ELSE 'guided' END AS workspace_mode
       FROM organizer_event_candidates c
       JOIN organizer_event_grants g ON g.candidate_id = c.id
       LEFT JOIN organizer_workspace_state w ON w.candidate_id = c.id
       WHERE g.account_id = ?1 AND g.revoked_at IS NULL
       ORDER BY c.updated_at DESC, c.id`,
    ).bind(accountId).all<{
      id: string; tentative_name: string; event_id: string | null; status: OrganizerCandidateStatus;
      current_version: number; updated_at: number; last_updated_role: string; role: OrganizerRole;
      workspace_mode: "guided" | "binder";
    }>();
    return rows.results;
  }

  async function getOrganizerCandidate(candidateId: string) {
    await ensureTables();
    return database.prepare("SELECT * FROM organizer_event_candidates WHERE id = ?1")
      .bind(candidateId).first<OrganizerCandidateRow>();
  }

  async function getOrganizerWorkspace(candidateId: string, accountId: string) {
    await ensureTables();
    // A row is created with every new candidate. Missing rows therefore belong
    // to candidates that predate ADR-0047 and must retain the unrestricted
    // workspace they already had instead of being forced through onboarding.
    await database.prepare(
      `INSERT OR IGNORE INTO organizer_workspace_state (
         candidate_id, onboarding_completed_at, onboarding_completed_by,
         last_validated_version, created_at, updated_at
       ) SELECT id, updated_at, NULL, NULL, created_at, updated_at
         FROM organizer_event_candidates WHERE id = ?1`,
    ).bind(candidateId).run();
    const [state, preference] = await Promise.all([
      database.prepare(
        `SELECT candidate_id, onboarding_completed_at, onboarding_completed_by,
                last_validated_version, created_at, updated_at
         FROM organizer_workspace_state WHERE candidate_id = ?1`,
      ).bind(candidateId).first<OrganizerWorkspaceStateRow>(),
      database.prepare(
        `SELECT guided_task, last_section, updated_at
         FROM organizer_workspace_preferences WHERE candidate_id = ?1 AND account_id = ?2`,
      ).bind(candidateId, accountId).first<OrganizerWorkspacePreferenceRow>(),
    ]);
    return state ? { state, preference: preference ?? null } : null;
  }

  async function saveOrganizerWorkspacePreference(input: {
    candidateId: string;
    accountId: string;
    guidedTask: string;
    lastSection: string;
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    const result = await database.prepare(
      `INSERT INTO organizer_workspace_preferences (
         id, candidate_id, account_id, guided_task, last_section, updated_at
       ) SELECT ?1, c.id, ?2, ?3, ?4, ?5
         FROM organizer_event_candidates c WHERE c.id = ?6
         ${input.admin ? "" : `AND EXISTS (
           SELECT 1 FROM organizer_event_grants g
           WHERE g.candidate_id = c.id AND g.account_id = ?2 AND g.revoked_at IS NULL
         )`}
       ON CONFLICT(candidate_id, account_id) DO UPDATE SET
         guided_task = excluded.guided_task,
         last_section = excluded.last_section,
         updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), input.accountId, input.guidedTask, input.lastSection, input.now, input.candidateId).run();
    return result.meta.changes === 1;
  }

  async function completeOrganizerOnboarding(input: {
    candidateId: string;
    actorAccountId: string;
    expectedVersion: number;
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    if (!input.admin && !await organizerRole(input.candidateId, input.actorAccountId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const workspace = await getOrganizerWorkspace(input.candidateId, input.actorAccountId);
    if (!workspace) return { ok: false as const, reason: "not_found" as const };
    if (workspace.state.onboarding_completed_at !== null) {
      return { ok: true as const, completedAt: workspace.state.onboarding_completed_at, alreadyCompleted: true };
    }
    const candidate = await getOrganizerCandidate(input.candidateId);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
    }
    const result = await database.prepare(
      `UPDATE organizer_workspace_state
       SET onboarding_completed_at = ?1, onboarding_completed_by = ?2, updated_at = ?1
       WHERE candidate_id = ?3 AND onboarding_completed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM organizer_event_candidates c
           WHERE c.id = organizer_workspace_state.candidate_id AND c.current_version = ?4
         )
         ${input.admin ? "" : `AND EXISTS (
           SELECT 1 FROM organizer_event_grants g
           WHERE g.candidate_id = organizer_workspace_state.candidate_id
             AND g.account_id = ?2 AND g.revoked_at IS NULL
         )`}`,
    ).bind(input.now, input.actorAccountId, input.candidateId, input.expectedVersion).run();
    if (result.meta.changes !== 1) {
      const latestWorkspace = await getOrganizerWorkspace(input.candidateId, input.actorAccountId);
      if (!input.admin && !await organizerRole(input.candidateId, input.actorAccountId)) {
        return { ok: false as const, reason: "forbidden" as const };
      }
      if (latestWorkspace?.state.onboarding_completed_at !== null && latestWorkspace?.state.onboarding_completed_at !== undefined) {
        return {
          ok: true as const,
          completedAt: latestWorkspace.state.onboarding_completed_at,
          alreadyCompleted: true,
        };
      }
      const current = await getOrganizerCandidate(input.candidateId);
      return { ok: false as const, reason: "conflict" as const, currentVersion: current?.current_version ?? input.expectedVersion };
    }
    return { ok: true as const, completedAt: input.now, alreadyCompleted: false };
  }

  async function markOrganizerValidated(candidateId: string, version: number, now: number) {
    await ensureTables();
    // Direct API callers may validate a legacy candidate before loading its
    // workspace detail. Materialize the same binder-compatible state used by
    // getOrganizerWorkspace so the validation marker is never dropped.
    await database.prepare(
      `INSERT OR IGNORE INTO organizer_workspace_state (
         candidate_id, onboarding_completed_at, onboarding_completed_by,
         last_validated_version, created_at, updated_at
       ) SELECT id, updated_at, NULL, NULL, created_at, updated_at
         FROM organizer_event_candidates WHERE id = ?1`,
    ).bind(candidateId).run();
    const result = await database.prepare(
      `UPDATE organizer_workspace_state
       SET last_validated_version = ?1, updated_at = ?2
       WHERE candidate_id = ?3
         AND EXISTS (
           SELECT 1 FROM organizer_event_candidates c
           WHERE c.id = organizer_workspace_state.candidate_id AND c.current_version = ?1
         )`,
    ).bind(version, now, candidateId).run();
    return result.meta.changes === 1;
  }

  /** Owners are invited third parties, not staff, so their invitations need
   * their own budget on top of the per-inbox login-token limit. Counting the
   * rows the actor created is enough: every invitation mints one login token. */
  async function countOrganizerInvitationsSince(invitedBy: string, since: number) {
    await ensureTables();
    const row = await database.prepare(
      "SELECT COUNT(*) AS total FROM organizer_event_invitations WHERE invited_by = ?1 AND created_at >= ?2",
    ).bind(invitedBy, since).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async function listOrganizerCandidateRevisions(candidateId: string) {
    await ensureTables();
    const rows = await database.prepare(
      `SELECT version, event_id, draft_json, created_by, created_by_role, created_at
       FROM organizer_event_revisions WHERE candidate_id = ?1 ORDER BY version`,
    ).bind(candidateId).all<{
      version: number; event_id: string | null; draft_json: string;
      created_by: string; created_by_role: string; created_at: number;
    }>();
    return rows.results;
  }

  async function manageOrganizerCollaborator(input: {
    candidateId: string;
    actorAccountId: string;
    email: string;
    role: OrganizerRole;
    action: "invite" | "revoke";
    now: number;
  }) {
    await ensureTables();
    if (await organizerRole(input.candidateId, input.actorAccountId) !== "owner") {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (input.action === "invite") {
      if (input.role !== "editor") return { ok: false as const, reason: "owner_requires_admin" as const };
      try {
        const result = await database.prepare(
          `INSERT INTO organizer_event_invitations (
             id, candidate_id, email, role, invited_by, created_at
           ) VALUES (?1, ?2, ?3, 'editor', ?4, ?5)`,
        ).bind(crypto.randomUUID(), input.candidateId, input.email, input.actorAccountId, input.now).run();
        return result.meta.changes === 1
          ? { ok: true as const, result: "invited" as const }
          : { ok: false as const, reason: "unchanged" as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique constraint/i.test(message)) return { ok: false as const, reason: "unchanged" as const };
        throw error;
      }
    }
    // An editor who has not signed in yet exists only as an invitation, so the
    // revoke has to succeed on either row. Reporting the grant alone would tell
    // the Owner nothing changed while the pending invitation was in fact
    // withdrawn — see manageOrganizerOwner, which draws the same distinction.
    const [grant, invitation] = await database.batch([
      database.prepare(
        `UPDATE organizer_event_grants SET revoked_by = ?1, revoked_at = ?2
         WHERE candidate_id = ?3 AND role = 'editor' AND revoked_at IS NULL
           AND account_id = (SELECT id FROM accounts WHERE email = ?4)`,
      ).bind(input.actorAccountId, input.now, input.candidateId, input.email),
      database.prepare(
        `UPDATE organizer_event_invitations SET revoked_by = ?1, revoked_at = ?2
         WHERE candidate_id = ?3 AND email = ?4 AND role = 'editor'
           AND accepted_at IS NULL AND revoked_at IS NULL`,
      ).bind(input.actorAccountId, input.now, input.candidateId, input.email),
    ]);
    return grant.meta.changes === 1 || invitation.meta.changes === 1
      ? { ok: true as const, result: "revoked" as const }
      : { ok: false as const, reason: "missing" as const };
  }

  async function manageOrganizerOwner(input: {
    candidateId: string;
    actorAccountId: string;
    email: string;
    action: "invite" | "revoke";
    now: number;
  }) {
    await ensureTables();
    if (!await getOrganizerCandidate(input.candidateId)) return { ok: false as const, reason: "not_found" as const };
    if (input.action === "invite") {
      try {
        const result = await database.prepare(
          `INSERT INTO organizer_event_invitations (
             id, candidate_id, email, role, invited_by, created_at
           ) VALUES (?1, ?2, ?3, 'owner', ?4, ?5)`,
        ).bind(crypto.randomUUID(), input.candidateId, input.email, input.actorAccountId, input.now).run();
        return result.meta.changes === 1
          ? { ok: true as const, result: "invited" as const }
          : { ok: false as const, reason: "unchanged" as const };
      } catch (error) {
        if (error instanceof Error && /unique constraint/i.test(error.message)) return { ok: false as const, reason: "unchanged" as const };
        throw error;
      }
    }
    const target = await database.prepare(
      `SELECT g.account_id FROM organizer_event_grants g JOIN accounts a ON a.id = g.account_id
       WHERE g.candidate_id = ?1 AND g.role = 'owner' AND g.revoked_at IS NULL AND a.email = ?2`,
    ).bind(input.candidateId, input.email).first<{ account_id: string }>();
    if (target) {
      // "At least one Owner survives" is enforced by the write itself, not by a
      // count read before it. Two admins revoking the last two Owners at once
      // would both see a count of two and both proceed, leaving the candidate
      // ownerless; as one statement, the loser of the race matches no row.
      const result = await database.prepare(
        `UPDATE organizer_event_grants SET revoked_by = ?1, revoked_at = ?2
         WHERE candidate_id = ?3 AND account_id = ?4 AND role = 'owner' AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM organizer_event_grants other
             WHERE other.candidate_id = ?3 AND other.role = 'owner'
               AND other.revoked_at IS NULL AND other.account_id <> ?4
           )`,
      ).bind(input.actorAccountId, input.now, input.candidateId, target.account_id).run();
      if (result.meta.changes === 1) return { ok: true as const, result: "revoked" as const };
      // Nothing changed: either the grant went away under us, or it is now the
      // only one left. Re-read to tell the Owner which, rather than guessing.
      const remaining = await database.prepare(
        "SELECT COUNT(*) AS count FROM organizer_event_grants WHERE candidate_id = ?1 AND role = 'owner' AND revoked_at IS NULL",
      ).bind(input.candidateId).first<{ count: number }>();
      return (remaining?.count ?? 0) <= 1
        ? { ok: false as const, reason: "last_owner" as const }
        : { ok: false as const, reason: "missing" as const };
    }
    const invitation = await database.prepare(
      `UPDATE organizer_event_invitations SET revoked_by = ?1, revoked_at = ?2
       WHERE candidate_id = ?3 AND email = ?4 AND role = 'owner'
         AND accepted_at IS NULL AND revoked_at IS NULL`,
    ).bind(input.actorAccountId, input.now, input.candidateId, input.email).run();
    return invitation.meta.changes === 1 ? { ok: true as const, result: "revoked" as const } : { ok: false as const, reason: "missing" as const };
  }

  async function listOrganizerMapDrafts(candidateId: string) {
    await ensureTables();
    const result = await database.prepare(
      `SELECT id, event_id, candidate_id, period_key, venue_space_id, status, current_revision,
              created_at, updated_at, decision_at
       FROM map_drafts WHERE candidate_id = ?1 AND status <> 'withdrawn'
       ORDER BY period_key, venue_space_id, updated_at DESC`,
    ).bind(candidateId).all<{
      id: string; event_id: string; candidate_id: string; period_key: string; venue_space_id: string;
      status: MapDraftStatus; current_revision: number; created_at: number; updated_at: number; decision_at: number | null;
    }>();
    return result.results;
  }

  async function getOrganizerMapDraft(candidateId: string, draftId: string) {
    await ensureTables();
    return database.prepare(
      `SELECT d.id, d.event_id, d.candidate_id, d.period_key, d.venue_space_id,
              d.status, d.current_revision, d.created_at, d.updated_at, d.decision_at, r.content_json
       FROM map_drafts d JOIN map_draft_revisions r
         ON r.draft_id = d.id AND r.revision = d.current_revision
       WHERE d.id = ?1 AND d.candidate_id = ?2 AND d.status <> 'withdrawn'`,
    ).bind(draftId, candidateId).first<{
      id: string; event_id: string; candidate_id: string; period_key: string; venue_space_id: string;
      status: MapDraftStatus; current_revision: number; created_at: number; updated_at: number;
      decision_at: number | null; content_json: string | null;
    }>();
  }

  async function createOrganizerMapDraft(input: {
    id: string;
    candidateId: string;
    periodKey: string;
    venueSpaceId: string;
    actorAccountId: string;
    expectedVersion: number;
    contentJson: string;
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    const [candidate, role] = await Promise.all([
      getOrganizerCandidate(input.candidateId),
      input.admin ? Promise.resolve(null) : organizerRole(input.candidateId, input.actorAccountId),
    ]);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (!input.admin && !role) return { ok: false as const, reason: "forbidden" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
        updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
    }
    if (candidate.status !== "draft" && candidate.status !== "changes_requested") {
      return { ok: false as const, reason: "status" as const, status: candidate.status };
    }
    const nextVersion = input.expectedVersion + 1;
    const actorRole = input.admin ? "admin" : role!;
    try {
      const results = await database.batch([
        database.prepare(
          `UPDATE organizer_event_candidates SET current_version = ?1, updated_at = ?2,
             last_updated_by = ?3, last_updated_role = ?4
           WHERE id = ?5 AND current_version = ?6 AND status IN ('draft', 'changes_requested')
             ${input.admin ? "" : `AND EXISTS (
               SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = organizer_event_candidates.id
                 AND g.account_id = ?3 AND g.revoked_at IS NULL
             )`}`,
        ).bind(nextVersion, input.now, input.actorAccountId, actorRole, input.candidateId, input.expectedVersion),
        database.prepare(
          `INSERT INTO organizer_event_revisions (
             id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at
           ) SELECT ?1, id, current_version, event_id, current_draft_json, ?2, ?3, ?4
             FROM organizer_event_candidates
             WHERE id = ?5 AND current_version = ?6 AND last_updated_by = ?2 AND updated_at = ?4`,
        ).bind(crypto.randomUUID(), input.actorAccountId, actorRole, input.now, input.candidateId, nextVersion),
        database.prepare(
          `INSERT INTO map_drafts (
             id, event_id, candidate_id, period_key, venue_space_id, owner_account_id,
             status, current_revision, created_at, updated_at, last_activity_at
           ) SELECT ?1, COALESCE(event_id, id), id, ?2, ?3, ?4, 'draft', 1, ?5, ?5, ?5
             FROM organizer_event_candidates
             WHERE id = ?6 AND current_version = ?7 AND last_updated_by = ?4 AND updated_at = ?5`,
        ).bind(input.id, input.periodKey, input.venueSpaceId, input.actorAccountId, input.now, input.candidateId, nextVersion),
        database.prepare(
          `INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
           SELECT ?1, id, 1, ?2, ?3, ?4 FROM map_drafts
           WHERE id = ?5 AND candidate_id = ?6 AND current_revision = 1`,
        ).bind(crypto.randomUUID(), input.contentJson, input.actorAccountId, input.now, input.id, input.candidateId),
      ]);
      return results.every((result) => result.meta.changes === 1)
        ? { ok: true as const, version: nextVersion, mapRevision: 1 }
        : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
          updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        return { ok: false as const, reason: "scope_exists" as const };
      }
      throw error;
    }
  }

  async function saveOrganizerMapDraft(input: {
    candidateId: string;
    draftId: string;
    actorAccountId: string;
    expectedVersion: number;
    expectedMapRevision: number;
    contentJson: string;
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    const [candidate, map, role] = await Promise.all([
      getOrganizerCandidate(input.candidateId), getOrganizerMapDraft(input.candidateId, input.draftId),
      input.admin ? Promise.resolve(null) : organizerRole(input.candidateId, input.actorAccountId),
    ]);
    if (!candidate || !map) return { ok: false as const, reason: "not_found" as const };
    if (!input.admin && !role) return { ok: false as const, reason: "forbidden" as const };
    if (candidate.current_version !== input.expectedVersion || map.current_revision !== input.expectedMapRevision) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
        currentMapRevision: map.current_revision, updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
    }
    if ((candidate.status !== "draft" && candidate.status !== "changes_requested")
      || (map.status !== "draft" && map.status !== "changes_requested")) {
      return { ok: false as const, reason: "status" as const, status: candidate.status };
    }
    const nextVersion = input.expectedVersion + 1;
    const nextMapRevision = input.expectedMapRevision + 1;
    const actorRole = input.admin ? "admin" : role!;
    const results = await database.batch([
      database.prepare(
        `UPDATE organizer_event_candidates SET current_version = ?1, updated_at = ?2,
           last_updated_by = ?3, last_updated_role = ?4
         WHERE id = ?5 AND current_version = ?6 AND status IN ('draft', 'changes_requested')
           ${input.admin ? "" : `AND EXISTS (
             SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = organizer_event_candidates.id
               AND g.account_id = ?3 AND g.revoked_at IS NULL
           )`}`,
      ).bind(nextVersion, input.now, input.actorAccountId, actorRole, input.candidateId, input.expectedVersion),
      database.prepare(
        `INSERT INTO organizer_event_revisions (
           id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at
         ) SELECT ?1, id, current_version, event_id, current_draft_json, ?2, ?3, ?4
           FROM organizer_event_candidates
           WHERE id = ?5 AND current_version = ?6 AND last_updated_by = ?2 AND updated_at = ?4`,
      ).bind(crypto.randomUUID(), input.actorAccountId, actorRole, input.now, input.candidateId, nextVersion),
      database.prepare(
        `UPDATE map_drafts SET current_revision = ?1, updated_at = ?2, last_activity_at = ?2
         WHERE id = ?3 AND candidate_id = ?4 AND current_revision = ?5
           AND status IN ('draft', 'changes_requested')`,
      ).bind(nextMapRevision, input.now, input.draftId, input.candidateId, input.expectedMapRevision),
      database.prepare(
        `INSERT INTO map_draft_revisions (id, draft_id, revision, content_json, created_by, created_at)
         SELECT ?1, id, ?2, ?3, ?4, ?5 FROM map_drafts
         WHERE id = ?6 AND candidate_id = ?7 AND current_revision = ?2 AND updated_at = ?5`,
      ).bind(crypto.randomUUID(), nextMapRevision, input.contentJson, input.actorAccountId,
        input.now, input.draftId, input.candidateId),
    ]);
    return results.every((result) => result.meta.changes === 1)
      ? { ok: true as const, version: nextVersion, mapRevision: nextMapRevision }
      : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
        currentMapRevision: map.current_revision, updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
  }

  async function getOrganizerImport(candidateId: string) {
    await ensureTables();
    const source = await database.prepare(
      `SELECT id, candidate_id, candidate_version, file_name, worksheet, sha256,
              source_description, mapping_json, created_by, created_by_role, created_at, replaced_at
       FROM organizer_import_sources
       WHERE candidate_id = ?1 AND replaced_at IS NULL`,
    ).bind(candidateId).first<{
      id: string; candidate_id: string; candidate_version: number; file_name: string; worksheet: string | null;
      sha256: string; source_description: string; mapping_json: string; created_by: string;
      created_by_role: string; created_at: number; replaced_at: number | null;
    }>();
    if (!source) return null;
    const rows = await database.prepare(
      `SELECT id, source_id, candidate_id, source_row, day_id, venue_space_id, area_id,
              booth_code, circle_name, stable_key, identity_group
       FROM organizer_import_rows WHERE source_id = ?1 ORDER BY source_row, id`,
    ).bind(source.id).all<{
      id: string; source_id: string; candidate_id: string; source_row: number; day_id: string;
      venue_space_id: string; area_id: string; booth_code: string; circle_name: string;
      stable_key: string | null; identity_group: string | null;
    }>();
    return { source, rows: rows.results };
  }

  async function replaceOrganizerImport(input: {
    candidateId: string;
    actorAccountId: string;
    expectedVersion: number;
    source: {
      fileName: string;
      worksheet: string | null;
      sha256: string;
      sourceDescription: string;
      mappingJson: string;
    };
    rows: readonly {
      sourceRow: number;
      dayId: string;
      venueSpaceId: string;
      areaId: string;
      boothCode: string;
      circleName: string;
      stableKey: string | null;
      identityGroup: string | null;
    }[];
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    const [candidate, grantRole] = await Promise.all([
      getOrganizerCandidate(input.candidateId),
      input.admin ? Promise.resolve(null) : organizerRole(input.candidateId, input.actorAccountId),
    ]);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (!input.admin && !grantRole) return { ok: false as const, reason: "forbidden" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return {
        ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
        updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role,
      };
    }
    if (candidate.status !== "draft" && candidate.status !== "changes_requested") {
      return { ok: false as const, reason: "status" as const, status: candidate.status };
    }
    const actorRole = input.admin ? "admin" : grantRole!;
    const nextVersion = input.expectedVersion + 1;
    const sourceId = crypto.randomUUID();
    const statements = [
      database.prepare(
        `UPDATE organizer_event_candidates SET current_version = ?1, updated_at = ?2,
           last_updated_by = ?3, last_updated_role = ?4
         WHERE id = ?5 AND current_version = ?6 AND status IN ('draft', 'changes_requested')
           ${input.admin ? "" : `AND EXISTS (
             SELECT 1 FROM organizer_event_grants g
             WHERE g.candidate_id = organizer_event_candidates.id
               AND g.account_id = ?3 AND g.revoked_at IS NULL
           )`}`,
      ).bind(nextVersion, input.now, input.actorAccountId, actorRole, input.candidateId, input.expectedVersion),
      database.prepare(
        `INSERT INTO organizer_event_revisions (
           id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at
         ) SELECT ?1, id, current_version, event_id, current_draft_json, ?2, ?3, ?4
           FROM organizer_event_candidates
           WHERE id = ?5 AND current_version = ?6 AND last_updated_by = ?2 AND updated_at = ?4`,
      ).bind(crypto.randomUUID(), input.actorAccountId, actorRole, input.now, input.candidateId, nextVersion),
      database.prepare(
        "UPDATE organizer_import_sources SET replaced_at = ?1 WHERE candidate_id = ?2 AND replaced_at IS NULL",
      ).bind(input.now, input.candidateId),
      database.prepare(
        `INSERT INTO organizer_import_sources (
           id, candidate_id, candidate_version, file_name, worksheet, sha256, source_description,
           mapping_json, created_by, created_by_role, created_at
         ) SELECT ?1, id, current_version, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
           FROM organizer_event_candidates
           WHERE id = ?10 AND current_version = ?11 AND last_updated_by = ?7 AND updated_at = ?9`,
      ).bind(sourceId, input.source.fileName, input.source.worksheet, input.source.sha256,
        input.source.sourceDescription, input.source.mappingJson, input.actorAccountId, actorRole,
        input.now, input.candidateId, nextVersion),
      // JSON1 avoids one D1 prepared statement per booth row, but D1 binds each
      // parameter whole, so the entire booth list as a single JSON array would
      // outgrow the statement limit well before the API's 20,000-row cap. The
      // rows are chunked instead: each bound value stays small while the batch
      // remains one transaction, so a partial import still cannot land.
      // The raw workbook never reaches this boundary; these parameters contain
      // only the normalized fields the organizer confirmed.
      ...chunked(input.rows, 500).map((chunk) => database.prepare(
        `INSERT INTO organizer_import_rows (
           id, source_id, candidate_id, source_row, day_id, venue_space_id, area_id,
           booth_code, circle_name, stable_key, identity_group
         ) SELECT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
             substr(lower(hex(randomblob(2))), 2) || '-' ||
             substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
             lower(hex(randomblob(6))),
           ?1, source.candidate_id,
           CAST(json_extract(item.value, '$.sourceRow') AS INTEGER),
           json_extract(item.value, '$.dayId'), json_extract(item.value, '$.venueSpaceId'),
           json_extract(item.value, '$.areaId'), json_extract(item.value, '$.boothCode'),
           json_extract(item.value, '$.circleName'), json_extract(item.value, '$.stableKey'),
           json_extract(item.value, '$.identityGroup')
         FROM organizer_import_sources source, json_each(?2) item
         WHERE source.id = ?1 AND source.replaced_at IS NULL`,
      ).bind(sourceId, JSON.stringify(chunk))),
    ];
    const results = await database.batch(statements);
    // Replacing an import before one exists legitimately changes zero old rows;
    // every metadata statement must establish its exact row, while the row
    // inserts together must establish exactly the normalized row count.
    const metadataEstablished = [0, 1, 3].every((index) => results[index].meta.changes === 1);
    const inserted = results.slice(4).reduce((total, result) => total + result.meta.changes, 0);
    return metadataEstablished && inserted === input.rows.length
      ? { ok: true as const, version: nextVersion }
      : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
        updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
  }

  async function saveOrganizerCandidate(input: {
    candidateId: string;
    actorAccountId: string;
    expectedVersion: number;
    eventId: string | null;
    draftJson: string;
    now: number;
    admin?: boolean;
  }) {
    await ensureTables();
    const [candidate, grantRole] = await Promise.all([
      getOrganizerCandidate(input.candidateId),
      input.admin ? Promise.resolve(null) : organizerRole(input.candidateId, input.actorAccountId),
    ]);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (!input.admin && !grantRole) return { ok: false as const, reason: "forbidden" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return {
        ok: false as const,
        reason: "conflict" as const,
        currentVersion: candidate.current_version,
        updatedAt: candidate.updated_at,
        updatedByRole: candidate.last_updated_role,
      };
    }
    if (candidate.status !== "draft" && candidate.status !== "changes_requested") {
      return { ok: false as const, reason: "status" as const, status: candidate.status };
    }
    if (candidate.event_id_locked_at !== null && candidate.event_id !== input.eventId) {
      return { ok: false as const, reason: "event_id_locked" as const, eventId: candidate.event_id };
    }
    const actorRole = input.admin ? "admin" : grantRole!;
    const nextVersion = input.expectedVersion + 1;
    try {
      const update = database.prepare(
        `UPDATE organizer_event_candidates SET
           event_id = ?1, current_version = ?2, current_draft_json = ?3,
           updated_at = ?4, last_updated_by = ?5, last_updated_role = ?6
         WHERE id = ?7 AND current_version = ?8
           AND status IN ('draft', 'changes_requested')
           AND (event_id_locked_at IS NULL OR event_id = ?1)
           ${input.admin ? "" : `AND EXISTS (
             SELECT 1 FROM organizer_event_grants g
             WHERE g.candidate_id = organizer_event_candidates.id
               AND g.account_id = ?5 AND g.revoked_at IS NULL
           )`}`,
      ).bind(input.eventId, nextVersion, input.draftJson, input.now, input.actorAccountId, actorRole,
        input.candidateId, input.expectedVersion);
      // Keep revision creation in the same D1 transaction as the optimistic
      // update. The INSERT can only see the version installed above.
      const results = await database.batch([
        update,
        database.prepare(
          `INSERT INTO organizer_event_revisions (
             id, candidate_id, version, event_id, draft_json, created_by, created_by_role, created_at
           ) SELECT ?1, id, current_version, event_id, current_draft_json, ?2, ?3, ?4
             FROM organizer_event_candidates
             WHERE id = ?5 AND current_version = ?6 AND last_updated_by = ?2 AND updated_at = ?4`,
        ).bind(crypto.randomUUID(), input.actorAccountId, actorRole, input.now, input.candidateId, nextVersion),
      ]);
      return results.every((result) => result.meta.changes === 1)
        ? { ok: true as const, version: nextVersion }
        : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version,
          updatedAt: candidate.updated_at, updatedByRole: candidate.last_updated_role };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/organizer_event_candidates\.event_id|unique constraint/i.test(message)) {
        return { ok: false as const, reason: "event_id_taken" as const };
      }
      throw error;
    }
  }

  async function submitOrganizerCandidate(input: {
    candidateId: string;
    actorAccountId: string;
    expectedVersion: number;
    now: number;
  }) {
    await ensureTables();
    const [candidate, role] = await Promise.all([
      getOrganizerCandidate(input.candidateId), organizerRole(input.candidateId, input.actorAccountId),
    ]);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (role !== "owner") return { ok: false as const, reason: "forbidden" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
    }
    if (!candidate.event_id) return { ok: false as const, reason: "event_id_required" as const };
    const result = await database.prepare(
      `UPDATE organizer_event_candidates SET
         status = 'submitted', event_id_locked_at = COALESCE(event_id_locked_at, ?1),
         submitted_by = ?2, submitted_at = ?1, updated_at = ?1,
         last_updated_by = ?2, last_updated_role = 'owner'
       WHERE id = ?3 AND current_version = ?4 AND status IN ('draft', 'changes_requested')
         AND EXISTS (
           SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = organizer_event_candidates.id
             AND g.account_id = ?2 AND g.role = 'owner' AND g.revoked_at IS NULL
         )`,
    ).bind(input.now, input.actorAccountId, input.candidateId, input.expectedVersion).run();
    return result.meta.changes === 1
      ? { ok: true as const, status: "submitted" as const }
      : { ok: false as const, reason: "status" as const };
  }

  async function reviewOrganizerCandidate(input: {
    candidateId: string;
    expectedVersion: number;
    decision: "changes_requested" | "approve";
    actorAccountId: string;
    note?: string;
    now: number;
  }) {
    await ensureTables();
    const candidate = await getOrganizerCandidate(input.candidateId);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (candidate.current_version !== input.expectedVersion) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
    }
    if (candidate.status !== "submitted") return { ok: false as const, reason: "status" as const, status: candidate.status };
    const status = input.decision === "approve" ? "approved" : "changes_requested";
    const transitionToken = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `UPDATE organizer_event_candidates SET status = ?1, updated_at = ?2,
           last_updated_by = ?3, last_updated_role = 'admin',
           approved_by = CASE WHEN ?1 = 'approved' THEN ?3 ELSE NULL END,
           approved_at = CASE WHEN ?1 = 'approved' THEN ?2 ELSE NULL END
         WHERE id = ?4 AND current_version = ?5 AND status = 'submitted'`,
      ).bind(status, input.now, input.actorAccountId, input.candidateId, input.expectedVersion),
      database.prepare(
        `INSERT INTO organizer_event_reviews (
           id, candidate_id, version, from_status, to_status, actor_account_id, note, at
         ) SELECT ?1, id, current_version, 'submitted', ?2, ?3, ?4, ?5
           FROM organizer_event_candidates
           WHERE id = ?6 AND current_version = ?7 AND status = ?2
             AND last_updated_by = ?3 AND updated_at = ?5`,
      ).bind(transitionToken, status, input.actorAccountId, input.note ?? null, input.now,
        input.candidateId, input.expectedVersion),
    ]);
    return results.every((result) => result.meta.changes === 1)
      ? { ok: true as const, status }
      : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
  }

  async function storeOrganizerSubmissionSnapshot(input: {
    candidateId: string;
    candidateVersion: number;
    actorAccountId: string;
    snapshotJson: string;
    sha256: string;
    now: number;
  }) {
    await ensureTables();
    if (await organizerRole(input.candidateId, input.actorAccountId) !== "owner") {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const candidate = await getOrganizerCandidate(input.candidateId);
    if (!candidate) return { ok: false as const, reason: "not_found" as const };
    if (candidate.current_version !== input.candidateVersion) {
      return { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
    }
    const existing = await database.prepare(
      "SELECT id, sha256 FROM organizer_submission_snapshots WHERE candidate_id = ?1 AND candidate_version = ?2",
    ).bind(input.candidateId, input.candidateVersion).first<{ id: string; sha256: string }>();
    if (existing) return existing.sha256 === input.sha256
      ? { ok: true as const, snapshotId: existing.id, sha256: existing.sha256 }
      : { ok: false as const, reason: "snapshot_mismatch" as const };
    const snapshotId = crypto.randomUUID();
    const result = await database.prepare(
      `INSERT INTO organizer_submission_snapshots (
         id, candidate_id, candidate_version, snapshot_json, sha256, created_by, created_at
       ) SELECT ?1, id, current_version, ?2, ?3, ?4, ?5
         FROM organizer_event_candidates
         WHERE id = ?6 AND current_version = ?7 AND status IN ('draft', 'changes_requested')`,
    ).bind(snapshotId, input.snapshotJson, input.sha256, input.actorAccountId, input.now,
      input.candidateId, input.candidateVersion).run();
    return result.meta.changes === 1
      ? { ok: true as const, snapshotId, sha256: input.sha256 }
      : { ok: false as const, reason: "conflict" as const, currentVersion: candidate.current_version };
  }

  async function getOrganizerSubmissionSnapshot(candidateId: string, candidateVersion: number) {
    await ensureTables();
    return database.prepare(
      `SELECT id, candidate_id, candidate_version, snapshot_json, sha256, created_by, created_at
       FROM organizer_submission_snapshots WHERE candidate_id = ?1 AND candidate_version = ?2`,
    ).bind(candidateId, candidateVersion).first<{
      id: string; candidate_id: string; candidate_version: number; snapshot_json: string;
      sha256: string; created_by: string; created_at: number;
    }>();
  }

  async function createOrganizerPublicationJob(input: {
    candidateId: string;
    candidateVersion: number;
    snapshotId: string;
    approvalHash: string;
    now: number;
  }) {
    await ensureTables();
    const existing = await database.prepare(
      "SELECT id, approval_hash FROM organizer_publication_jobs WHERE candidate_id = ?1 AND candidate_version = ?2",
    ).bind(input.candidateId, input.candidateVersion).first<{ id: string; approval_hash: string }>();
    if (existing) return existing.approval_hash === input.approvalHash
      ? { ok: true as const, jobId: existing.id, existing: true as const }
      : { ok: false as const, reason: "approval_mismatch" as const };
    const jobId = crypto.randomUUID();
    const result = await database.prepare(
      `INSERT INTO organizer_publication_jobs (
         id, candidate_id, candidate_version, snapshot_id, approval_hash, status, step, created_at, updated_at
       ) SELECT ?1, c.id, ?2, s.id, s.sha256, 'queued', 'assemble', ?3, ?3
         FROM organizer_event_candidates c JOIN organizer_submission_snapshots s
           ON s.candidate_id = c.id AND s.candidate_version = ?2
         WHERE c.id = ?4 AND c.status = 'approved' AND c.current_version = ?2
           AND s.id = ?5 AND s.sha256 = ?6`,
    ).bind(jobId, input.candidateVersion, input.now, input.candidateId,
      input.snapshotId, input.approvalHash).run();
    return result.meta.changes === 1
      ? { ok: true as const, jobId, existing: false as const }
      : { ok: false as const, reason: "conflict" as const };
  }

  async function getOrganizerPublicationJob(jobId: string) {
    await ensureTables();
    return database.prepare(
      `SELECT * FROM organizer_publication_jobs WHERE id = ?1`,
    ).bind(jobId).first<{
      id: string; candidate_id: string; candidate_version: number; snapshot_id: string; approval_hash: string;
      status: string; step: string; data_pr_number: number | null; data_head_sha: string | null;
      data_merge_sha: string | null; main_pr_number: number | null; main_head_sha: string | null;
      main_merge_sha: string | null; workflow_run_id: number | null; error: string | null;
      created_at: number; updated_at: number;
    }>();
  }

  async function getLatestOrganizerPublicationJob(candidateId: string) {
    await ensureTables();
    return database.prepare(
      `SELECT * FROM organizer_publication_jobs WHERE candidate_id = ?1
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<{
      id: string; candidate_id: string; candidate_version: number; snapshot_id: string; approval_hash: string;
      status: string; step: string; data_pr_number: number | null; data_head_sha: string | null;
      data_merge_sha: string | null; main_pr_number: number | null; main_head_sha: string | null;
      main_merge_sha: string | null; workflow_run_id: number | null; error: string | null;
      created_at: number; updated_at: number;
    }>();
  }

  async function retryOrganizerPublicationJob(input: { jobId: string; now: number }) {
    await ensureTables();
    const job = await getOrganizerPublicationJob(input.jobId);
    if (!job) return { ok: false as const, reason: "not_found" as const };
    if (job.status !== "failed") return { ok: false as const, reason: "status" as const, status: job.status };
    const results = await database.batch([
      database.prepare(
        `DELETE FROM organizer_publication_lease WHERE id = 'global' AND job_id = ?1
           AND EXISTS (SELECT 1 FROM organizer_publication_jobs WHERE id = ?1 AND status = 'failed')`,
      ).bind(input.jobId),
      database.prepare(
        `UPDATE organizer_publication_jobs SET status = 'queued', error = NULL, updated_at = ?1
         WHERE id = ?2 AND status = 'failed' AND step = ?3`,
      ).bind(input.now, input.jobId, job.step),
    ]);
    return results[1].meta.changes === 1
      ? { ok: true as const, step: job.step }
      : { ok: false as const, reason: "status" as const, status: job.status };
  }

  async function claimOrganizerPublicationLease(input: { jobId: string; now: number; ttlMs: number }) {
    await ensureTables();
    const token = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `INSERT INTO organizer_publication_lease (id, job_id, token, acquired_at, expires_at)
         VALUES ('global', ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, token = excluded.token,
           acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
         WHERE organizer_publication_lease.expires_at <= ?3`,
      ).bind(input.jobId, token, input.now, input.now + input.ttlMs),
      database.prepare(
        `UPDATE organizer_publication_jobs SET status = 'publishing', updated_at = ?1, error = NULL
         WHERE id = ?2 AND status IN ('queued', 'failed')
           AND EXISTS (SELECT 1 FROM organizer_publication_lease WHERE id = 'global' AND job_id = ?2 AND token = ?3)`,
      ).bind(input.now, input.jobId, token),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1
      ? { ok: true as const, token, expiresAt: input.now + input.ttlMs }
      : { ok: false as const, reason: "busy" as const };
  }

  async function updateOrganizerPublicationJob(input: {
    jobId: string;
    leaseToken: string;
    expectedStep: string;
    nextStep: string;
    status: "publishing" | "published" | "failed";
    expectedHeadSha?: string | null;
    error?: string | null;
    now: number;
  }) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE organizer_publication_jobs SET step = ?1, status = ?2, error = ?3, updated_at = ?4
       WHERE id = ?5 AND step = ?6
         AND (?7 IS NULL OR data_head_sha = ?7 OR main_head_sha = ?7)
         AND EXISTS (SELECT 1 FROM organizer_publication_lease
           WHERE id = 'global' AND job_id = ?5 AND token = ?8 AND expires_at > ?4)`,
    ).bind(input.nextStep, input.status, input.error ?? null, input.now, input.jobId,
      input.expectedStep, input.expectedHeadSha ?? null, input.leaseToken).run();
    if (result.meta.changes !== 1) return false;
    if (input.status === "published") {
      await database.batch([
        database.prepare("DELETE FROM organizer_publication_lease WHERE id = 'global' AND job_id = ?1 AND token = ?2")
          .bind(input.jobId, input.leaseToken),
        database.prepare(
          `UPDATE organizer_event_candidates SET status = 'published', published_version = current_version,
             published_at = ?1, updated_at = ?1, last_updated_role = 'system'
           WHERE id = (SELECT candidate_id FROM organizer_publication_jobs WHERE id = ?2)
             AND current_version = (SELECT candidate_version FROM organizer_publication_jobs WHERE id = ?2)`,
        ).bind(input.now, input.jobId),
      ]);
    }
    return true;
  }

  async function recordGitHubWebhookDelivery(input: {
    deliveryId: string; event: string; payloadSha256: string; now: number;
  }) {
    await ensureTables();
    try {
      const result = await database.prepare(
        `INSERT INTO github_webhook_deliveries (delivery_id, event, payload_sha256, received_at)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(input.deliveryId, input.event, input.payloadSha256, input.now).run();
      return result.meta.changes === 1 ? "recorded" as const : "duplicate" as const;
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        const existing = await database.prepare(
          "SELECT payload_sha256, processed_at, result FROM github_webhook_deliveries WHERE delivery_id = ?1",
        ).bind(input.deliveryId).first<{ payload_sha256: string; processed_at: number | null; result: string | null }>();
        if (!existing || existing.payload_sha256 !== input.payloadSha256) return "mismatch" as const;
        return existing.processed_at !== null && existing.result === "processed"
          ? "duplicate" as const
          : "recorded" as const;
      }
      throw error;
    }
  }

  async function completeGitHubWebhookDelivery(input: { deliveryId: string; processed: boolean; result?: string; now: number }) {
    await ensureTables();
    const result = await database.prepare(
      `UPDATE github_webhook_deliveries
       SET processed_at = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END, result = ?3
       WHERE delivery_id = ?4`,
    ).bind(input.processed ? 1 : 0, input.now,
      input.processed ? "processed" : `failed:${(input.result ?? "unknown").slice(0, 500)}`,
      input.deliveryId).run();
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
      "github_webhook_deliveries", "organizer_publication_lease", "organizer_publication_jobs", "organizer_submission_snapshots",
      "organizer_import_rows", "organizer_import_sources", "organizer_event_reviews", "organizer_event_invitations", "organizer_event_grants", "organizer_event_revisions", "organizer_workspace_preferences", "organizer_workspace_state", "organizer_event_candidates",
      "map_draft_exports", "map_draft_files", "map_draft_reviews", "map_draft_comments", "map_draft_revisions", "map_drafts", "map_contributor_grants",
      "login_tokens", "sessions", "circle_claims", "circle_overrides", "overrides_doc", "audit_log", "preview_mail_sink", "accounts",
    ].map((table) => database.prepare(`DELETE FROM ${table}`)));
  }

  return {
    ensureTables, writeAudit,
    listAdmins, isAdminEmail, addAdmin, removeAdmin,
    countLoginTokensSince, createLoginToken, consumeLoginToken, consumeLoginTokenDetails,
    upsertAccount, createSession, getSession, revokeSession, disableAccount, beginAccountDeletion, isAccountWritable, deleteAccount,
    listSoleOwnerOrganizerCandidates,
    listHostedThumbnailKeysForAccount, listHostedThumbnailKeys, listUnsubmittedMapDraftObjectKeysForAccount,
    createClaim, getClaim, withdrawClaim, listClaimsForAccount, listClaimScopesForAccount, listClaimsByStatus,
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
    organizerRole, hasOrganizerAccess, createOrganizerCandidate, acceptOrganizerInvitations,
    countOrganizerInvitationsSince,
    listOrganizerCandidatesForAccount, getOrganizerCandidate, listOrganizerCandidateRevisions,
    getOrganizerWorkspace, saveOrganizerWorkspacePreference, completeOrganizerOnboarding, markOrganizerValidated,
    manageOrganizerCollaborator, manageOrganizerOwner,
    listOrganizerMapDrafts, getOrganizerMapDraft, createOrganizerMapDraft, saveOrganizerMapDraft,
    getOrganizerImport, replaceOrganizerImport,
    saveOrganizerCandidate, submitOrganizerCandidate, reviewOrganizerCandidate,
    storeOrganizerSubmissionSnapshot, getOrganizerSubmissionSnapshot,
    createOrganizerPublicationJob, getOrganizerPublicationJob, getLatestOrganizerPublicationJob,
    retryOrganizerPublicationJob, claimOrganizerPublicationLease,
    updateOrganizerPublicationJob, recordGitHubWebhookDelivery, completeGitHubWebhookDelivery,
    storePreviewMail, latestPreviewMail, clearPreviewData,
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
