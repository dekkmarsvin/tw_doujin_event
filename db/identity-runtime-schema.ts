/**
 * Runtime schema authority for identity, claims and circle-authored overlays.
 *
 * Pages Functions have no deployment migration step (ADR-0009 / issue #6), so
 * the repository creates these objects on first use. Columns and indexes live
 * here once; SQL and schema-verification metadata are generated from the same
 * declarations instead of maintaining a second Drizzle representation.
 */

type RuntimeTable = {
  kind: "table";
  name: string;
  columns: readonly string[];
  columnNames: readonly string[];
  sql: string;
};

type RuntimeIndex = {
  kind: "index";
  name: string;
  table: string;
  sql: string;
};

function columnName(definition: string) {
  const match = /^([a-z_][a-z0-9_]*)\s/i.exec(definition);
  if (!match) throw new Error(`Invalid identity column definition: ${definition}`);
  return match[1];
}

function table(name: string, columns: readonly string[]): RuntimeTable {
  return {
    kind: "table",
    name,
    columns,
    columnNames: columns.map(columnName),
    sql: `CREATE TABLE IF NOT EXISTS ${name} (\n  ${columns.join(",\n  ")}\n)`,
  };
}

function index(name: string, tableName: string, expression: string, options: { unique?: boolean; where?: string } = {}): RuntimeIndex {
  return {
    kind: "index",
    name,
    table: tableName,
    sql: `CREATE ${options.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ON ${tableName}(${expression})${options.where ? ` WHERE ${options.where}` : ""}`,
  };
}

export const IDENTITY_TABLES = [
  table("accounts", [
    "id TEXT PRIMARY KEY NOT NULL",
    "email TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "last_login_at INTEGER",
    "disabled_at INTEGER",
  ]),
  table("admins", [
    "email TEXT PRIMARY KEY NOT NULL",
    "added_by TEXT",
    "added_at INTEGER NOT NULL",
  ]),
  table("login_tokens", [
    "id TEXT PRIMARY KEY NOT NULL",
    "token_hash TEXT NOT NULL",
    "email TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "expires_at INTEGER NOT NULL",
    "consumed_at INTEGER",
    "request_ip_hash TEXT",
  ]),
  table("sessions", [
    "id TEXT PRIMARY KEY NOT NULL",
    "account_id TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "expires_at INTEGER NOT NULL",
    "last_seen_at INTEGER NOT NULL",
    "revoked_at INTEGER",
  ]),
  table("circle_claims", [
    "id TEXT PRIMARY KEY NOT NULL",
    "account_id TEXT NOT NULL",
    "event_id TEXT NOT NULL",
    "circle_id TEXT NOT NULL",
    "circle_name_key TEXT NOT NULL",
    "circle_name_at_claim TEXT NOT NULL",
    "source_row_at_claim INTEGER",
    "status TEXT NOT NULL",
    "method TEXT",
    "target_url TEXT",
    "challenge_token_hash TEXT",
    "challenge_expires_at INTEGER",
    "challenge_attempts INTEGER NOT NULL DEFAULT 0",
    "evidence_url TEXT",
    "evidence_note TEXT",
    "created_at INTEGER NOT NULL",
    "verified_at INTEGER",
    "reviewed_by TEXT",
    "reviewed_at INTEGER",
  ]),
  table("circle_overrides", [
    "id TEXT PRIMARY KEY NOT NULL",
    "event_id TEXT NOT NULL",
    "circle_id TEXT NOT NULL",
    "fields_json TEXT NOT NULL",
    "previous_fields_json TEXT",
    "revision INTEGER NOT NULL DEFAULT 1",
    "status TEXT NOT NULL DEFAULT 'live'",
    "updated_by TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
    "post_event_hidden INTEGER NOT NULL DEFAULT 0",
    // Retention is the circle's own choice (ADR-0018), and deliberately has no
    // DEFAULT: NULL is "has not answered yet", which the portal has to tell
    // apart from an explicit "keep" so it can ask. Absence is never read as a
    // choice to delete. `retention_expires_at` carries the deadline on the row
    // itself — counted from the end of the event, not from the last edit — so
    // an operator can query which rows disappear when without reading code.
    "retention_choice TEXT",
    "retention_expires_at INTEGER",
    "takedown_reason TEXT",
    "takendown_by TEXT",
    "takendown_at INTEGER",
  ]),
  table("overrides_doc", [
    "event_id TEXT PRIMARY KEY NOT NULL",
    "revision INTEGER NOT NULL DEFAULT 1",
    "json TEXT NOT NULL",
    "updated_at INTEGER NOT NULL",
    "phase TEXT NOT NULL DEFAULT 'during'",
  ]),
  table("audit_log", [
    "id TEXT PRIMARY KEY NOT NULL",
    "at INTEGER NOT NULL",
    "actor_account_id TEXT",
    "actor_role TEXT NOT NULL",
    "action TEXT NOT NULL",
    "subject_type TEXT NOT NULL",
    "subject_id TEXT NOT NULL",
    "detail_json TEXT",
    "ip_hash TEXT",
    // Personal fields can be irreversibly removed while the action and time
    // remain as an operational record. NULL means the row is still original.
    "shredded_at INTEGER",
  ]),
  // Used only when the preview environment explicitly selects the D1 mail
  // sink. The production database has the empty table but no route can write
  // to or read it without preview-only environment flags and a separate token.
  table("preview_mail_sink", [
    "id TEXT PRIMARY KEY NOT NULL",
    "email TEXT NOT NULL",
    "subject TEXT NOT NULL",
    "text TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
  ]),
] as const;

