import type { AccountNotificationPreferences } from "./account-notifications";
import type { AccountNotificationPreferencesUpdate } from "./i18n/api-contract";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
import type { AdminSiteSettings, ServiceChecks, SiteSettingsInput } from "./site-settings";

export function readAdminSiteSettings() { return call<AdminSiteSettings>("/api/admin/site-settings"); }
export function saveAdminSiteSettings(settings: SiteSettingsInput, expectedUpdatedAt: number) {
  return call<AdminSiteSettings>("/api/admin/site-settings", { method: "PUT", body: JSON.stringify({ settings, expectedUpdatedAt }) });
}
export function requestAdminServiceCheck() {
  return call<{ services: ServiceChecks }>("/api/admin/service-check", { method: "POST", body: "{}" });
}
import { notificationParameters } from "./notification-navigation";
import type { NotificationPreferences } from "./review-notifications";
import type { AdminCircleDetail } from "./admin-circle-detail";
export type { AdminCircleDetail, AdminCircleClaim, AdminCircleHistory } from "./admin-circle-detail";
import type { AdminAccountCircleSearchResponse, AdminAccountDetailResponse } from "./admin-account-detail";
export type { AdminAccountDetailResponse, AdminAccountDetail, AdminAccountOrganizerGrant, AdminAccountClaim, AdminAccountCircleMatch } from "./admin-account-detail";

export function readAccountNotificationPreferences() {
  return call<AccountNotificationPreferences>("/api/account/notification-preferences");
}
export function saveAccountNotificationPreferences(preferences: AccountNotificationPreferencesUpdate) {
  return call<AccountNotificationPreferences>("/api/account/notification-preferences", { method: "PUT", body: JSON.stringify(preferences) });
}

export function readNotificationPreferences() {
  return call<NotificationPreferences>("/api/admin/notification-preferences");
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  return call<NotificationPreferences>("/api/admin/notification-preferences", { method: "PUT", body: JSON.stringify(preferences) });
}
import type { CircleOverrideFields, CircleRetentionChoice } from "./circle-overrides";

/**
 * Every authenticated write in one place, so the boundary is auditable: the
 * public reader clients never import this, and this never touches the
 * anonymous, edge-cacheable read namespace.
 */

export type PortalSession = { email: string; isAdmin: boolean; hasOrganizerAccess: boolean; expiresAt?: number; canApplyForEvent?: boolean; hasEventApplications?: boolean;
  contactUrl?: string; claimReviewNotice?: string };

export type ClaimSummary = {
  id: string;
  circleId: string;
  circleName: string;
  status: "pending" | "verified" | "rejected" | "revoked" | "withdrawn";
  method: string | null;
  targetUrl: string | null;
  evidenceUrl: string | null;
  createdAt: number;
};

export type PendingClaim = {
  id: string;
  circleId: string;
  circleName: string;
  evidenceUrl: string | null;
  evidenceNote: string | null;
  targetUrl: string | null;
  createdAt: number;
};

/** A pending claim in the cross-event review queue. */
export type QueuedClaim = PendingClaim & { eventId: string; circleClaimed: boolean };

export type ReviewQueue = {
  claims: QueuedClaim[];
  pendingClaimCount?: number;
  claimCounts?: { eventId: string; pending: number }[];
  organizer: { applications: number; submissions: number };
};

