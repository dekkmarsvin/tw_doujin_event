import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Circle identity and self-service editing.
 *
 * Times are epoch milliseconds, not `CURRENT_TIMESTAMP` strings: rate limits
 * and token expiry compare against windows, and string timestamps make that a
 * silent correctness hazard.
 */

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  /** NFKC + lowercased before storage so lookups cannot be case-forked. */
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  lastLoginAt: integer("last_login_at"),
  disabledAt: integer("disabled_at"),
}, (table) => [uniqueIndex("accounts_email_idx").on(table.email)]);

export const loginTokens = sqliteTable("login_tokens", {
  id: text("id").primaryKey(),
  /** sha256(raw). The raw value only ever exists in the email and the request. */
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  requestIpHash: text("request_ip_hash"),
}, (table) => [
  uniqueIndex("login_tokens_hash_idx").on(table.tokenHash),
  index("login_tokens_email_idx").on(table.email, table.createdAt),
  index("login_tokens_ip_idx").on(table.requestIpHash, table.createdAt),
  index("login_tokens_expiry_idx").on(table.expiresAt),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [
  index("sessions_account_idx").on(table.accountId),
  index("sessions_expiry_idx").on(table.expiresAt),
]);

export const circleClaims = sqliteTable("circle_claims", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  eventId: text("event_id").notNull(),
  circleId: text("circle_id").notNull(),
  // Recovery breadcrumbs. `circle_id` is a hash of workbook row + name, so it
  // moves whenever the upstream sheet does; these let a claim be re-resolved.
  circleNameKey: text("circle_name_key").notNull(),
  circleNameAtClaim: text("circle_name_at_claim").notNull(),
  sourceRowAtClaim: integer("source_row_at_claim"),
  status: text("status").notNull(),
  method: text("method"),
  targetUrl: text("target_url"),
  challengeTokenHash: text("challenge_token_hash"),
  challengeExpiresAt: integer("challenge_expires_at"),
  challengeAttempts: integer("challenge_attempts").notNull().default(0),
  evidenceUrl: text("evidence_url"),
  evidenceNote: text("evidence_note"),
  createdAt: integer("created_at").notNull(),
  verifiedAt: integer("verified_at"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
}, (table) => [
  uniqueIndex("circle_claims_account_circle_idx").on(table.eventId, table.circleId, table.accountId),
  index("circle_claims_status_idx").on(table.status, table.createdAt),
  index("circle_claims_circle_idx").on(table.eventId, table.circleId),
  index("circle_claims_account_idx").on(table.accountId),
]);

export const circleOverrides = sqliteTable("circle_overrides", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  circleId: text("circle_id").notNull(),
  fieldsJson: text("fields_json").notNull(),
  /** One level of undo, cheaper than a full revision history table. */
  previousFieldsJson: text("previous_fields_json"),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("live"),
  updatedBy: text("updated_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  takedownReason: text("takedown_reason"),
  takendownBy: text("takendown_by"),
  takendownAt: integer("takendown_at"),
}, (table) => [
  uniqueIndex("circle_overrides_key_idx").on(table.eventId, table.circleId),
  index("circle_overrides_live_idx").on(table.eventId, table.status, table.updatedAt),
]);

/** Pre-serialized public overlay: one row read serves an edge-cache miss. */
export const overridesDoc = sqliteTable("overrides_doc", {
  eventId: text("event_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  json: text("json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  at: integer("at").notNull(),
  actorAccountId: text("actor_account_id"),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  detailJson: text("detail_json"),
  ipHash: text("ip_hash"),
}, (table) => [
  index("audit_at_idx").on(table.at),
  index("audit_subject_idx").on(table.subjectType, table.subjectId, table.at),
]);
