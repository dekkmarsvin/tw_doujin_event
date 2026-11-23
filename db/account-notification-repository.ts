import { type AccountNotificationKind, type AccountNotificationPreferences, type NotificationItem } from "../app/account-notifications";
import type { ReviewKind } from "../app/review-notifications";
import type { AccountNotificationPreferencesUpdate } from "../app/i18n/api-contract";
import type { Locale } from "../app/i18n/locale";

/**
 * The notification outbox (#546). A domain transaction writes its items in the
 * same batch as the change it reports, so a notice exists exactly when the
 * change happened. Every item is one email, due at once; Pages sends what is
 * due after each write request (`app/notification-delivery.ts`), and a send
 * that fails is tried again by a later request until 48 hours have passed.
 */

type NotificationSource = { kind: AccountNotificationKind; occurrence: string; now: number; detail?: string; detailFromSource?: boolean };
export type ClaimedNotification = NotificationItem & { lease: string; to: string; locale: Locale | null };

const RETRY_DELAY = 10 * 60_000;
const GIVE_UP_AFTER = 48 * 3_600_000;
const LEASE = 120_000;

const activeAccount = `EXISTS (SELECT 1 FROM accounts a WHERE a.id = n.account_id AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL)`;
/** Read again at delivery: a claim, grant or admin place lost since the event cancels its notice. */
const eligible = `${activeAccount} AND (
  (n.audience = 'claimant' AND EXISTS (SELECT 1 FROM circle_claims c WHERE c.id = n.source_id AND c.account_id = n.account_id AND (n.kind <> 'claim.approved' OR c.status = 'verified')))
  OR (n.audience = 'circle_owner' AND EXISTS (SELECT 1 FROM circle_claims c WHERE c.event_id = n.event_id AND c.circle_id = n.circle_id AND c.account_id = n.account_id AND c.status = 'verified'))
  OR (n.audience = 'applicant' AND EXISTS (SELECT 1 FROM organizer_applications a WHERE a.id = n.source_id AND a.account_id = n.account_id))
  OR (n.audience = 'owner' AND EXISTS (SELECT 1 FROM organizer_event_grants g WHERE g.candidate_id = n.candidate_id AND g.account_id = n.account_id AND g.role = 'owner' AND g.revoked_at IS NULL))
  OR (n.audience = 'member' AND EXISTS (SELECT 1 FROM organizer_event_grants g WHERE g.id = n.source_id AND g.account_id = n.account_id AND (n.kind = 'member.revoked' OR g.revoked_at IS NULL)))
  OR (n.audience = 'admin' AND EXISTS (SELECT 1 FROM admins ad JOIN accounts a ON a.email = ad.email WHERE a.id = n.account_id)
    AND CASE n.detail
      WHEN 'application' THEN EXISTS (SELECT 1 FROM organizer_applications s WHERE s.id = n.source_id AND s.status = 'pending')
      WHEN 'organizer' THEN EXISTS (SELECT 1 FROM organizer_event_candidates s WHERE s.id = n.source_id AND s.status = 'submitted')
      WHEN 'claim' THEN EXISTS (SELECT 1 FROM circle_claims s WHERE s.id = n.source_id AND s.status = 'pending')
      ELSE 0 END)
) AND (CASE WHEN n.audience = 'admin'
  THEN EXISTS (SELECT 1 FROM site_settings WHERE id = 'global' AND admin_review_notifications_enabled = 1)
  ELSE EXISTS (SELECT 1 FROM site_settings WHERE id = 'global' AND account_notifications_enabled = 1 AND account_notifications_since <= n.occurred_at) END)
AND NOT (n.kind IN ('review.approved', 'publication.failed') AND EXISTS (
  SELECT 1 FROM organizer_event_candidates c WHERE c.id = n.candidate_id
    AND (c.current_version <> n.version OR c.status = 'published' OR (n.kind = 'review.approved' AND c.status = 'failed'))))`;

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
        s.source_id, s.audience, s.name, s.version, ${input.detailFromSource ? `COALESCE(s.detail, ${p(4)})` : p(4)}, ${now}, ${now}
      FROM (${source}) s JOIN accounts a ON a.id = s.account_id
      WHERE a.disabled_at IS NULL AND a.deletion_started_at IS NULL
        AND EXISTS (SELECT 1 FROM site_settings WHERE id = 'global' AND account_notifications_enabled = 1 AND account_notifications_since <= ${now})`)
      .bind(...bindings, input.kind, input.occurrence, input.now, input.detail ?? "")];
  };
}

const reviewSources = {
  application: { table: "organizer_applications", token: "id", state: "pending", event: "NULL", candidate: "NULL" },
  organizer: { table: "organizer_event_candidates", token: "notification_submission_id", state: "submitted", event: "s.event_id", candidate: "s.id" },
  claim: { table: "circle_claims", token: "notification_submission_id", state: "pending", event: "s.event_id", candidate: "NULL" },
};

/** One notice per admin for a new item waiting for review. Called in the same
 * batch as the guarded source write: each fresh token is only installed by a
 * successful transition, and application ids, which are replayable, also need
 * the preceding INSERT's changes(). */
export function enqueueReviewNotification(database: D1Database, kind: ReviewKind, token: string, now: number) {
  const source = reviewSources[kind];
  return database.prepare(`INSERT OR IGNORE INTO account_notification_items
    (id, account_id, kind, occurrence, event_id, circle_id, candidate_id, source_id, audience, name, version, detail, occurred_at, due_at)
    SELECT lower(hex(randomblob(16))), u.id, 'review.pending', ?1 || ':' || ?2, ${source.event}, NULL, ${source.candidate},
      s.id, 'admin', '', NULL, ?1, ?3, ?3
    FROM ${source.table} s CROSS JOIN admins ad JOIN accounts u ON u.email = ad.email
    WHERE s.${source.token} = ?2 AND s.status = '${source.state}'
      ${kind === "application" ? "AND changes() = 1" : ""}
      AND u.disabled_at IS NULL AND u.deletion_started_at IS NULL
      AND EXISTS (SELECT 1 FROM site_settings WHERE id = 'global' AND admin_review_notifications_enabled = 1)`).bind(kind, token, now);
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

/** Rows of the notification tables this design replaced (#546) that name an
 * address; they go with the admin or account until those tables are dropped. */
export function deleteLegacyReviewRecipient(database: D1Database, email: string) {
  return ["review_notification_items", "review_notification_batches", "admin_notification_preferences"]
    .map(table => database.prepare(`DELETE FROM ${table} WHERE recipient = ?1`).bind(email));
}

export function deleteAccountNotifications(database: D1Database, accountId: string) {
  return ["account_notification_items", "account_notification_preferences"]
    .map(table => database.prepare(`DELETE FROM ${table} WHERE account_id = ?1`).bind(accountId));
}

export function createAccountNotificationRepository(database: D1Database, ensureTables: () => Promise<void>) {
  /** Only the account's language is kept (#546); it decides the language of circle mail. */
  async function getAccountNotificationPreferences(accountId: string): Promise<AccountNotificationPreferences> {
    await ensureTables();
    return await database.prepare("SELECT version, locale FROM account_notification_preferences WHERE account_id = ?1")
      .bind(accountId).first<AccountNotificationPreferences>() ?? { version: 0, locale: null };
  }
  async function saveAccountNotificationPreferences(input: AccountNotificationPreferencesUpdate & { accountId: string; sessionId: string; now: number }) {
    await ensureTables();
    const result = await database.prepare(`INSERT INTO account_notification_preferences (account_id, cadence, version, enabled_since, write_token, locale)
      SELECT ?1, 'daily', 1, 0, ?6, ?2 WHERE (?4 = 0 OR EXISTS (SELECT 1 FROM account_notification_preferences WHERE account_id = ?1))
      AND EXISTS (SELECT 1 FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE a.id = ?1
        AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL AND s.id = ?5 AND s.revoked_at IS NULL AND s.expires_at > ?3)
      ON CONFLICT(account_id) DO UPDATE SET locale = excluded.locale, version = account_notification_preferences.version + 1,
        write_token = ?6 WHERE account_notification_preferences.version = ?4`)
      .bind(input.accountId, input.locale ?? null, input.now, input.version, input.sessionId, crypto.randomUUID()).run();
    return result.meta.changes === 1 ? getAccountNotificationPreferences(input.accountId) : null;
  }

  /**
   * Lease up to `limit` due items for one delivery pass. An item no longer
   * worth sending is cancelled here; one past the retry window is failed.
   */
  async function claimDueNotifications(now: number, limit = 10): Promise<ClaimedNotification[]> {
    await ensureTables();
    const lease = crypto.randomUUID();
    await database.batch([
      database.prepare(`UPDATE account_notification_items SET state = 'failed', completed_at = ?1
        WHERE state = 'pending' AND batch_id IS NOT NULL AND occurred_at <= ?2`).bind(now, now - GIVE_UP_AFTER),
      database.prepare(`UPDATE account_notification_items AS n SET state = 'cancelled', completed_at = ?1
        WHERE state = 'pending' AND due_at <= ?1 AND NOT (${eligible})`).bind(now),
      database.prepare(`UPDATE account_notification_items SET batch_id = ?1, due_at = ?2 + ${LEASE}
        WHERE id IN (SELECT id FROM account_notification_items WHERE state = 'pending' AND due_at <= ?2
          ORDER BY occurred_at, id LIMIT ?3)`).bind(lease, now, limit),
    ]);
    return (await database.prepare(`SELECT n.*, ?1 AS lease, a.email AS "to", p.locale,
        CASE WHEN n.version IS NULL OR c.id IS NULL THEN NULL ELSE ${organizerCandidateEdition} END AS edition
      FROM account_notification_items n JOIN accounts a ON a.id = n.account_id
      LEFT JOIN account_notification_preferences p ON p.account_id = n.account_id
      LEFT JOIN organizer_event_candidates c ON c.id = n.candidate_id
      WHERE n.batch_id = ?1 AND n.state = 'pending' ORDER BY n.occurred_at, n.id`).bind(lease).all<ClaimedNotification>()).results;
  }
  async function finishNotification(item: Pick<ClaimedNotification, "id" | "lease">, state: "accepted" | "failed", now: number) {
    await database.prepare(`UPDATE account_notification_items SET state = ?3, completed_at = ?4
      WHERE id = ?1 AND batch_id = ?2 AND state = 'pending'`).bind(item.id, item.lease, state, now).run();
  }
  async function retryNotification(item: Pick<ClaimedNotification, "id" | "lease">, now: number) {
    await database.prepare(`UPDATE account_notification_items SET due_at = ?3
      WHERE id = ?1 AND batch_id = ?2 AND state = 'pending'`).bind(item.id, item.lease, now + RETRY_DELAY).run();
  }
  return { getAccountNotificationPreferences, saveAccountNotificationPreferences, claimDueNotifications, finishNotification, retryNotification };
}
