import { nextNotificationSlot, notificationRetryDelay, type NotificationCadence, type NotificationPreferences, type ReviewKind } from "../app/review-notifications";

const sources = {
  application: { table: "organizer_applications", token: "id", state: "pending", event: "NULL", extra: "1" },
  organizer: { table: "organizer_event_candidates", token: "notification_submission_id", state: "submitted", event: "s.event_id", extra: "1" },
  claim: { table: "circle_claims", token: "notification_submission_id", state: "pending", event: "s.event_id", extra: "1" },
  map: { table: "map_drafts", token: "transition_token", state: "submitted", event: "s.event_id", extra: "s.candidate_id IS NULL AND s.retention_action IS NULL" },
};

export function enqueueReviewNotification(database: D1Database, kind: ReviewKind, token: string, now: number) {
  const source = sources[kind];
  // Called in the same batch as the guarded source write. Each fresh token is
  // only installed by a successful transition; application ids are replayable,
  // so that source also checks the preceding INSERT's changes().
  return database.prepare(`INSERT OR IGNORE INTO review_notification_items
    (id, recipient, kind, subject_id, submission_id, event_id, created_at)
    SELECT lower(hex(randomblob(16))), p.recipient, ?1, s.id, ?2, ${source.event}, ?3
    FROM ${source.table} s CROSS JOIN admin_notification_preferences p JOIN admins a ON a.email = p.recipient
    WHERE s.${source.token} = ?2 AND s.status = '${source.state}' AND ${source.extra}
      ${kind === "application" ? "AND changes() = 1" : ""}
      AND p.enabled = 1 AND p.enabled_since <= ?3
      AND NOT EXISTS (SELECT 1 FROM accounts u WHERE u.email = p.recipient
        AND (u.disabled_at IS NOT NULL OR u.deletion_started_at IS NOT NULL))`).bind(kind, token, now);
}

export function seedNotificationPreferences(database: D1Database, now: number) {
  return database.prepare(`INSERT OR IGNORE INTO admin_notification_preferences (recipient, enabled_since, next_digest_at)
    SELECT email, ?1, ?2 FROM admins`).bind(now, nextNotificationSlot("five_minutes", now)).run();
}

export function deleteNotificationRecipient(database: D1Database, email: string) {
  return ["review_notification_items", "review_notification_batches", "admin_notification_preferences"]
    .map(table => database.prepare(`DELETE FROM ${table} WHERE recipient = ?1`).bind(email));
}

export function cancelNotificationRecipient(database: D1Database, email: string, now: number) {
  return ["review_notification_items", "review_notification_batches"].map(table => database.prepare(
    `UPDATE ${table} SET state = 'cancelled', completed_at = ?2 WHERE recipient = ?1 AND state = 'pending'`,
  ).bind(email, now));
}

const recipientActive = `EXISTS (SELECT 1 FROM admins a WHERE a.email = p.recipient)
  AND NOT EXISTS (SELECT 1 FROM accounts u WHERE u.email = p.recipient
    AND (u.disabled_at IS NOT NULL OR u.deletion_started_at IS NOT NULL))`;
const liveItem = Object.entries(sources).map(([kind, source]) => `(n.kind = '${kind}' AND EXISTS (
  SELECT 1 FROM ${source.table} s WHERE s.id = n.subject_id AND s.${source.token} = n.submission_id
    AND s.status = '${source.state}' AND ${source.extra}))`).join(" OR ");
const nextSlotSql = `(CASE p.cadence WHEN 'daily' THEN ((n.created_at - 3600000) / 86400000 + 1) * 86400000 + 3600000
  WHEN 'hourly' THEN (n.created_at / 3600000 + 1) * 3600000 ELSE (n.created_at / 300000 + 1) * 300000 END)`;
const due = `p.enabled = 1 AND ${recipientActive} AND (
  EXISTS (SELECT 1 FROM review_notification_batches b WHERE b.recipient = p.recipient
    AND b.state = 'pending' AND b.retry_at <= ?1 AND b.lease_until <= ?1)
  OR (p.next_digest_at <= ?1 AND NOT EXISTS (SELECT 1 FROM review_notification_batches b
      WHERE b.recipient = p.recipient AND b.state = 'pending')
    AND EXISTS (SELECT 1 FROM review_notification_items n WHERE n.recipient = p.recipient
      AND n.state = 'pending' AND n.batch_id IS NULL AND ${nextSlotSql} <= ?1)))`;