export const IDENTITY_INDEXES = [
  index("accounts_email_idx", "accounts", "email", { unique: true }),
  index("login_tokens_hash_idx", "login_tokens", "token_hash", { unique: true }),
  index("login_tokens_email_idx", "login_tokens", "email, created_at"),
  index("login_tokens_ip_idx", "login_tokens", "request_ip_hash, created_at"),
  index("login_tokens_expiry_idx", "login_tokens", "expires_at"),
  index("sessions_account_idx", "sessions", "account_id"),
  index("sessions_expiry_idx", "sessions", "expires_at"),
  index("circle_claims_account_circle_idx", "circle_claims", "event_id, circle_id, account_id", { unique: true }),
  // Security invariant: application checks can race, the partial index cannot.
  index("circle_claims_one_owner_idx", "circle_claims", "event_id, circle_id", { unique: true, where: "status = 'verified'" }),
  index("circle_claims_status_idx", "circle_claims", "status, created_at"),
  index("circle_claims_account_idx", "circle_claims", "account_id"),
  index("circle_overrides_key_idx", "circle_overrides", "event_id, circle_id", { unique: true }),
  index("circle_overrides_live_idx", "circle_overrides", "event_id, status, updated_at"),
  index("audit_at_idx", "audit_log", "at"),
  index("audit_subject_idx", "audit_log", "subject_type, subject_id, at"),
  index("preview_mail_sink_email_idx", "preview_mail_sink", "email, created_at"),
] as const;

export const IDENTITY_SCHEMA_STATEMENTS = [...IDENTITY_TABLES, ...IDENTITY_INDEXES].map(({ sql }) => sql);

/**
 * Columns added after a table already existed. SQLite has no `ADD COLUMN IF
 * NOT EXISTS`, so duplicate-column errors are the idempotent success case.
 */
export const IDENTITY_COLUMN_MIGRATIONS = [
  { table: "circle_overrides", column: "post_event_hidden", sql: "ALTER TABLE circle_overrides ADD COLUMN post_event_hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "circle_overrides", column: "retention_choice", sql: "ALTER TABLE circle_overrides ADD COLUMN retention_choice TEXT" },
  { table: "circle_overrides", column: "retention_expires_at", sql: "ALTER TABLE circle_overrides ADD COLUMN retention_expires_at INTEGER" },
  { table: "overrides_doc", column: "phase", sql: "ALTER TABLE overrides_doc ADD COLUMN phase TEXT NOT NULL DEFAULT 'during'" },
  { table: "audit_log", column: "shredded_at", sql: "ALTER TABLE audit_log ADD COLUMN shredded_at INTEGER" },
] as const;
