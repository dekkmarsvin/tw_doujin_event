import { type AccountNotificationKind, type AccountNotificationPreferences, type NotificationItem } from "../app/account-notifications";
import { nextNotificationSlot, notificationRetryDelay } from "../app/review-notifications";
import type { AccountNotificationPreferencesUpdate } from "../app/i18n/api-contract";
import type { Locale } from "../app/i18n/locale";

type NotificationSource = { kind: AccountNotificationKind; occurrence: string; now: number; detail?: string; detailFromSource?: boolean };
export type NotificationBatch = { id: string; account_id: string; lane: string; lease_token: string; attempts: number; first_attempt_at: number };
const activeAccount = `EXISTS (SELECT 1 FROM accounts a WHERE a.id = n.account_id AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL)`;
const eligible = `${activeAccount} AND (
  (n.audience = 'claimant' AND EXISTS (SELECT 1 FROM circle_claims c WHERE c.id = n.source_id AND c.account_id = n.account_id AND (n.kind <> 'claim.approved' OR c.status = 'verified')))
  OR (n.audience = 'circle_owner' AND EXISTS (SELECT 1 FROM circle_claims c WHERE c.event_id = n.event_id AND c.circle_id = n.circle_id AND c.account_id = n.account_id AND c.status = 'verified'))
  OR (n.audience = 'applicant' AND EXISTS (SELECT 1 FROM organizer_applications a WHERE a.id = n.source_id AND a.account_id = n.account_id))
  OR (n.audience = 'owner' AND EXISTS (SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = n.candidate_id AND g.account_id = n.account_id AND g.role = 'owner' AND g.revoked_at IS NULL))
  OR (n.audience = 'member' AND EXISTS (SELECT 1 FROM organizer_event_grants g WHERE g.id = n.source_id AND g.account_id = n.account_id AND (n.kind = 'member.revoked' OR g.revoked_at IS NULL)))
) AND (n.kind <> 'circle.updated' OR COALESCE((SELECT cadence FROM account_notification_preferences p WHERE p.account_id = n.account_id), 'daily') <> 'off')`;

/** Source SELECT is private SQL, supplied by the domain transaction, never request text.
 * Its guard must prove that THIS transaction made the transition. */
export function createAccountNotificationWriter(database: D1Database) {
  return (input: NotificationSource, source: string, bindings: Array<string | number | null>): D1PreparedStatement[] => {
    // Source uses named columns and numbered bindings. All message constants go
    // after those bindings so the guarded business query stays readable.
    const p = (offset: number) => `?${bindings.length + offset}`;
    const now = p(3);
    return [database.prepare(`INSERT OR IGNORE INTO account_notification_items
      (id, account_id, kind, occurrence, event_id, circle_id, candidate_id, source_id, audience, name, version, detail, occurred_at, due_at)
      SELECT lower(hex(randomblob(16))), s.account_id, ${p(1)}, ${p(2)}, s.event_id, s.circle_id, s.candidate_id,
        s.source_id, s.audience, s.name, s.version, ${input.detailFromSource ? `COALESCE(s.detail, ${p(4)})` : p(4)}, ${now},
        CASE WHEN ${p(1)} <> 'circle.updated' THEN ${now}
          WHEN COALESCE(p.cadence, 'daily') = 'hourly' THEN (CAST(${now} / 3600000 AS INTEGER) + 1) * 3600000
          ELSE (CAST((${now} - 3600000) / 86400000 AS INTEGER) + 1) * 86400000 + 3600000 END
      FROM (${source}) s JOIN accounts a ON a.id = s.account_id
      LEFT JOIN account_notification_preferences p ON p.account_id = s.account_id
      WHERE a.disabled_at IS NULL AND a.deletion_started_at IS NULL
        AND EXISTS (SELECT 1 FROM site_settings WHERE id = 'global' AND account_notifications_enabled = 1 AND account_notifications_since <= ${now})
        AND (${p(1)} <> 'circle.updated' OR (COALESCE(p.cadence, 'daily') <> 'off' AND COALESCE(p.enabled_since, 0) <= ${now}))`)
      .bind(...bindings, input.kind, input.occurrence, input.now, input.detail ?? "")];
  };
}

/** The edition shown in the organizer workspace; current_version counts saves. */
export const organizerCandidateEdition = `CASE WHEN c.event_id IS NULL THEN 1 ELSE (SELECT COUNT(*) FROM organizer_event_candidates previous
  WHERE previous.event_id = c.event_id AND (previous.created_at < c.created_at
    OR (previous.created_at = c.created_at AND previous.id <= c.id))) END`;