export class PortalError extends Error {
  constructor(message: string, readonly status: number, readonly body?: Record<string, unknown>) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = "portal-session-expired";

export function reportSessionResponse(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

let portalEventId = "";

/**
 * The event every control-plane call operates on.
 *
 * The account is global and the session is not per event, so the event travels
 * on the request instead: one place to set it, and no caller can forget it and
 * silently write into whichever event the deployment happens to default to
 * (ADR-0043).
 */
export function setPortalEventId(eventId: string) {
  portalEventId = eventId;
}

/**
 * Exported because a few event-scoped endpoints are reached by the browser
 * rather than by `call` — an evidence download link, a preview image — and they
 * need the same scope as everything else.
 */
export function withEventScope(path: string, eventId = portalEventId) {
  if (!eventId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}event=${encodeURIComponent(eventId)}`;
}

/**
 * `eventId` names the event for this one request instead of the page's. The
 * cross-event review queue decides claims from several events without moving
 * the page, and each decision must still be scoped to its own claim's event.
 */
async function call<T>(path: string, init?: RequestInit, eventId?: string): Promise<T> {
  // Every mutating request declares JSON, body or not. The server requires it
  // on all of them — an HTML form cannot send that content type, which is what
  // makes form-based CSRF structurally impossible — and a bodyless DELETE that
  // omitted it was rejected with a 415 before reaching any handler.
  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const multipart = typeof FormData !== "undefined" && init?.body instanceof FormData;

  const response = await fetch(withEventScope(path, eventId ?? portalEventId), {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(mutating && !multipart ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  reportSessionResponse(response.status);
  const text = await response.text();

  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // An access gate answers a redirect with an HTML login page, which fetch
      // follows and reports as a 200. Parsing that raises a bare syntax error
      // that tells the user nothing about what actually happened.
      throw new PortalError(
        response.redirected
          ? "這個操作被存取控制擋下了。請先在同一個瀏覽器開啟本站首頁完成驗證，再回來重試。"
          : "收到無法處理的回應，請稍後再試。",
        response.status,
      );
    }
  }

  if (!response.ok) throw new PortalError(typeof body.error === "string" ? body.error : "操作失敗，請稍後再試。", response.status, body);
  return body as T;
}

/** The sitekey is public by design; it is served rather than built in so that
 * preview and production can hold different keys without a separate bundle. */
export function readTurnstileSitekey() {
  return call<{ turnstileSitekey: string }>("/api/auth/config").then((body) => body.turnstileSitekey);
}

export function requestLoginLink(email: string, turnstileToken: string, audience: "circle" | "organizer" = "circle", circleId?: string, locale: Locale = DEFAULT_LOCALE) {
  const destination = typeof window === "undefined" ? {} : Object.fromEntries(notificationParameters(Object.fromEntries(new URLSearchParams(window.location.search)), audience));
  return call<{ ok: true }>("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email, turnstileToken, audience, circleId, destination, locale }) });
}

export function verifyLoginToken(token: string) {
  return call<PortalSession>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
}

export function readSession() {
  return call<PortalSession>("/api/auth/session");
}

export function signOut() {
  return call<{ ok: true }>("/api/auth/session", { method: "DELETE" });
}

export function deleteMyAccount(email: string) {
  return call<{ ok: true }>("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: email }) });
}

export type CircleMatch = {
  id: string;
  name: string;
  links: { provider: string; url: string }[];
  linkCount: number;
  /** Only on the exact entry lookup: someone already holds a verified claim. */
  claimed?: boolean;
};

export function searchCircles(query: string) {
  return call<{ circles: CircleMatch[] }>(`/api/circle/search?q=${encodeURIComponent(query)}`);
}

export function readClaimCircle(circleId: string) {
  return call<{ circles: CircleMatch[] }>(`/api/circle/search?circle=${encodeURIComponent(circleId)}`)
    .then((answer) => answer.circles[0] ?? null);
}

/** `eventId` reads another event's claims without moving the page, for the event picker. */
export function listMyClaims(eventId?: string) {
  return call<{ eventId: string; claims: ClaimSummary[] }>("/api/claims", undefined, eventId);
}

export function createClaim(input: { circleId: string; targetUrl?: string; evidenceUrl?: string; evidenceNote?: string }) {
  return call<{ id: string; status: string; challenge: string | null; targetUrl: string | null }>("/api/claims", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function withdrawClaim(claimId: string) {
  return call<{ ok: true }>(`/api/claims/${encodeURIComponent(claimId)}`, { method: "DELETE" });
}

export function runChallenge(claimId: string) {
  return call<{ verified: boolean; error?: string }>(`/api/claims/${encodeURIComponent(claimId)}/challenge`, { method: "POST", body: "{}" });
}

export function readMyOverride(circleId: string) {
  return call<{
    fields: CircleOverrideFields;
    status: string;
    postEventHidden: boolean;
    /** `null` where the circle has not answered the retention question yet. */
    retention: CircleRetentionChoice | null;
    retentionExpiresAt: number | null;
  }>(`/api/circle/${encodeURIComponent(circleId)}/overrides`);
}

export function setPostEventVisibility(circleId: string, hidden: boolean) {
  return call<{ ok: true; hidden: boolean }>(`/api/circle/${encodeURIComponent(circleId)}/visibility`, {
    method: "POST",
    body: JSON.stringify({ hidden }),
  });
}

/** `confirm` is the circle id typed back — see the handler for why. */
export function deleteMyOverride(circleId: string) {
  return call<{ ok: true }>(`/api/circle/${encodeURIComponent(circleId)}/overrides`, {
    method: "DELETE",
    body: JSON.stringify({ confirm: circleId }),
  });
}

export function previewOverride(circleId: string, fields: CircleOverrideFields) {
  return call<{ records: unknown[]; baseRecords: unknown[]; projectedAt: string }>(`/api/circle/${encodeURIComponent(circleId)}/preview`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

/** `retention` is omitted rather than guessed when the circle has not chosen:
 * the server leaves the stored answer alone, and no answer is never a purge. */
export function saveOverride(circleId: string, fields: CircleOverrideFields, retention: CircleRetentionChoice | null, hostedThumbnailKey?: string) {
  return call<{ ok: true }>(`/api/circle/${encodeURIComponent(circleId)}/overrides`, {
    method: "PUT",
    body: JSON.stringify({ fields, ...(retention ? { retention } : {}), ...(hostedThumbnailKey ? { hostedThumbnailKey } : {}) }),
  });
}

export function listReviewQueue(eventId = "", claimId?: string) {
  const path = "/api/admin/review-queue" + (eventId && claimId ? `?claim=${encodeURIComponent(claimId)}` : "");
  return call<ReviewQueue>(path, undefined, eventId);
}

export function decideClaim(claimId: string, decision: "approve" | "reject" | "revoke", eventId?: string) {
  return call<{ ok: true }>("/api/admin/claims", { method: "POST", body: JSON.stringify({ claimId, decision }) }, eventId);
}

export function takedownOverride(circleId: string, reason: string, eventId?: string) {
  return call<{ ok: true }>("/api/admin/overrides", { method: "POST", body: JSON.stringify({ circleId, reason }) }, eventId);
}

export type TakedownCircle = { circleId: string; name: string; status: "live" | "takendown" | "none"; cleanupPending?: boolean; verifiedClaimId?: string };
export function searchTakedownCircles(query: string, eventId: string) {
  return call<{ circles: TakedownCircle[] }>(`/api/admin/overrides?q=${encodeURIComponent(query)}`, undefined, eventId);
}

export function readAdminCircleDetail(circleId: string, eventId: string) {
  return call<AdminCircleDetail>(`/api/admin/circles/${encodeURIComponent(circleId)}`, undefined, eventId);
}

export type AdminEntry = { email: string; addedBy: string | null; addedAt: number };

export function listAdmins() {
  return call<{ admins: AdminEntry[]; self: string }>("/api/admin/admins");
}

export function manageAdmin(email: string, action: "add" | "remove") {
  return call<{ ok: true }>("/api/admin/admins", { method: "POST", body: JSON.stringify({ email, action }) });
}

export function uploadThumbnail(circleId: string, file: File, sourceUrl: string, provider: string) {
  const body = new FormData();
  body.set("file", file);
  body.set("sourceUrl", sourceUrl);
  body.set("provider", provider);
  return call<{ ok: true; thumbnail: NonNullable<CircleOverrideFields["thumbnail"]>; uploadKey: string }>(
    `/api/circle/${encodeURIComponent(circleId)}/thumbnail`,
    { method: "POST", body },
  );
}

/**
 * Stage one prepared sale-sheet page. `keep` is every image address the draft
 * still names; the route treats any other unpublished sale-sheet object of
 * this circle as abandoned.
 */
export function uploadCatalogImage(circleId: string, file: Blob, preview: Blob, keep: readonly string[]) {
  const body = new FormData();
  body.set("file", file, "catalog.jpg");
  body.set("preview", preview, "catalog-preview.jpg");
  for (const url of keep) body.append("keep", url);
  return call<{ ok: true; image: NonNullable<CircleOverrideFields["catalogImages"]>[number] }>(
    `/api/circle/${encodeURIComponent(circleId)}/catalog-image`,
    { method: "POST", body },
  );
}

export function disableAccount(email: string) {
  return call<{ ok: true }>("/api/admin/accounts", { method: "POST", body: JSON.stringify({ email }) });
}

export function readAdminAccountDetail(email: string) {
  return call<AdminAccountDetailResponse>(`/api/admin/accounts?email=${encodeURIComponent(email)}`, undefined, "");
}

export function searchAdminAccountsByCircle(circleName: string) {
  return call<AdminAccountCircleSearchResponse>(`/api/admin/accounts?circle=${encodeURIComponent(circleName)}`, undefined, "");
}

