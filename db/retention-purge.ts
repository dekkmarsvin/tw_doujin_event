/**
 * Scheduled purge of expired credentials.
 *
 * Deliberately not a method on `createIdentityRepository`: every function
 * there awaits `ensureTables()`, which creates the schema and seeds the admin
 * roster. This code runs in a separate Worker whose only job is deletion
 * (ADR-0022), and a purge that can create a database is a purge that can
 * resurrect one. It therefore reads `sqlite_master` first and skips whatever
 * is not already there.
 *
 * Retention values come from ADR-0021: credentials expire and are purged,
 * records are kept.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The window the login rate limiter counts over — 5 per address and 20 per IP
 * per hour, counted as rows in `login_tokens` with `created_at >= now - 1h`.
 * The token retention window has to clear this, or purging would hand an
 * attacker a fresh quota. This is the reason a consumed token is not deleted
 * on use.
 */
export const LOGIN_RATE_LIMIT_WINDOW_MS = HOUR_MS;

export const RETENTION_WINDOWS = {
  /** From creation. Well past the 15-minute token TTL and the limiter window. */
  loginTokens: 24 * HOUR_MS,
  /** After the session expires or is revoked, whichever applies. */
  sessions: 7 * DAY_MS,
  /** Preview only, and the one place that holds the text of a sent mail. */
  previewMailSink: 7 * DAY_MS,
} as const;

export type RetentionWindows = typeof RETENTION_WINDOWS;

export type PurgeSummary = {
  at: number;
  deleted: { login_tokens: number; sessions: number; preview_mail_sink: number };
  /** Tables that do not exist here. Preview and production hold the same
   * schema, but a database no Function has touched yet holds none of it. */
  skipped: string[];
};

const PURGE_TABLES = ["login_tokens", "sessions", "preview_mail_sink", "audit_log"] as const;

async function existingTables(database: D1Database) {
  const result = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?1, ?2, ?3, ?4)`)
    .bind(...PURGE_TABLES)
    .all<{ name: string }>();
  return new Set(result.results.map((row) => row.name));
}

/** Conditional delete in SQL. Pulling rows into JS to loop over them would
 * spend the free plan's 10 ms of CPU per invocation; waiting on D1 does not. */
async function deleteWhere(database: D1Database, sql: string, cutoff: number) {
  const result = await database.prepare(sql).bind(cutoff).run();
  return result.meta.changes ?? 0;
}

/**
 * Deletes what is past its retention window and returns what it did.
 *
 * `now` is a parameter rather than a call to the clock so tests can drive it.
 */
export async function purgeExpiredRecords(
  database: D1Database,
  now: number,
  windows: RetentionWindows = RETENTION_WINDOWS,
): Promise<PurgeSummary> {
  if (windows.loginTokens <= LOGIN_RATE_LIMIT_WINDOW_MS) {
    throw new Error("login token retention must outlast the rate-limit window, or purging resets the quota.");
  }

  const present = await existingTables(database);
  const deleted = { login_tokens: 0, sessions: 0, preview_mail_sink: 0 };
  const skipped: string[] = [];

  // By `created_at`, the same column the limiter counts — not by `consumed_at`
  // or `expires_at`, which would drop rows the limiter still needs.
  if (present.has("login_tokens")) {
    deleted.login_tokens = await deleteWhere(
      database, `DELETE FROM login_tokens WHERE created_at < ?1`, now - windows.loginTokens,
    );
  } else skipped.push("login_tokens");

  // Expiry and revocation are two clocks; a session revoked early should not
  // wait out its original expiry.
  if (present.has("sessions")) {
    deleted.sessions = await deleteWhere(
      database,
      `DELETE FROM sessions WHERE expires_at < ?1 OR (revoked_at IS NOT NULL AND revoked_at < ?1)`,
      now - windows.sessions,
    );
  } else skipped.push("sessions");

  if (present.has("preview_mail_sink")) {
    deleted.preview_mail_sink = await deleteWhere(
      database, `DELETE FROM preview_mail_sink WHERE created_at < ?1`, now - windows.previewMailSink,
    );
  } else skipped.push("preview_mail_sink");

  if (!present.has("audit_log")) skipped.push("audit_log");
  const summary: PurgeSummary = { at: now, deleted, skipped };

  // Written on every run, including the ones that delete nothing: without it
  // there is no way to answer "is the purge still running?" short of reading
  // the tables it was supposed to have emptied.
  if (present.has("audit_log")) {
    await database.prepare(
      `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
       VALUES (?1, ?2, NULL, 'system', 'retention.purged', 'retention', 'scheduled', ?3, NULL)`,
    ).bind(crypto.randomUUID(), now, JSON.stringify({ deleted, skipped })).run();
  }

  return summary;
}