export const claimNotificationSource = `SELECT c.account_id, c.event_id, c.circle_id, NULL AS candidate_id,
  c.id AS source_id, 'claimant' AS audience, c.circle_name_at_claim AS name, NULL AS version FROM circle_claims c`;
export const circleNotificationSource = `SELECT c.account_id, c.event_id, c.circle_id, NULL AS candidate_id,
  c.id AS source_id, 'circle_owner' AS audience, c.circle_name_at_claim AS name, NULL AS version FROM circle_claims c`;
export const ownerNotificationSource = `SELECT g.account_id, c.event_id, NULL AS circle_id, c.id AS candidate_id,
  c.id AS source_id, 'owner' AS audience, c.tentative_name AS name, c.current_version AS version
  FROM organizer_event_candidates c JOIN organizer_event_grants g ON g.candidate_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL`;
export const memberNotificationSource = `SELECT g.account_id, c.event_id, NULL AS circle_id, c.id AS candidate_id,
  CASE WHEN g.account_id = target.account_id THEN target.id ELSE c.id END AS source_id,
  CASE WHEN g.account_id = target.account_id THEN 'member' ELSE 'owner' END AS audience,
  c.tentative_name AS name, NULL AS version
  FROM organizer_event_grants target JOIN organizer_event_candidates c ON c.id = target.candidate_id
  JOIN organizer_event_grants g ON g.candidate_id = c.id
    AND (g.account_id = target.account_id OR (g.role = 'owner' AND g.revoked_at IS NULL))`;

export function deleteAccountNotifications(database: D1Database, accountId: string) {
  return ["account_notification_items", "account_notification_batches", "account_notification_preferences"]
    .map(table => database.prepare(`DELETE FROM ${table} WHERE account_id = ?1`).bind(accountId));
}

