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

import { deleteObjectKeys } from "../app/hosted-thumbnails";
import { organizerMapBackgroundObjectKey } from "../app/map-contribution-files";

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
  /** Inactivity while still editable. Submitted drafts deliberately have no clock. */
  mapDraftInactivity: 180 * DAY_MS,
  /** Raw evidence after an approve/reject/export/withdraw decision. Metadata remains. */
  mapDecisionRaw: 30 * DAY_MS,
} as const;

type RetentionWindows = typeof RETENTION_WINDOWS;

type PurgeSummary = {
  at: number;
  deleted: {
    login_tokens: number; sessions: number; preview_mail_sink: number; circle_overrides: number;
    map_drafts: number; map_draft_revisions: number; map_raw_objects: number;
  };
  anonymized: { audit_ip_hashes: number; map_drafts: number };
  /** Tables that do not exist here. Preview and production hold the same
   * schema, but a database no Function has touched yet holds none of it. */
  skipped: string[];
};

/** Statements per `batch()` when recording a purge. */
const AUDIT_BATCH_SIZE = 100;
export const MAP_RETENTION_BATCH_SIZE = 5;
const MAP_RETENTION_RAW_OBJECT_BATCH_SIZE = 450;
const MAP_RETENTION_D1_BIND_BATCH_SIZE = 90;

