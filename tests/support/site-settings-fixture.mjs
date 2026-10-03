/** Explicit operational choices for isolated D1 scenarios, never environment overrides. */
export async function resetSiteSettings(database, overrides = {}) {
  const settings = { organizerApplicationMode: "closed", organizerAllowedEmails: [], accountNotificationsEnabled: false,
    accountNotificationsSince: null, adminReviewNotificationsEnabled: false, publicationEnabled: true, contactUrl: "", claimReviewNotice: "", ...overrides };
  await database.prepare(`UPDATE site_settings SET organizer_application_mode = ?1, organizer_allowed_emails_json = ?2,
    account_notifications_enabled = ?3, account_notifications_since = ?4, admin_review_notifications_enabled = ?5,
    publication_enabled = ?6, contact_url = ?7, claim_review_notice = ?8, updated_at = 1, updated_by = 'fixture' WHERE id = 'global'`)
    .bind(settings.organizerApplicationMode, JSON.stringify(settings.organizerAllowedEmails), Number(settings.accountNotificationsEnabled),
      settings.accountNotificationsSince, Number(settings.adminReviewNotificationsEnabled), Number(settings.publicationEnabled),
      settings.contactUrl, settings.claimReviewNotice).run();
}