export type ReviewNotificationBatch = { id: string; recipient: string; attempts: number; lease_token: string;
  version: number; cadence: NotificationCadence };

export function createReviewNotificationRepository(database: D1Database, ensureTables: () => Promise<void>) {
  async function getNotificationPreferences(email: string): Promise<NotificationPreferences | null> {
    await ensureTables();
    const row = await database.prepare(`SELECT p.enabled, p.cadence, p.version FROM admin_notification_preferences p
      WHERE p.recipient = ?1 AND ${recipientActive}`).bind(email)
      .first<{ enabled: number; cadence: NotificationCadence; version: number }>();
    return row ? { ...row, enabled: !!row.enabled } : null;
  }

  async function saveNotificationPreferences(input: NotificationPreferences & { email: string; sessionId: string; now: number }) {
    await ensureTables();
    const next = nextNotificationSlot(input.cadence, input.now);
    const writeToken = crypto.randomUUID();
    const result = await database.batch([
      database.prepare(`UPDATE admin_notification_preferences AS p SET enabled = ?2, cadence = ?3,
        version = version + 1, enabled_since = CASE WHEN enabled = 0 AND ?2 = 1 THEN ?4 ELSE enabled_since END,
        next_digest_at = ?5, write_token = ?8 WHERE recipient = ?1 AND version = ?6 AND ${recipientActive}
        AND EXISTS (SELECT 1 FROM sessions s JOIN accounts u ON u.id = s.account_id
          WHERE s.id = ?7 AND u.email = p.recipient AND s.revoked_at IS NULL AND s.expires_at > ?4
          AND u.disabled_at IS NULL AND u.deletion_started_at IS NULL)`)
        .bind(input.email, input.enabled ? 1 : 0, input.cadence, input.now, next, input.version, input.sessionId, writeToken),
      ...["review_notification_items", "review_notification_batches"].map(table => database.prepare(
        `UPDATE ${table} SET state = 'cancelled', completed_at = ?2 WHERE recipient = ?1 AND state = 'pending'
         AND EXISTS (SELECT 1 FROM admin_notification_preferences p WHERE p.recipient = ?1 AND p.enabled = 0)`,
      ).bind(input.email, input.now)),
      database.prepare(`UPDATE review_notification_batches SET retry_at = ?2 WHERE recipient = ?1 AND state = 'pending'
        AND EXISTS (SELECT 1 FROM admin_notification_preferences p WHERE p.recipient = ?1 AND p.write_token = ?3)`)
        .bind(input.email, next, writeToken),
    ]);
    return result[0].meta.changes === 1 ? getNotificationPreferences(input.email) : null;
  }

  async function listDueNotificationRecipients(now: number) {
    await ensureTables();
    return (await database.prepare(`SELECT p.recipient FROM admin_notification_preferences p WHERE ${due}
      ORDER BY p.next_digest_at, p.recipient LIMIT 10`).bind(now).all<{ recipient: string }>()).results;
  }

  async function claimNotificationBatch(recipient: string, now: number) {
    await ensureTables();
    const id = crypto.randomUUID(), lease = crypto.randomUUID();
    await database.batch([
      database.prepare(`INSERT INTO review_notification_batches (id, recipient, retry_at, created_at)
        SELECT ?3, p.recipient, ?1, ?1 FROM admin_notification_preferences p WHERE p.recipient = ?2 AND ${due}
        AND NOT EXISTS (SELECT 1 FROM review_notification_batches b WHERE b.recipient = p.recipient AND b.state = 'pending')`)
        .bind(now, recipient, id),
      database.prepare(`UPDATE review_notification_items SET batch_id = ?1 WHERE recipient = ?2
        AND state = 'pending' AND batch_id IS NULL AND EXISTS (SELECT 1 FROM review_notification_batches WHERE id = ?1)`)
        .bind(id, recipient),
      database.prepare(`UPDATE review_notification_batches SET lease_token = ?3, lease_until = ?4
        WHERE recipient = ?2 AND state = 'pending' AND retry_at <= ?1 AND lease_until <= ?1
          AND EXISTS (SELECT 1 FROM admin_notification_preferences p WHERE p.recipient = ?2 AND p.enabled = 1 AND ${recipientActive})`)
        .bind(now, recipient, lease, now + 120_000),
    ]);
    return database.prepare(`SELECT b.id, b.recipient, b.attempts, b.lease_token, p.version, p.cadence
      FROM review_notification_batches b JOIN admin_notification_preferences p ON p.recipient = b.recipient
      WHERE b.lease_token = ?1 AND b.state = 'pending'`).bind(lease).first<ReviewNotificationBatch>();
  }

  async function readNotificationBatch(batch: ReviewNotificationBatch, now: number) {
    await database.prepare(`UPDATE review_notification_items AS n SET state = 'cancelled', completed_at = ?2
      WHERE batch_id = ?1 AND state = 'pending' AND NOT (${liveItem})`).bind(batch.id, now).run();
    const ready = await database.prepare(`SELECT 1 FROM review_notification_batches b
      JOIN admin_notification_preferences p ON p.recipient = b.recipient WHERE b.id = ?1
      AND b.state = 'pending' AND b.lease_token = ?2 AND b.lease_until > ?3
      AND p.enabled = 1 AND p.version = ?4 AND ${recipientActive}`)
      .bind(batch.id, batch.lease_token, now, batch.version).first();
    if (!ready) return null;
    return (await database.prepare(`SELECT kind, event_id, COUNT(*) AS total FROM review_notification_items
      WHERE batch_id = ?1 AND state = 'pending' GROUP BY kind, event_id ORDER BY kind, event_id`)
      .bind(batch.id).all<{ kind: ReviewKind; event_id: string | null; total: number }>()).results;
  }

  async function releaseNotificationBatch(batch: ReviewNotificationBatch) {
    await database.prepare(`UPDATE review_notification_batches SET lease_token = NULL, lease_until = 0
      WHERE id = ?1 AND lease_token = ?2 AND state = 'pending'`).bind(batch.id, batch.lease_token).run();
  }

  async function completeNotificationBatch(batch: ReviewNotificationBatch, providerId: string | null, now: number) {
    const state = providerId === null ? "cancelled" : "accepted";
    await database.batch([
      database.prepare(`UPDATE review_notification_items SET state = ?3, completed_at = ?4
        WHERE batch_id = ?1 AND state = 'pending' AND EXISTS (SELECT 1 FROM review_notification_batches b
          WHERE b.id = ?1 AND b.state = 'pending' AND b.lease_token = ?2 AND b.lease_until > ?4)`)
        .bind(batch.id, batch.lease_token, state, now),
      database.prepare(`UPDATE review_notification_batches SET state = ?3, completed_at = ?4, provider_id = ?5,
        lease_until = 0, error_code = NULL WHERE id = ?1 AND lease_token = ?2 AND state = 'pending' AND lease_until > ?4`)
        .bind(batch.id, batch.lease_token, state, now, providerId),
      database.prepare(`UPDATE admin_notification_preferences SET next_digest_at = ?2 WHERE recipient = ?1 AND version = ?3
        AND EXISTS (SELECT 1 FROM review_notification_batches WHERE id = ?4 AND lease_token = ?5 AND state = ?6)`)
        .bind(batch.recipient, nextNotificationSlot(batch.cadence, now), batch.version, batch.id, batch.lease_token, state),
    ]);
  }

  async function failNotificationBatch(batch: ReviewNotificationBatch, errorCode: string, now: number) {
    await database.prepare(`UPDATE review_notification_batches SET attempts = attempts + 1,
      retry_at = MAX(retry_at, ?3), lease_token = NULL, lease_until = 0, error_code = ?4
      WHERE id = ?1 AND lease_token = ?2 AND state = 'pending'`)
      .bind(batch.id, batch.lease_token, now + notificationRetryDelay(batch.attempts + 1), errorCode).run();
  }

  return { getNotificationPreferences, saveNotificationPreferences, listDueNotificationRecipients, claimNotificationBatch,
    readNotificationBatch, releaseNotificationBatch, completeNotificationBatch, failNotificationBatch };
}