const PURGE_TABLES = [
  "login_tokens", "sessions", "preview_mail_sink", "circle_overrides", "overrides_doc", "audit_log",
  "map_drafts", "map_draft_revisions", "map_draft_reviews", "map_draft_comments", "map_draft_files",
] as const;

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
async function listObjectKeys(objects: Pick<R2Bucket, "list">, prefix?: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await objects.list({ ...(prefix ? { prefix } : {}), ...(cursor ? { cursor } : {}) });
    keys.push(...page.objects.map(({ key }) => key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function purgeExpiredOverrides(database: D1Database, now: number, objects?: Pick<R2Bucket, "list" | "delete">) {
  if (objects) {
    const due = await database.prepare(
      `SELECT event_id, circle_id FROM circle_overrides
       WHERE retention_choice = 'purge' AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?1
      `,
    ).bind(now).all<{ event_id: string; circle_id: string }>();
    const eventPrefixes = new Map<string, string>();
    const dueCirclePrefixes = new Set(due.results.map(({ event_id, circle_id }) => {
      const eventPrefix = `events/${encodeURIComponent(event_id)}/circles/`;
      eventPrefixes.set(event_id, eventPrefix);
      return `${eventPrefix}${encodeURIComponent(circle_id)}/`;
    }));
    const keys = [...new Set((await Promise.all([...eventPrefixes.values()].map(async (eventPrefix) => {
      const eventKeys = await listObjectKeys(objects, eventPrefix);
      return eventKeys.filter((key) => {
        const circleSeparator = key.indexOf("/", eventPrefix.length);
        return circleSeparator >= 0 && dueCirclePrefixes.has(key.slice(0, circleSeparator + 1));
      });
    }))).flat())];
    // Bytes go first. R2 deletion is idempotent, so a D1 failure leaves a
    // retryable row pointing at an already-absent object, never orphan bytes.
    await deleteObjectKeys(objects, keys);
  }
  const purged = await database.prepare(
    `DELETE FROM circle_overrides
     WHERE retention_choice = 'purge' AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?1
     RETURNING event_id, circle_id`,
  ).bind(now).all<{ event_id: string; circle_id: string }>();
  return purged.results;
}

async function purgeMapDraftData(
  database: D1Database,
  now: number,
  windows: RetentionWindows,
  hasComments: boolean,
  objects?: Pick<R2Bucket, "delete">,
) {
  const editableCutoff = now - windows.mapDraftInactivity;
  const decisionCutoff = now - windows.mapDecisionRaw;
  const claimed = () => database.prepare(
    `SELECT id, candidate_id, status, retention_action FROM map_drafts
     WHERE retention_action IS NOT NULL
     ORDER BY last_activity_at ASC, id ASC LIMIT ?1`,
  ).bind(MAP_RETENTION_BATCH_SIZE).all<{
    id: string; candidate_id: string | null; status: string; retention_action: "delete" | "anonymize" | "raw";
  }>();
  // Claim before touching R2. Contributor writes and review transitions all
  // require retention_action IS NULL, so bytes and revisions cannot change
  // underneath the cross-service delete. A failed R2 call leaves the claim in
  // D1 and the next run resumes it; multiple purgers may safely retry the same
  // idempotent claim.
  let due = await claimed();
  if (due.results.length === 0) {
    if (!objects) {
      const needsStorage = await database.prepare(
        `SELECT d.id FROM map_drafts d JOIN map_draft_files f ON f.draft_id = d.id
         WHERE d.retention_action IS NULL AND f.object_key IS NOT NULL AND (
           (d.status = 'draft' AND d.last_activity_at <= ?1)
           OR (d.status = 'changes_requested' AND d.last_activity_at <= ?1)
           OR (d.status IN ('approved', 'rejected', 'exported', 'withdrawn') AND d.decision_at IS NOT NULL AND d.decision_at <= ?2)
         ) LIMIT 1`,
      ).bind(editableCutoff, decisionCutoff).first<{ id: string }>();
      if (needsStorage) throw new Error("Private map evidence bucket is required before map draft retention can delete metadata.");
    }
    // A comment posted after a draft was anonymized names an account again, and
    // nothing else about that draft would ever make it claimable a second time.
    const identifiableComments = hasComments
      ? "OR EXISTS (SELECT 1 FROM map_draft_comments c WHERE c.draft_id = map_drafts.id AND c.author_account_id IS NOT NULL)"
      : "";
    await database.prepare(
      `UPDATE map_drafts SET retention_action = CASE
         WHEN status = 'draft' THEN 'delete'
         WHEN status = 'changes_requested' THEN 'anonymize'
         ELSE 'raw' END
       WHERE id IN (
         SELECT id FROM map_drafts
         WHERE retention_action IS NULL AND (
           (status = 'draft' AND last_activity_at <= ?1)
           OR (status = 'changes_requested' AND last_activity_at <= ?1
             AND (owner_account_id != '[shredded]'
               OR EXISTS (SELECT 1 FROM map_draft_revisions r WHERE r.draft_id = map_drafts.id)
               ${identifiableComments}
               OR EXISTS (SELECT 1 FROM map_draft_files f WHERE f.draft_id = map_drafts.id AND f.object_key IS NOT NULL)))
           OR (status IN ('approved', 'rejected', 'exported', 'withdrawn') AND decision_at IS NOT NULL AND decision_at <= ?2
             AND EXISTS (SELECT 1 FROM map_draft_files f WHERE f.draft_id = map_drafts.id AND f.object_key IS NOT NULL))
         ) ORDER BY last_activity_at ASC, id ASC LIMIT ?3
       )`,
    ).bind(editableCutoff, decisionCutoff, MAP_RETENTION_BATCH_SIZE).run();
    due = await claimed();
  }
  if (due.results.length === 0) return { drafts: 0, revisions: 0, rawObjects: 0, anonymized: 0 };

  // A candidate map's layout plan is addressed by the draft's own ids, so there
  // is no metadata row to read before deleting it — and none that can go
  // missing and leave the bytes behind. Deleting is idempotent, so a claim that
  // spans several runs may pass through here more than once.
  const backgroundKeys = due.results
    .filter((draft) => draft.candidate_id)
    .map((draft) => organizerMapBackgroundObjectKey({ candidateId: draft.candidate_id!, draftId: draft.id }));
  if (backgroundKeys.length > 0) {
    if (!objects) throw new Error("Private map evidence bucket is required before map draft retention can delete metadata.");
    await deleteObjectKeys(objects, backgroundKeys);
  }

  const raw = await database.prepare(
    `SELECT f.id, f.object_key FROM map_draft_files f
     JOIN map_drafts d ON d.id = f.draft_id
     WHERE f.object_key IS NOT NULL AND d.retention_action IS NOT NULL
     ORDER BY d.last_activity_at ASC, d.id ASC, f.id ASC LIMIT ?1`,
  ).bind(MAP_RETENTION_RAW_OBJECT_BATCH_SIZE).all<{ id: string; object_key: string }>();
  if (raw.results.length > 0 && !objects) throw new Error("Private map evidence bucket is required before map draft retention can delete metadata.");
  if (objects) await deleteObjectKeys(objects, raw.results.map(({ object_key }) => object_key));
  for (let index = 0; index < raw.results.length; index += MAP_RETENTION_D1_BIND_BATCH_SIZE) {
    const ids = raw.results.slice(index, index + MAP_RETENTION_D1_BIND_BATCH_SIZE).map(({ id }) => id);
    const placeholders = ids.map((_, offset) => `?${offset + 2}`).join(", ");
    await database.prepare(
      `UPDATE map_draft_files SET object_key = NULL, raw_deleted_at = COALESCE(raw_deleted_at, ?1)
       WHERE object_key IS NOT NULL AND id IN (${placeholders})`,
    ).bind(now, ...ids).run();
  }

  // A claim remains for the next run when it owns more raw objects than this
  // invocation's bounded R2/D1 budget. Only fully drained drafts may advance.
  const ready = await database.prepare(
    `SELECT id, status, retention_action FROM map_drafts d
     WHERE retention_action IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM map_draft_files f WHERE f.draft_id = d.id AND f.object_key IS NOT NULL)
     ORDER BY last_activity_at ASC, id ASC LIMIT ?1`,
  ).bind(MAP_RETENTION_BATCH_SIZE).all<{
    id: string; status: string; retention_action: "delete" | "anonymize" | "raw";
  }>();

  let drafts = 0;
  let revisions = 0;
  let anonymized = 0;
  for (const draft of ready.results) {
    if (draft.retention_action === "delete") {
      const results = await database.batch([
        database.prepare(
          `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
           SELECT ?1, ?2, NULL, 'system', 'map_draft.purged', 'map_draft', id, NULL, NULL
           FROM map_drafts WHERE id = ?3 AND retention_action = 'delete'`,
        ).bind(crypto.randomUUID(), now, draft.id),
        database.prepare("DELETE FROM map_draft_files WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'delete')").bind(draft.id),
        ...(hasComments ? [database.prepare("DELETE FROM map_draft_comments WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'delete')").bind(draft.id)] : []),
        database.prepare("DELETE FROM map_draft_revisions WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'delete')").bind(draft.id),
        database.prepare("DELETE FROM map_drafts WHERE id = ?1 AND retention_action = 'delete'").bind(draft.id),
      ]);
      revisions += results.at(-2)?.meta.changes ?? 0;
      drafts += results.at(-1)?.meta.changes ?? 0;
      continue;
    }
    if (draft.retention_action === "anonymize") {
      const results = await database.batch([
        database.prepare(
          `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
           SELECT ?1, ?2, NULL, 'system', 'map_draft.content_purged', 'map_draft', id, NULL, NULL
           FROM map_drafts WHERE id = ?3 AND retention_action = 'anonymize'`,
        ).bind(crypto.randomUUID(), now, draft.id),
        database.prepare("UPDATE map_draft_files SET object_key = NULL, uploaded_by = NULL, raw_deleted_at = COALESCE(raw_deleted_at, ?1) WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?2 AND retention_action = 'anonymize')").bind(now, draft.id),
        database.prepare("DELETE FROM map_draft_revisions WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'anonymize')").bind(draft.id),
        database.prepare("UPDATE map_draft_reviews SET actor_account_id = NULL WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'anonymize')").bind(draft.id),
        ...(hasComments ? [database.prepare("UPDATE map_draft_comments SET author_account_id = NULL WHERE draft_id IN (SELECT id FROM map_drafts WHERE id = ?1 AND retention_action = 'anonymize')").bind(draft.id)] : []),
        database.prepare("UPDATE map_drafts SET owner_account_id = '[shredded]', retention_action = NULL WHERE id = ?1 AND retention_action = 'anonymize'").bind(draft.id),
      ]);
      revisions += results[2].meta.changes ?? 0;
      anonymized += results.at(-1)?.meta.changes ?? 0;
      continue;
    }
    await database.batch([
      database.prepare(
        `INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
         SELECT ?1, ?2, NULL, 'system', 'map_draft.raw_purged', 'map_draft', id, ?4, NULL
         FROM map_drafts WHERE id = ?3 AND retention_action = 'raw'`,
      ).bind(crypto.randomUUID(), now, draft.id, JSON.stringify({ status: draft.status })),
      database.prepare(
        "UPDATE map_draft_files SET object_key = NULL, raw_deleted_at = COALESCE(raw_deleted_at, ?1) WHERE object_key IS NOT NULL AND draft_id IN (SELECT id FROM map_drafts WHERE id = ?2 AND retention_action = 'raw')",
      ).bind(now, draft.id),
      database.prepare("UPDATE map_drafts SET retention_action = NULL WHERE id = ?1 AND retention_action = 'raw'").bind(draft.id),
    ]);
  }
  return { drafts, revisions, rawObjects: raw.results.length, anonymized };
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
  objects?: Pick<R2Bucket, "list" | "delete">,
  mapObjects?: Pick<R2Bucket, "delete">,
): Promise<PurgeSummary> {
  if (windows.loginTokens <= LOGIN_RATE_LIMIT_WINDOW_MS) {
    throw new Error("login token retention must outlast the rate-limit window, or purging resets the quota.");
  }

  const present = await existingTables(database);
  const deleted = {
    login_tokens: 0, sessions: 0, preview_mail_sink: 0, circle_overrides: 0,
    map_drafts: 0, map_draft_revisions: 0, map_raw_objects: 0,
  };
  const anonymized = { audit_ip_hashes: 0, map_drafts: 0 };
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
    const purged = await purgeExpiredOverrides(database, now, objects);
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
  // `map_draft_comments` is deliberately not part of this gate. There is no
  // migration step (ADR-0009): tables appear on the first Pages request, while
  // this Worker neither creates them nor deploys with Pages. Requiring the
  // newest table here would suspend every map-draft retention deadline on a
  // control plane that had simply been idle since the deploy.
  if (present.has("audit_log") && present.has("map_drafts") && present.has("map_draft_revisions") && present.has("map_draft_reviews") && present.has("map_draft_files")) {
    const result = await purgeMapDraftData(database, now, windows, present.has("map_draft_comments"), mapObjects);
    deleted.map_drafts = result.drafts;
    deleted.map_draft_revisions = result.revisions;
    deleted.map_raw_objects = result.rawObjects;
    anonymized.map_drafts = result.anonymized;
  } else {
    for (const table of ["map_drafts", "map_draft_revisions", "map_draft_reviews", "map_draft_files"] as const) {
      if (!present.has(table)) skipped.push(table);
    }
  }
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
