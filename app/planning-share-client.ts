import { failureMessage, invalidResponseFailure, networkFailure, readApiFailure, type ApiFailure } from "./i18n/api-error";
import type { Locale } from "./i18n/locale";
import { defineMessages } from "./i18n/messages";
import { parseShareSnapshot, type ShareSnapshot } from "./planning-share-snapshot";

/** `error` is the Traditional Chinese sentence shown before codes existed; `failure` carries the code for other languages. */
type CreateResult = { ok: true; shareId: string; url: string; expiresAt: number }
  | { ok: false; status: number; error: string; failure: ApiFailure };
type ReadResult = { kind: "ok"; snapshot: ShareSnapshot; expiresAt: number }
  | { kind: "expired"; eventId: string | null }
  | { kind: "missing" }
  | { kind: "error"; error: string; failure: ApiFailure };

/** Share API codes (API_ERROR_CODES); zh-Hant repeats the server's own sentences. */
export const SHARE_ERROR_MESSAGES = defineMessages({
  "zh-Hant": {
    share_invalid: "分享清單格式無效或超過大小限制。",
    share_snapshot_invalid: "分享清單格式無效。",
    share_event_ended: "活動的分享期限已結束。",
    share_not_found: "這個分享連結不存在或已過期。",
    share_expired: "這份清單已過期。",
    rate_limited: "建立分享清單太頻繁，請稍後再試。",
    origin_mismatch: "來源不符，請重新整理後再試。",
    invalid_content_type: "請求格式無效。",
    event_not_found: "活動尚未公開或不存在。",
  },
  en: {
    share_invalid: "The share list is invalid or too large.",
    share_snapshot_invalid: "The share list is invalid.",
    share_event_ended: "Sharing has closed for this event.",
    share_not_found: "This share link does not exist or has expired.",
    share_expired: "This list has expired.",
    rate_limited: "Too many share links created. Please try again later.",
    origin_mismatch: "The request came from an unexpected page. Please reload and try again.",
    invalid_content_type: "The request format is invalid.",
    event_not_found: "This event is not public or does not exist.",
  },
  ja: {
    share_invalid: "共有リストの形式が正しくないか、サイズが大きすぎます。",
    share_snapshot_invalid: "共有リストの形式が正しくありません。",
    share_event_ended: "このイベントの共有期間は終了しました。",
    share_not_found: "この共有リンクは存在しないか、有効期限が切れています。",
    share_expired: "このリストは有効期限が切れています。",
    rate_limited: "共有リンクの作成回数が多すぎます。しばらくしてから再試行してください。",
    origin_mismatch: "想定外のページからのリクエストです。再読み込みしてから再試行してください。",
    invalid_content_type: "リクエストの形式が正しくありません。",
    event_not_found: "このイベントは公開されていないか、存在しません。",
  },
});

/** A coded failure reads in the reader's language; without a code zh-Hant keeps the server's (or this client's) sentence. */
export function shareFailureMessage(failure: ApiFailure, locale: Locale): string {
  return failureMessage(failure, locale, SHARE_ERROR_MESSAGES);
}

// Match the backend's canonical 16-byte base64url ID, including its final padding bits.
const validId = (id: string) => id.length === 22 && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(id);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const expiry = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** Keeps the Chinese sentence shown before codes existed as the zh-Hant fallback. */
const failed = (failure: ApiFailure, fallback: string) => {
  const withMessage = { ...failure, serverMessage: failure.serverMessage ?? fallback };
  return { error: withMessage.serverMessage, failure: withMessage };
};

/** Create an anonymous short link; all failures are displayable results. */
export async function createShortLink(snapshot: ShareSnapshot): Promise<CreateResult> {
  try {
    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, ...failed(readApiFailure(response.status, value), "建立分享清單失敗，請稍後再試。") };
    if (!record(value) || typeof value.shareId !== "string" || !validId(value.shareId)
      || typeof value.url !== "string" || !expiry(value.expiresAt)) {
      return { ok: false, status: response.status, ...failed(invalidResponseFailure(response.status), "分享連結格式無效，請重新建立。") };
    }
    return { ok: true, shareId: value.shareId, url: value.url, expiresAt: value.expiresAt };
  } catch {
    return { ok: false, status: 0, ...failed(networkFailure(), "無法連線，請稍後再試。") };
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
    if (!response.ok) return { kind: "error", ...failed(readApiFailure(response.status, value), "讀取分享清單失敗，請稍後再試。") };
    if (!record(value) || !expiry(value.expiresAt)) return { kind: "error", ...failed(invalidResponseFailure(response.status), "分享清單格式無效。") };
    const parsed = parseShareSnapshot(value.snapshot);
    if (!parsed.ok) return { kind: "error", ...failed(invalidResponseFailure(response.status), parsed.error) };
    return { kind: "ok", snapshot: parsed.snapshot, expiresAt: value.expiresAt };
  } catch {
    return { kind: "error", ...failed(networkFailure(), "無法連線，請稍後再試。") };
  }
}