export function createAccountNotificationRepository(database: D1Database, ensureTables: () => Promise<void>) {
  async function currentNotificationEpoch() {
    await ensureTables();
    return database.prepare("SELECT account_notifications_since AS since FROM site_settings WHERE id = 'global' AND account_notifications_enabled = 1")
      .first<{ since: number | null }>();
  }
  async function getAccountNotificationPreferences(accountId: string): Promise<AccountNotificationPreferences> {
    await ensureTables();
    return await database.prepare("SELECT cadence, version, locale FROM account_notification_preferences WHERE account_id = ?1")
      .bind(accountId).first<AccountNotificationPreferences>() ?? { cadence: "daily", version: 0, locale: null };
  }
  async function saveAccountNotificationPreferences(input: AccountNotificationPreferencesUpdate & { accountId: string; sessionId: string; now: number }) {
    await ensureTables();
    const token = crypto.randomUUID();
    // Language changes never enter the cadence transaction, including the
    // first preference row. daily/0 are exactly the absent-row defaults.
    if (input.cadence === undefined) {
      const result = await database.prepare(`INSERT INTO account_notification_preferences (account_id, cadence, version, enabled_since, write_token, locale)
        SELECT ?1, 'daily', 1, 0, ?6, ?2 WHERE (?4 = 0 OR EXISTS (SELECT 1 FROM account_notification_preferences WHERE account_id = ?1))
        AND EXISTS (SELECT 1 FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE a.id = ?1
          AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL AND s.id = ?5 AND s.revoked_at IS NULL AND s.expires_at > ?3)
        ON CONFLICT(account_id) DO UPDATE SET locale = excluded.locale, version = account_notification_preferences.version + 1,
          write_token = ?6 WHERE account_notification_preferences.version = ?4`)
        .bind(input.accountId, input.locale!, input.now, input.version, input.sessionId, token).run();
      return result.meta.changes === 1 ? getAccountNotificationPreferences(input.accountId) : null;
    }
    const results = await database.batch([
      database.prepare(`INSERT INTO account_notification_preferences (account_id, cadence, version, enabled_since, write_token, locale)
        SELECT ?1, ?2, 1, ?3, ?6, ?7 WHERE (?4 = 0 OR EXISTS (SELECT 1 FROM account_notification_preferences WHERE account_id = ?1))
        AND EXISTS (SELECT 1 FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE a.id = ?1
          AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL AND s.id = ?5 AND s.revoked_at IS NULL AND s.expires_at > ?3)
        ON CONFLICT(account_id) DO UPDATE SET cadence = excluded.cadence, version = account_notification_preferences.version + 1,
          enabled_since = CASE WHEN account_notification_preferences.cadence = 'off' THEN ?3 ELSE account_notification_preferences.enabled_since END,
          write_token = ?6, locale = COALESCE(?7, account_notification_preferences.locale) WHERE account_notification_preferences.version = ?4`)
        .bind(input.accountId, input.cadence, input.now, input.version, input.sessionId, token, input.locale ?? null),
      database.prepare(`UPDATE account_notification_items SET state = CASE WHEN ?2 = 'off' THEN 'cancelled' ELSE state END,
        completed_at = CASE WHEN ?2 = 'off' THEN ?3 ELSE completed_at END, due_at = ?4
        WHERE account_id = ?1 AND kind = 'circle.updated' AND state = 'pending'
          AND EXISTS (SELECT 1 FROM account_notification_preferences WHERE account_id = ?1 AND write_token = ?5)`)
        .bind(input.accountId, input.cadence, input.now, nextNotificationSlot(input.cadence === "hourly" ? "hourly" : "daily", input.now), token),
      database.prepare(`UPDATE account_notification_batches SET state = CASE WHEN ?2 = 'off' THEN 'cancelled' ELSE state END,
        completed_at = CASE WHEN ?2 = 'off' THEN ?3 ELSE completed_at END, retry_at = ?4,
        lease_token = NULL, lease_until = 0
        WHERE account_id = ?1 AND lane = 'digest' AND state = 'pending'
          AND EXISTS (SELECT 1 FROM account_notification_preferences WHERE account_id = ?1 AND write_token = ?5)`)
        .bind(input.accountId, input.cadence, input.now, nextNotificationSlot(input.cadence === "hourly" ? "hourly" : "daily", input.now), token),
    ]);
    return results[0].meta.changes === 1 ? getAccountNotificationPreferences(input.accountId) : null;
  }
  async function listDueAccountNotifications(now: number) {
    if (!await currentNotificationEpoch()) return [];
    await ensureTables();
    // Cancellation and expiry are bounded to the selected batch below. Old
    // epochs never become deliverable when rollout is re-enabled.
    return (await database.prepare(`SELECT account_id, lane, MIN(due) AS due FROM (
      SELECT account_id, lane, retry_at AS due FROM account_notification_batches
        WHERE state = 'pending' AND retry_at <= ?1 AND lease_until <= ?1
      UNION ALL SELECT n.account_id, CASE WHEN n.kind = 'circle.updated' THEN 'digest' ELSE n.id END AS lane, n.due_at AS due
        FROM account_notification_items n WHERE n.state = 'pending' AND n.batch_id IS NULL AND n.due_at <= ?1
          AND NOT EXISTS (SELECT 1 FROM account_notification_batches b WHERE b.account_id = n.account_id
            AND b.lane = CASE WHEN n.kind = 'circle.updated' THEN 'digest' ELSE n.id END AND b.state = 'pending')
      ) GROUP BY account_id, lane ORDER BY CASE WHEN lane = 'digest' THEN 1 ELSE 0 END, due LIMIT 10`)
      .bind(now).all<{ account_id: string; lane: string }>()).results;
  }
  async function claimAccountNotificationBatch(accountId: string, lane: string, now: number): Promise<NotificationBatch | null> {
    if (!await currentNotificationEpoch()) return null;
    await ensureTables();
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO account_notification_batches (id, account_id, lane, retry_at, created_at)
        SELECT ?1, ?2, ?3, ?4, ?4 WHERE EXISTS (SELECT 1 FROM account_notification_items
          WHERE account_id = ?2 AND state = 'pending' AND batch_id IS NULL AND due_at <= ?4
            AND (CASE WHEN kind = 'circle.updated' THEN 'digest' ELSE id END) = ?3)`)
        .bind(id, accountId, lane, now),
      database.prepare(`UPDATE account_notification_items SET batch_id = ?1 WHERE id IN (
        SELECT id FROM account_notification_items WHERE account_id = ?2 AND state = 'pending' AND batch_id IS NULL AND due_at <= ?4
          AND (CASE WHEN kind = 'circle.updated' THEN 'digest' ELSE id END) = ?3 ORDER BY occurred_at, id LIMIT 100)
        AND EXISTS (SELECT 1 FROM account_notification_batches WHERE id = ?1)`)
        .bind(id, accountId, lane, now),
      database.prepare(`UPDATE account_notification_batches SET lease_token = ?3, lease_until = ?4 + 120000,
        first_attempt_at = COALESCE(first_attempt_at, ?4), attempts = attempts + 1
        WHERE account_id = ?1 AND lane = ?2 AND state = 'pending' AND retry_at <= ?4 AND lease_until <= ?4`)
        .bind(accountId, lane, token, now),
    ]);
    return database.prepare("SELECT id, account_id, lane, lease_token, attempts, first_attempt_at FROM account_notification_batches WHERE lease_token = ?1 AND state = 'pending'")
      .bind(token).first<NotificationBatch>();
  }
  async function readAccountNotificationBatch(batch: NotificationBatch, now: number) {
    const config = await currentNotificationEpoch();
    if (!config || config.since === null) return null;
    const live = await database.prepare("SELECT 1 FROM account_notification_batches WHERE id = ?1 AND state = 'pending' AND lease_token = ?2 AND lease_until > ?3 AND retry_at <= ?3")
      .bind(batch.id, batch.lease_token, now).first();
    if (!live) return null;
    await database.prepare(`UPDATE account_notification_items AS n SET state = 'cancelled', completed_at = ?2
      WHERE batch_id = ?1 AND state = 'pending' AND (occurred_at < ?3 OR NOT (${eligible})
        OR (kind IN ('review.approved', 'publication.failed') AND EXISTS (
          SELECT 1 FROM organizer_event_candidates c WHERE c.id = n.candidate_id
            AND (c.current_version <> n.version OR c.status = 'published' OR (n.kind = 'review.approved' AND c.status = 'failed')))))`).bind(batch.id, now, config.since).run();
    const items = (await database.prepare(`SELECT n.*, CASE WHEN n.version IS NULL OR c.id IS NULL THEN NULL ELSE ${organizerCandidateEdition} END AS edition
      FROM account_notification_items n LEFT JOIN organizer_event_candidates c ON c.id = n.candidate_id WHERE n.batch_id = ?1 AND n.state = 'pending'
      AND ${eligible} AND EXISTS (SELECT 1 FROM account_notification_batches b WHERE b.id = n.batch_id
        AND b.lease_token = ?2 AND b.state = 'pending' AND b.lease_until > ?3 AND b.retry_at <= ?3)
      ORDER BY n.occurred_at, n.id`).bind(batch.id, batch.lease_token, now).all<NotificationItem>()).results;
    const account = await database.prepare(`SELECT a.email, p.locale FROM accounts a
      LEFT JOIN account_notification_preferences p ON p.account_id = a.id
      WHERE a.id = ?1 AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL`)
      .bind(batch.account_id).first<{ email: string; locale: Locale | null }>();
    return { items, to: account?.email ?? null, locale: account?.locale ?? null };
  }
  async function finishAccountNotificationBatch(batch: NotificationBatch, state: "accepted" | "cancelled" | "failed", now: number, providerId: string | null = null, errorCode: string | null = null) {
    await database.batch([
      database.prepare(`UPDATE account_notification_batches SET state = ?3, completed_at = ?4, provider_id = ?5, error_code = ?6,
        lease_until = 0 WHERE id = ?1 AND lease_token = ?2 AND state = 'pending' AND lease_until > ?4`)
        .bind(batch.id, batch.lease_token, state, now, providerId, errorCode),
      database.prepare(`UPDATE account_notification_items SET state = ?3, completed_at = ?4 WHERE batch_id = ?1 AND state = 'pending'
        AND EXISTS (SELECT 1 FROM account_notification_batches WHERE id = ?1 AND lease_token = ?2 AND state = ?3)`)
        .bind(batch.id, batch.lease_token, state, now),
    ]);
  }
  async function failAccountNotificationBatch(batch: NotificationBatch, code: string, permanent: boolean, now: number) {
    if (permanent || now - batch.first_attempt_at >= 48 * 3600000) return finishAccountNotificationBatch(batch, "failed", now, null, code);
    await database.prepare(`UPDATE account_notification_batches SET error_code = ?3, retry_at = ?4, lease_until = 0
      WHERE id = ?1 AND lease_token = ?2 AND state = 'pending' AND lease_until > ?5`)
      .bind(batch.id, batch.lease_token, code, Math.min(now + notificationRetryDelay(batch.attempts), batch.first_attempt_at + 48 * 3600000), now).run();
  }
  return { getAccountNotificationPreferences, saveAccountNotificationPreferences, listDueAccountNotifications,
    claimAccountNotificationBatch, readAccountNotificationBatch, finishAccountNotificationBatch, failAccountNotificationBatch };
}
