import { isEmailShaped, normalizeEmail } from "./portal-crypto";

export type OrganizerApplicationMode = "closed" | "invite_only" | "public";
export type SiteSettingsInput = {
  organizerApplicationMode: OrganizerApplicationMode;
  organizerAllowedEmails: string[];
  accountNotificationsEnabled: boolean;
  adminReviewNotificationsEnabled: boolean;
  publicationEnabled: boolean;
  /** One https link for circles and organizers to reach the maintainers; "" shows none. */
  contactUrl: string;
  /** Free text shown while a manual-review claim is pending; "" shows none. */
  claimReviewNotice: string;
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

export const CONTACT_URL_MAX = 500;
export const CLAIM_REVIEW_NOTICE_MAX = 200;

// The value lands in an href; never let `javascript:` or `data:` through.
function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/** Complete form only. Server-managed epoch and attribution never come from the caller. */
export function parseSiteSettings(value: unknown): SiteSettingsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = ["organizerApplicationMode", "organizerAllowedEmails", "accountNotificationsEnabled", "adminReviewNotificationsEnabled", "publicationEnabled",
    "contactUrl", "claimReviewNotice"];
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) return null;
  if (!["closed", "invite_only", "public"].includes(body.organizerApplicationMode as string)
    || !Array.isArray(body.organizerAllowedEmails) || body.organizerAllowedEmails.length > 200
    || body.organizerAllowedEmails.some(email => typeof email !== "string")
    || [body.accountNotificationsEnabled, body.adminReviewNotificationsEnabled, body.publicationEnabled].some(value => typeof value !== "boolean")
    || typeof body.contactUrl !== "string" || typeof body.claimReviewNotice !== "string") return null;
  const emails = [...new Set((body.organizerAllowedEmails as string[]).map(normalizeEmail).filter(Boolean))];
  if (emails.some(email => !isEmailShaped(email))) return null;
  const contactUrl = (body.contactUrl as string).trim(), claimReviewNotice = (body.claimReviewNotice as string).trim();
  if ((contactUrl && !isHttpsUrl(contactUrl)) || contactUrl.length > CONTACT_URL_MAX || claimReviewNotice.length > CLAIM_REVIEW_NOTICE_MAX) return null;
  return { ...body, organizerAllowedEmails: emails, contactUrl, claimReviewNotice } as SiteSettingsInput;
}

export function canSubmitEventApplication(settings: SiteSettings | null, email: string) {
  return settings?.organizerApplicationMode === "public"
    || (settings?.organizerApplicationMode === "invite_only" && settings.organizerAllowedEmails.includes(normalizeEmail(email)));
}
