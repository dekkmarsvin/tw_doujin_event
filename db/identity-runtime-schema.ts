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
    "deletion_started_at INTEGER",
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
    "audience TEXT NOT NULL DEFAULT 'circle'",
    // NULL means the inbox asked for this link itself. An account id means
    // someone else minted it by inviting that address, which has to be budgeted
    // separately: otherwise an inviter can spend the invitee's hourly quota and
    // lock them out of the account they already have.
    "minted_by TEXT",
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
    // Content-addressed R2 object currently owned by this row. The public URL
    // remains in fields_json; the key is operational metadata used for cleanup.
    "hosted_thumbnail_key TEXT",
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
  table("map_contributor_grants", [
    "account_id TEXT PRIMARY KEY NOT NULL",
    "granted_by TEXT NOT NULL",
    "granted_at INTEGER NOT NULL",
    "revoked_by TEXT",
    "revoked_at INTEGER",
    "suspended_by TEXT",
    "suspended_at INTEGER",
  ]),
  table("map_drafts", [
    "id TEXT PRIMARY KEY NOT NULL",
    "event_id TEXT NOT NULL",
    // Organizer authoring uses the same immutable map revision module, but its
    // unpublished identity is a candidate rather than an eventId.
    "candidate_id TEXT",
    "period_key TEXT NOT NULL",
    "venue_space_id TEXT NOT NULL",
    "owner_account_id TEXT NOT NULL",
    "status TEXT NOT NULL DEFAULT 'draft'",
    "current_revision INTEGER NOT NULL DEFAULT 1",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
    "last_activity_at INTEGER NOT NULL",
    "decision_at INTEGER",
    // Correlates the state update and immutable review insert in one D1 batch.
    // A timestamp is not sufficient because two requests can share a millisecond.
    "transition_token TEXT",
    // Non-NULL means retention has atomically claimed the draft. Contributor
    // writes stop until the idempotent R2/D1 cleanup completes or retries.
    "retention_action TEXT",
  ]),
  table("map_draft_revisions", [
    "id TEXT PRIMARY KEY NOT NULL",
    "draft_id TEXT NOT NULL",
    "revision INTEGER NOT NULL",
    "content_json TEXT",
    "created_by TEXT",
    "created_at INTEGER NOT NULL",
  ]),
  table("map_draft_reviews", [
    "id TEXT PRIMARY KEY NOT NULL",
    "draft_id TEXT NOT NULL",
    "revision INTEGER NOT NULL",
    "from_status TEXT NOT NULL",
    "to_status TEXT NOT NULL",
    "actor_account_id TEXT",
    "actor_role TEXT NOT NULL",
    "note TEXT",
    "at INTEGER NOT NULL",
  ]),
  /** Review discussion, kept apart from the state-machine trail in
   * `map_draft_reviews`. That table is read as an audit source by retention and
   * by account deletion, and folding free-form discussion into it would make
   * "how long must this row be kept" depend on which kind of row it is.
   *
   * A comment with a `target_kind` is a request to change one element rather
   * than the draft as a whole; `target_ref` is the booth code or landmark id it
   * points at. Both are null for a comment about the whole draft. */
  table("map_draft_comments", [
    "id TEXT PRIMARY KEY NOT NULL",
    "draft_id TEXT NOT NULL",
    "revision INTEGER NOT NULL",
    "author_account_id TEXT",
    "author_role TEXT NOT NULL",
    "target_kind TEXT",
    "target_ref TEXT",
    "body TEXT NOT NULL",
    "at INTEGER NOT NULL",
  ]),
  table("map_draft_files", [
    "id TEXT PRIMARY KEY NOT NULL",
    "draft_id TEXT NOT NULL",
    "revision INTEGER NOT NULL",
    "object_key TEXT",
    "source_url TEXT NOT NULL",
    "document_date TEXT NOT NULL",
    "page_number INTEGER",
    "sha256 TEXT NOT NULL",
    "mime TEXT NOT NULL",
    "size_bytes INTEGER NOT NULL",
    "width INTEGER",
    "height INTEGER",
    "page_count INTEGER",
    "uploaded_by TEXT",
    "uploaded_at INTEGER NOT NULL",
    "review_result TEXT",
    "raw_deleted_at INTEGER",
  ]),
  table("map_draft_exports", [
    "id TEXT PRIMARY KEY NOT NULL",
    "draft_id TEXT NOT NULL",
    "revision INTEGER NOT NULL",
    "target_path TEXT NOT NULL",
    "candidate_json TEXT NOT NULL",
    "diff_json TEXT NOT NULL",
    "candidate_sha256 TEXT NOT NULL",
    "created_by TEXT",
    "created_at INTEGER NOT NULL",
  ]),
  table("organizer_event_candidates", [
    "id TEXT PRIMARY KEY NOT NULL",
    "tentative_name TEXT NOT NULL",
    "event_id TEXT",
    "event_id_locked_at INTEGER",
    "status TEXT NOT NULL DEFAULT 'draft'",
    "current_version INTEGER NOT NULL DEFAULT 1",
    "current_draft_json TEXT NOT NULL",
    "created_by TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
    "last_updated_by TEXT NOT NULL",
    "last_updated_role TEXT NOT NULL",
    "submitted_by TEXT",
    "submitted_at INTEGER",
    "approved_by TEXT",
    "approved_at INTEGER",
    "published_version INTEGER",
    "published_at INTEGER",
  ]),
  table("organizer_workspace_state", [
    "candidate_id TEXT PRIMARY KEY NOT NULL",
    "onboarding_completed_at INTEGER",
    "onboarding_completed_by TEXT",
    "last_validated_version INTEGER",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
  ]),
  table("organizer_workspace_preferences", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "account_id TEXT NOT NULL",
    "guided_task TEXT NOT NULL DEFAULT 'identity_source'",
    "last_section TEXT NOT NULL DEFAULT 'event'",
    "updated_at INTEGER NOT NULL",
  ]),
  table("organizer_event_revisions", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "version INTEGER NOT NULL",
    "event_id TEXT",
    "draft_json TEXT NOT NULL",
    "created_by TEXT NOT NULL",
    "created_by_role TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
  ]),
  table("organizer_event_grants", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "account_id TEXT NOT NULL",
    "role TEXT NOT NULL",
    "granted_by TEXT NOT NULL",
    "granted_at INTEGER NOT NULL",
    "revoked_by TEXT",
    "revoked_at INTEGER",
  ]),
  table("organizer_event_invitations", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "email TEXT NOT NULL",
    "role TEXT NOT NULL",
    "invited_by TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "accepted_by TEXT",
    "accepted_at INTEGER",
    "revoked_by TEXT",
    "revoked_at INTEGER",
  ]),
  table("organizer_event_reviews", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "version INTEGER NOT NULL",
    "from_status TEXT NOT NULL",
    "to_status TEXT NOT NULL",
    "actor_account_id TEXT NOT NULL",
    "note TEXT",
    "at INTEGER NOT NULL",
  ]),
  table("organizer_import_sources", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "candidate_version INTEGER NOT NULL",
    "file_name TEXT NOT NULL",
    "worksheet TEXT",
    "sha256 TEXT NOT NULL",
    "source_description TEXT NOT NULL",
    "mapping_json TEXT NOT NULL",
    "created_by TEXT NOT NULL",
    "created_by_role TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
    "replaced_at INTEGER",
  ]),
  table("organizer_import_rows", [
    "id TEXT PRIMARY KEY NOT NULL",
    "source_id TEXT NOT NULL",
    "candidate_id TEXT NOT NULL",
    "source_row INTEGER NOT NULL",
    "day_id TEXT NOT NULL",
    "venue_space_id TEXT NOT NULL",
    "area_id TEXT NOT NULL",
    "booth_code TEXT NOT NULL",
    "circle_name TEXT NOT NULL",
    "stable_key TEXT",
    "identity_group TEXT",
  ]),
  table("organizer_submission_snapshots", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "candidate_version INTEGER NOT NULL",
    "snapshot_json TEXT NOT NULL",
    "sha256 TEXT NOT NULL",
    "created_by TEXT NOT NULL",
    "created_at INTEGER NOT NULL",
  ]),
  table("organizer_publication_jobs", [
    "id TEXT PRIMARY KEY NOT NULL",
    "candidate_id TEXT NOT NULL",
    "candidate_version INTEGER NOT NULL",
    "snapshot_id TEXT NOT NULL",
    "approval_hash TEXT NOT NULL",
    "status TEXT NOT NULL DEFAULT 'queued'",
    "step TEXT NOT NULL DEFAULT 'assemble'",
    "data_pr_number INTEGER",
    "data_head_sha TEXT",
    "data_merge_sha TEXT",
    "main_pr_number INTEGER",
    "main_head_sha TEXT",
    "main_merge_sha TEXT",
    "workflow_run_id INTEGER",
    "error TEXT",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
  ]),
  table("organizer_publication_lease", [
    "id TEXT PRIMARY KEY NOT NULL",
    "job_id TEXT NOT NULL",
    "token TEXT NOT NULL",
    "acquired_at INTEGER NOT NULL",
    "expires_at INTEGER NOT NULL",
  ]),
  table("github_webhook_deliveries", [
    "delivery_id TEXT PRIMARY KEY NOT NULL",
    "event TEXT NOT NULL",
    "payload_sha256 TEXT NOT NULL",
    "received_at INTEGER NOT NULL",
    "processed_at INTEGER",
    "result TEXT",
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
  index("map_contributor_grants_state_idx", "map_contributor_grants", "revoked_at, suspended_at"),
  index("map_drafts_owner_idx", "map_drafts", "owner_account_id, updated_at"),
  index("map_drafts_scope_idx", "map_drafts", "event_id, period_key, venue_space_id, updated_at"),
  index("map_drafts_candidate_scope_idx", "map_drafts", "candidate_id, period_key, venue_space_id, updated_at"),
  index("map_drafts_candidate_active_idx", "map_drafts", "candidate_id, period_key, venue_space_id", { unique: true, where: "candidate_id IS NOT NULL AND status <> 'withdrawn'" }),
  index("map_drafts_one_active_approved_idx", "map_drafts", "event_id, period_key, venue_space_id", { unique: true, where: "status IN ('approved', 'exported')" }),
  index("map_draft_revisions_key_idx", "map_draft_revisions", "draft_id, revision", { unique: true }),
  index("map_draft_reviews_draft_idx", "map_draft_reviews", "draft_id, at"),
  index("map_draft_comments_draft_idx", "map_draft_comments", "draft_id, at"),
  index("map_draft_files_draft_idx", "map_draft_files", "draft_id, revision"),
  index("map_draft_files_object_idx", "map_draft_files", "object_key", { unique: true, where: "object_key IS NOT NULL" }),
  index("map_draft_exports_key_idx", "map_draft_exports", "draft_id, revision", { unique: true }),
  index("organizer_candidates_event_id_idx", "organizer_event_candidates", "event_id", { unique: true, where: "event_id IS NOT NULL" }),
  index("organizer_candidates_status_idx", "organizer_event_candidates", "status, updated_at"),
  index("organizer_workspace_preferences_key_idx", "organizer_workspace_preferences", "candidate_id, account_id", { unique: true }),
  index("organizer_workspace_preferences_account_idx", "organizer_workspace_preferences", "account_id, updated_at"),
  index("organizer_revisions_key_idx", "organizer_event_revisions", "candidate_id, version", { unique: true }),
  index("organizer_grants_account_idx", "organizer_event_grants", "account_id, revoked_at, candidate_id"),
  index("organizer_grants_key_idx", "organizer_event_grants", "candidate_id, account_id", { unique: true }),
  index("organizer_invitations_email_idx", "organizer_event_invitations", "email, accepted_at, revoked_at"),
  index("organizer_invitations_active_idx", "organizer_event_invitations", "candidate_id, email", { unique: true, where: "accepted_at IS NULL AND revoked_at IS NULL" }),
  index("organizer_reviews_candidate_idx", "organizer_event_reviews", "candidate_id, at"),
  index("organizer_import_sources_candidate_idx", "organizer_import_sources", "candidate_id, created_at"),
  index("organizer_import_sources_active_idx", "organizer_import_sources", "candidate_id", { unique: true, where: "replaced_at IS NULL" }),
  index("organizer_import_rows_source_idx", "organizer_import_rows", "source_id, source_row"),
  index("organizer_import_rows_placement_idx", "organizer_import_rows", "candidate_id, day_id, venue_space_id, booth_code"),
  index("organizer_snapshots_key_idx", "organizer_submission_snapshots", "candidate_id, candidate_version", { unique: true }),
  index("organizer_snapshots_hash_idx", "organizer_submission_snapshots", "sha256", { unique: true }),
  index("organizer_publication_candidate_idx", "organizer_publication_jobs", "candidate_id, candidate_version", { unique: true }),
  index("organizer_publication_queue_idx", "organizer_publication_jobs", "status, created_at"),
] as const;

/** Deliberately not exported as one list. Tables and indexes cannot be created
 * in a single pass: an index over a column that arrives through
 * `IDENTITY_COLUMN_MIGRATIONS` must wait for that ALTER to run. Consumers take
 * `IDENTITY_TABLES`, `IDENTITY_COLUMN_MIGRATIONS` and `IDENTITY_INDEXES` in
 * that order — see `ensureTables()`. */

/**
 * Columns added after a table already existed. SQLite has no `ADD COLUMN IF
 * NOT EXISTS`, so duplicate-column errors are the idempotent success case.
 */
export const IDENTITY_COLUMN_MIGRATIONS = [
  { table: "accounts", column: "deletion_started_at", sql: "ALTER TABLE accounts ADD COLUMN deletion_started_at INTEGER" },
  { table: "login_tokens", column: "audience", sql: "ALTER TABLE login_tokens ADD COLUMN audience TEXT NOT NULL DEFAULT 'circle'" },
  { table: "login_tokens", column: "minted_by", sql: "ALTER TABLE login_tokens ADD COLUMN minted_by TEXT" },
  { table: "circle_overrides", column: "post_event_hidden", sql: "ALTER TABLE circle_overrides ADD COLUMN post_event_hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "circle_overrides", column: "retention_choice", sql: "ALTER TABLE circle_overrides ADD COLUMN retention_choice TEXT" },
  { table: "circle_overrides", column: "retention_expires_at", sql: "ALTER TABLE circle_overrides ADD COLUMN retention_expires_at INTEGER" },
  { table: "circle_overrides", column: "hosted_thumbnail_key", sql: "ALTER TABLE circle_overrides ADD COLUMN hosted_thumbnail_key TEXT" },
  { table: "overrides_doc", column: "phase", sql: "ALTER TABLE overrides_doc ADD COLUMN phase TEXT NOT NULL DEFAULT 'during'" },
  { table: "audit_log", column: "shredded_at", sql: "ALTER TABLE audit_log ADD COLUMN shredded_at INTEGER" },
  { table: "map_drafts", column: "transition_token", sql: "ALTER TABLE map_drafts ADD COLUMN transition_token TEXT" },
  { table: "map_drafts", column: "retention_action", sql: "ALTER TABLE map_drafts ADD COLUMN retention_action TEXT" },
  { table: "map_drafts", column: "candidate_id", sql: "ALTER TABLE map_drafts ADD COLUMN candidate_id TEXT" },
] as const;
