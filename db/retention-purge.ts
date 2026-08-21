/**
 * Scheduled purge of expired credentials and of circle content past its
 * deadline.
 *
 * Deliberately not a method on `createIdentityRepository`: every function
 * there awaits `ensureTables()`, which creates the schema and seeds the admin
 * roster. This code runs in a separate Worker whose only job is deletion
 * (ADR-0022), and a purge that can create a database is a purge that can
 * resurrect one. It therefore reads `sqlite_master` first and skips whatever
 * is not already there.
 *
 * Retention values come from ADR-0021: credentials expire and are purged,
 * records are kept. The circle-authored rows are the one thing here whose
 * deadline this module does not own — ADR-0018 hands that choice to the circle,
 * so the row carries its own date and this only enforces it.
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
  /** Audit actions remain, but a per-request network identifier does not. */
  auditIpHashes: 90 * DAY_MS,
} as const;

export type RetentionWindows = typeof RETENTION_WINDOWS;

export type PurgeSummary = {
  at: number;
  deleted: { login_tokens: number; sessions: number; preview_mail_sink: number; circle_overrides: number };
  anonymized: { audit_ip_hashes: number };
  /** Tables that do not exist here. Preview and production hold the same
   * schema, but a database no Function has touched yet holds none of it. */
  skipped: string[];
};

/** Statements per `batch()` when recording a purge. */
const AUDIT_BATCH_SIZE = 100;

const PURGE_TABLES = ["login_tokens", "sessions", "preview_mail_sink", "circle_overrides", "overrides_doc", "audit_log"] as const;

async function existingTables(database: D1Database) {
  const placeholders = PURGE_TABLES.map((_, index) => `?${index + 1}`).join(", ");
  const result = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
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
 * Deletes the circle-authored rows whose own deadline has passed.
 *
 * The deadline is on the row (`retention_expires_at`, written when the circle
 * chose `purge`), not a window this module owns: ADR-0018 gives the choice to
 * the circle, so there is nothing here to configure.
 *
 * `RETURNING` rather than select-then-delete. The published document is derived
 * from these rows and has to lose exactly the ones that went; two statements
 * would leave a window in which a row is deleted but still published.
 *
 * When ADR-0017's hosted thumbnails exist, their bytes have to go in this same
 * operation — a deleted row whose image is still served is the failure this is
 * meant to prevent.
 */
async function purgeExpiredOverrides(database: D1Database, now: number) {
  const purged = await database.prepare(
    `DELETE FROM circle_overrides
     WHERE retention_choice = 'purge' AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?1
     RETURNING event_id, circle_id`,
  ).bind(now).all<{ event_id: string; circle_id: string }>();
  return purged.results;
}

/**
 * Takes the purged circles out of the document readers actually fetch.
 *
 * Filters the stored document rather than rebuilding it from the surviving
 * rows: the phase filter and the serialization live in the repository, and a
 * second copy of them here would drift. Deleting the rows and dropping their
 * entries is the same result by construction.
 *
 * The revision goes up because `/data/events/:eventId/overrides.json` puts it
 * in the ETag. Leaving it alone would let caches keep serving the content that
 * was just deleted from the database.
 */
async function dropFromPublishedDocument(database: D1Database, eventId: string, purgedIds: Set<string>, now: number) {
  const current = await database.prepare(`SELECT revision, json FROM overrides_doc WHERE event_id = ?1`)
    .bind(eventId).first<{ revision: number; json: string }>();
  if (!current) return;

  const document = JSON.parse(current.json) as { overrides: { circleId: string }[] };
  const overrides = document.overrides.filter((override) => !purgedIds.has(override.circleId));
  if (overrides.length === document.overrides.length) return;

  const revision = current.revision + 1;
  await database.prepare(`UPDATE overrides_doc SET revision = ?1, json = ?2, updated_at = ?3 WHERE event_id = ?4`)
    .bind(revision, JSON.stringify({ ...document, revision, overrides }), now, eventId)
    .run();
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
  const deleted = { login_tokens: 0, sessions: 0, preview_mail_sink: 0, circle_overrides: 0 };
  const anonymized = { audit_ip_hashes: 0 };
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

  if (present.has("circle_overrides")) {
    const purged = await purgeExpiredOverrides(database, now);
    deleted.circle_overrides = purged.length;

    if (purged.length > 0) {
      if (present.has("overrides_doc")) {
        const byEvent = new Map<string, Set<string>>();
        for (const row of purged) {
          const circles = byEvent.get(row.event_id) ?? new Set<string>();
          circles.add(row.circle_id);
          byEvent.set(row.event_id, circles);
        }
        for (const [eventId, circles] of byEvent) await dropFromPublishedDocument(database, eventId, circles, now);
      }

      // One row per purged circle, holding the identifier and nothing the
      // circle wrote. pretix's `LogEntry` is the shape being copied: what is
      // deleted is the content, not the evidence that a deletion happened.
      // Read with the `override.retention` entry from the same circle, this
      // answers "it asked to be deleted on this date, and it was, on that one".
      if (present.has("audit_log")) {
        const entries = purged.map((row) => database.prepare(
          `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
           VALUES (?1, ?2, NULL, 'system', 'override.purged', 'override', ?3, ?4, NULL)`,
        ).bind(crypto.randomUUID(), now, row.circle_id, JSON.stringify({ eventId: row.event_id })));
        // Chunked: every circle that chose to be purged shares one deadline —
        // the end of the event — so the night it comes due is a single run with
        // potentially thousands of entries, not a trickle.
        for (let index = 0; index < entries.length; index += AUDIT_BATCH_SIZE) {
          await database.batch(entries.slice(index, index + AUDIT_BATCH_SIZE));
        }
      }
    }
  } else skipped.push("circle_overrides");

  if (!present.has("overrides_doc")) skipped.push("overrides_doc");
  if (present.has("audit_log")) {
    const result = await database.prepare(
      `UPDATE audit_log SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND at < ?1`,
    ).bind(now - windows.auditIpHashes).run();
    anonymized.audit_ip_hashes = result.meta.changes ?? 0;
  } else skipped.push("audit_log");
  const summary: PurgeSummary = { at: now, deleted, anonymized, skipped };

  // Written on every run, including the ones that delete nothing: without it
  // there is no way to answer "is the purge still running?" short of reading
  // the tables it was supposed to have emptied.
  if (present.has("audit_log")) {
    await database.prepare(
      `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
       VALUES (?1, ?2, NULL, 'system', 'retention.purged', 'retention', 'scheduled', ?3, NULL)`,
    ).bind(crypto.randomUUID(), now, JSON.stringify({ deleted, anonymized, skipped })).run();
  }

  return summary;
}
