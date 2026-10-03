import { parseShareSnapshot, type ShareSnapshot } from "./planning-share-snapshot";

type CreateResult = { ok: true; shareId: string; url: string; expiresAt: number }
  | { ok: false; status: number; error: string };
type ReadResult = { kind: "ok"; snapshot: ShareSnapshot; expiresAt: number }
  | { kind: "expired"; eventId: string | null }
  | { kind: "missing" }
  | { kind: "error"; error: string };

// Match the backend's canonical 16-byte base64url ID, including its final padding bits.
const validId = (id: string) => id.length === 22 && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(id);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const expiry = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const serverError = (value: unknown, fallback: string) =>
  record(value) && typeof value.error === "string" && value.error ? value.error : fallback;

/** Create an anonymous short link; all failures are displayable results. */
export async function createShortLink(snapshot: ShareSnapshot): Promise<CreateResult> {
  try {
    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: serverError(value, "建立分享清單失敗，請稍後再試。") };
    if (!record(value) || typeof value.shareId !== "string" || !validId(value.shareId)
      || typeof value.url !== "string" || !expiry(value.expiresAt)) {
      return { ok: false, status: response.status, error: "分享連結格式無效，請重新建立。" };
    }
    return { ok: true, shareId: value.shareId, url: value.url, expiresAt: value.expiresAt };
  } catch {
    return { ok: false, status: 0, error: "無法連線，請稍後再試。" };
  }
}

/** Read and validate a snapshot without writing any planning data. */
export async function readShortLink(shareId: string): Promise<ReadResult> {
  if (!validId(shareId)) return { kind: "missing" };
  try {
    const response = await fetch(`/api/shares/${shareId}`);
    if (response.status === 404) return { kind: "missing" };
    const value: unknown = await response.json().catch(() => null);
    if (response.status === 410) {
      return { kind: "expired", eventId: record(value) && typeof value.eventId === "string" ? value.eventId : null };
    }
    if (!response.ok) return { kind: "error", error: serverError(value, "讀取分享清單失敗，請稍後再試。") };
    if (!record(value) || !expiry(value.expiresAt)) return { kind: "error", error: "分享清單格式無效。" };
    const parsed = parseShareSnapshot(value.snapshot);
    if (!parsed.ok) return { kind: "error", error: parsed.error };
    return { kind: "ok", snapshot: parsed.snapshot, expiresAt: value.expiresAt };
  } catch {
    return { kind: "error", error: "無法連線，請稍後再試。" };
  }
}
