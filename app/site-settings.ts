import { isEmailShaped, normalizeEmail } from "./portal-crypto";

export type OrganizerApplicationMode = "closed" | "invite_only" | "public";
export type SiteSettingsInput = {
  organizerApplicationMode: OrganizerApplicationMode;
  organizerAllowedEmails: string[];
  accountNotificationsEnabled: boolean;
  adminReviewNotificationsEnabled: boolean;
  publicationEnabled: boolean;
};
export type SiteSettings = SiteSettingsInput & {
  accountNotificationsSince: number | null;
  updatedAt: number;
  updatedBy: string;
};
export type ServiceCheck = { status: "available" | "unavailable" | "unknown"; source: string; reason: string };
export type ServiceChecks = { requestedAt: number; checkedAt: number | null; mail: ServiceCheck | null; publication: ServiceCheck | null };
export type PublicationActivity = { id: string; candidateId: string; eventName: string; status: "queued" | "publishing"; step: string };
export type AdminSiteSettings = {
  settings: SiteSettings;
  publicationMode: "disabled" | "fake" | "github";
  publicationActivities: PublicationActivity[];
  services: ServiceChecks | null;
};

/** Complete form only. Server-managed epoch and attribution never come from the caller. */
export function parseSiteSettings(value: unknown): SiteSettingsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = ["organizerApplicationMode", "organizerAllowedEmails", "accountNotificationsEnabled", "adminReviewNotificationsEnabled", "publicationEnabled"];
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) return null;
  if (!["closed", "invite_only", "public"].includes(body.organizerApplicationMode as string)
    || !Array.isArray(body.organizerAllowedEmails) || body.organizerAllowedEmails.length > 200
    || body.organizerAllowedEmails.some(email => typeof email !== "string")
    || [body.accountNotificationsEnabled, body.adminReviewNotificationsEnabled, body.publicationEnabled].some(value => typeof value !== "boolean")) return null;
  const emails = [...new Set((body.organizerAllowedEmails as string[]).map(normalizeEmail).filter(Boolean))];
  if (emails.some(email => !isEmailShaped(email))) return null;
  return { ...body, organizerAllowedEmails: emails } as SiteSettingsInput;
}

/** Used once by Pages to migrate the actual environment, never as a read fallback. */
export function initialSiteSettings(env: Pick<PortalEnv, "ORGANIZER_APPLICATIONS_OPEN" | "ORGANIZER_APPLICATION_ALLOWED_EMAILS" | "ACCOUNT_NOTIFICATIONS_ENABLED" | "ACCOUNT_NOTIFICATIONS_SINCE" | "ADMIN_REVIEW_NOTIFICATIONS_ENABLED" | "ORGANIZER_PUBLICATION_MODE">): SiteSettings {
  const emails = [...new Set((env.ORGANIZER_APPLICATION_ALLOWED_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean))];
  const since = Date.parse(env.ACCOUNT_NOTIFICATIONS_SINCE ?? "");
  return {
    organizerApplicationMode: env.ORGANIZER_APPLICATIONS_OPEN === "true" ? "public" : emails.length ? "invite_only" : "closed",
    organizerAllowedEmails: emails,
    accountNotificationsEnabled: env.ACCOUNT_NOTIFICATIONS_ENABLED === "true" && Number.isFinite(since),
    accountNotificationsSince: Number.isFinite(since) ? since : null,
    adminReviewNotificationsEnabled: env.ADMIN_REVIEW_NOTIFICATIONS_ENABLED === "true",
    publicationEnabled: env.ORGANIZER_PUBLICATION_MODE === "github" || env.ORGANIZER_PUBLICATION_MODE === "fake",
    updatedAt: Date.now(), updatedBy: "migration",
  };
}

export function canSubmitEventApplication(settings: SiteSettings | null, email: string) {
  return settings?.organizerApplicationMode === "public"
    || (settings?.organizerApplicationMode === "invite_only" && settings.organizerAllowedEmails.includes(normalizeEmail(email)));
}
