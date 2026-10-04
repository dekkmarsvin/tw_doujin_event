import type { PublicationActivity, ServiceChecks, SiteSettings, SiteSettingsInput } from "../app/site-settings";
import { organizerCandidateEdition } from "./account-notification-repository";

type SettingsRow = {
  organizer_application_mode: SiteSettings["organizerApplicationMode"]; organizer_allowed_emails_json: string;
  account_notifications_enabled: number; account_notifications_since: number | null;
  admin_review_notifications_enabled: number; publication_enabled: number; updated_at: number; updated_by: string; updated_by_label: string;
  contact_url: string; claim_review_notice: string;
};
function decode(row: SettingsRow): SiteSettings {
  return { organizerApplicationMode: row.organizer_application_mode, organizerAllowedEmails: JSON.parse(row.organizer_allowed_emails_json),
    accountNotificationsEnabled: row.account_notifications_enabled === 1, accountNotificationsSince: row.account_notifications_since,
    adminReviewNotificationsEnabled: row.admin_review_notifications_enabled === 1, publicationEnabled: row.publication_enabled === 1,
    contactUrl: row.contact_url, claimReviewNotice: row.claim_review_notice,
    updatedAt: row.updated_at, updatedBy: row.updated_by_label };
}

export async function seedSiteSettings(database: D1Database, settings: SiteSettings) {
  await database.prepare(`INSERT OR IGNORE INTO site_settings (id, organizer_application_mode, organizer_allowed_emails_json,
    account_notifications_enabled, account_notifications_since, admin_review_notifications_enabled, publication_enabled, updated_at, updated_by,
    contact_url, claim_review_notice)
    VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(settings.organizerApplicationMode, JSON.stringify(settings.organizerAllowedEmails), Number(settings.accountNotificationsEnabled),
      settings.accountNotificationsSince, Number(settings.adminReviewNotificationsEnabled), Number(settings.publicationEnabled), settings.updatedAt, settings.updatedBy,
      settings.contactUrl, settings.claimReviewNotice).run();
}

export function createSiteSettingsRepository(database: D1Database, ensureTables: () => Promise<void>) {
  async function getSiteSettings(): Promise<SiteSettings | null> {
    await ensureTables();
    const row = await database.prepare(`SELECT s.*, COALESCE(a.email, CASE WHEN s.updated_by = 'migration' THEN 'migration' ELSE '已刪除帳號' END) AS updated_by_label
      FROM site_settings s LEFT JOIN accounts a ON a.id = s.updated_by WHERE s.id = 'global'`).first<SettingsRow>();
    return row ? decode(row) : null;
  }
  async function updateSiteSettings(input: { settings: SiteSettingsInput; expectedUpdatedAt: number; actorAccountId: string; sessionId: string; now: number }) {
    await ensureTables();
    const s = input.settings;
    const previous = await getSiteSettings();
    if (!previous || previous.updatedAt !== input.expectedUpdatedAt) return null;
    // Session/admin authority and the stale-form guard belong to the same atomic update as its audit.
    const results = await database.batch([
      database.prepare(`UPDATE site_settings SET organizer_application_mode = ?1, organizer_allowed_emails_json = ?2,
        account_notifications_since = CASE WHEN account_notifications_enabled = 0 AND ?3 = 1 THEN ?6 ELSE account_notifications_since END,
        account_notifications_enabled = ?3, admin_review_notifications_enabled = ?4, publication_enabled = ?5,
        contact_url = ?10, claim_review_notice = ?11,
        updated_at = MAX(updated_at + 1, ?6), updated_by = ?7
        WHERE id = 'global' AND updated_at = ?8 AND EXISTS (
          SELECT 1 FROM accounts a JOIN sessions s ON s.account_id = a.id JOIN admins ad ON ad.email = a.email
          WHERE a.id = ?7 AND a.disabled_at IS NULL AND a.deletion_started_at IS NULL
            AND s.id = ?9 AND s.revoked_at IS NULL AND s.expires_at > ?6)`)
        .bind(s.organizerApplicationMode, JSON.stringify(s.organizerAllowedEmails), Number(s.accountNotificationsEnabled),
          Number(s.adminReviewNotificationsEnabled), Number(s.publicationEnabled), input.now, input.actorAccountId, input.expectedUpdatedAt, input.sessionId,
          s.contactUrl, s.claimReviewNotice),
      database.prepare(`INSERT INTO audit_log (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json)
        SELECT ?1, ?2, ?3, 'admin', 'site_settings.updated', 'site_settings', 'global', ?4 WHERE changes() = 1`)
        .bind(crypto.randomUUID(), input.now, input.actorAccountId, JSON.stringify({ organizerApplicationMode: s.organizerApplicationMode,
          organizerAllowedEmailCount: s.organizerAllowedEmails.length, accountNotificationsEnabled: s.accountNotificationsEnabled,
          adminReviewNotificationsEnabled: s.adminReviewNotificationsEnabled, publicationEnabled: s.publicationEnabled,
          contactUrl: s.contactUrl, claimReviewNotice: s.claimReviewNotice })),
      // An intentional pause must not turn a queued job into a timeout on resume.
      // Keep its identity/checkpoints, and restart only its existing queue wait window.
      database.prepare(`UPDATE organizer_publication_jobs SET updated_at = ?1
        WHERE status = 'queued' AND ?2 = 1 AND changes() = 1`)
        .bind(input.now, Number(!previous.publicationEnabled && s.publicationEnabled)),
    ]);
    return results[0].meta.changes === 1 ? getSiteSettings() : null;
  }
  async function listActivePublicationActivities() {
    await ensureTables();
    const rows = (await database.prepare(`SELECT j.id, j.candidate_id AS candidateId, c.event_id AS eventId,
        c.tentative_name AS eventName, ${organizerCandidateEdition} AS edition,
        j.candidate_version AS candidateVersion, c.current_version AS currentVersion, c.status AS candidateStatus,
        j.status, j.step, j.updated_at AS updatedAt, j.retryable
      FROM organizer_publication_jobs j JOIN organizer_event_candidates c ON c.id = j.candidate_id
      WHERE j.status IN ('queued', 'publishing', 'failed') AND c.current_version = j.candidate_version
        AND c.status <> 'abandoned'
      ORDER BY j.created_at, j.id`).all<Omit<PublicationActivity, "retryable"> & { retryable: number }>()).results;
    return rows.map(row => ({ ...row, retryable: !!row.retryable }));
  }
  async function getServiceChecks(): Promise<ServiceChecks | null> {
    await ensureTables();
    const row = await database.prepare("SELECT requested_at, checked_at, result_json FROM site_service_check WHERE id = 'global'")
      .first<{ requested_at: number; checked_at: number | null; result_json: string | null }>();
    return row ? { requestedAt: row.requested_at, checkedAt: row.checked_at, mail: null, publication: null,
      ...(row.result_json ? JSON.parse(row.result_json) : {}) } : null;
  }
  async function requestServiceCheck(now: number) {
    await ensureTables();
    await database.prepare(`INSERT INTO site_service_check (id, requested_at) VALUES ('global', ?1)
      ON CONFLICT(id) DO UPDATE SET requested_at = MAX(requested_at + 1, ?1), checked_at = NULL, result_json = NULL`)
      .bind(now).run();
    return getServiceChecks();
  }
  async function completeServiceCheck(requestedAt: number, now: number, result: Pick<ServiceChecks, "mail" | "publication">) {
    await ensureTables();
    await database.prepare(`UPDATE site_service_check SET checked_at = ?2, result_json = ?3
      WHERE id = 'global' AND requested_at = ?1 AND checked_at IS NULL`).bind(requestedAt, now, JSON.stringify(result)).run();
  }
  return { getSiteSettings, updateSiteSettings, listActivePublicationActivities, getServiceChecks, requestServiceCheck, completeServiceCheck };
}
