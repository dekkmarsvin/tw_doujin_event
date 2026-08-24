import type { CircleOverrideFields, CircleRetentionChoice } from "./circle-overrides";

/**
 * Every authenticated write in one place, so the boundary is auditable: the
 * public reader clients never import this, and this never touches the
 * anonymous, edge-cacheable read namespace.
 */

export type PortalSession = { email: string; isAdmin: boolean };

export type ClaimSummary = {
  id: string;
  circleId: string;
  circleName: string;
  status: "pending" | "verified" | "rejected" | "revoked";
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

export class PortalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Every mutating request declares JSON, body or not. The server requires it
  // on all of them — an HTML form cannot send that content type, which is what
  // makes form-based CSRF structurally impossible — and a bodyless DELETE that
  // omitted it was rejected with a 415 before reaching any handler.
  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const multipart = typeof FormData !== "undefined" && init?.body instanceof FormData;

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(mutating && !multipart ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
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
          : "伺服器回應格式非預期，請稍後再試。",
        response.status,
      );
    }
  }

  if (!response.ok) throw new PortalError(typeof body.error === "string" ? body.error : "操作失敗。", response.status);
  return body as T;
}

/** The sitekey is public by design; it is served rather than built in so that
 * preview and production can hold different keys without a separate bundle. */
export function readTurnstileSitekey() {
  return call<{ turnstileSitekey: string }>("/api/auth/config").then((body) => body.turnstileSitekey);
}

export function requestLoginLink(email: string, turnstileToken: string) {
  return call<{ ok: true }>("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
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
};

export function searchCircles(query: string) {
  return call<{ circles: CircleMatch[] }>(`/api/circle/search?q=${encodeURIComponent(query)}`);
}

export function listMyClaims() {
  return call<{ claims: ClaimSummary[] }>("/api/claims");
}

export function createClaim(input: { circleId: string; targetUrl?: string; evidenceUrl?: string; evidenceNote?: string }) {
  return call<{ id: string; status: string; challenge: string | null; targetUrl: string | null }>("/api/claims", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export function listPendingClaims() {
  return call<{ claims: PendingClaim[] }>("/api/admin/claims");
}

export function decideClaim(claimId: string, decision: "approve" | "reject" | "revoke") {
  return call<{ ok: true }>("/api/admin/claims", { method: "POST", body: JSON.stringify({ claimId, decision }) });
}

export function takedownOverride(circleId: string, reason: string) {
  return call<{ ok: true }>("/api/admin/overrides", { method: "POST", body: JSON.stringify({ circleId, reason }) });
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

export function disableAccount(email: string) {
  return call<{ ok: true }>("/api/admin/accounts", { method: "POST", body: JSON.stringify({ email }) });
}
