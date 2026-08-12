import type { CircleOverrideFields } from "./circle-overrides";

/**
 * Every authenticated write in one place, so the boundary is auditable: the
 * public reader clients never import this, and this never touches the
 * `/data/events/` read namespace.
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
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) throw new PortalError(typeof body.error === "string" ? body.error : "操作失敗。", response.status);
  return body as T;
}

export function requestLoginLink(email: string) {
  return call<{ ok: true }>("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
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
  return call<{ fields: CircleOverrideFields; status: string }>(`/api/circle/${encodeURIComponent(circleId)}/overrides`);
}

export function saveOverride(circleId: string, fields: CircleOverrideFields) {
  return call<{ ok: true }>(`/api/circle/${encodeURIComponent(circleId)}/overrides`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
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
