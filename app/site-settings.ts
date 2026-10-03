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

export function canSubmitEventApplication(settings: SiteSettings | null, email: string) {
  return settings?.organizerApplicationMode === "public"
    || (settings?.organizerApplicationMode === "invite_only" && settings.organizerAllowedEmails.includes(normalizeEmail(email)));
}
