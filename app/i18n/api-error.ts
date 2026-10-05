import type { Locale } from "./locale";
import { defineMessages, translate, type MessageCatalog } from "./messages";

export type ApiErrorParams = Record<string, string | number>;
export type ApiErrorBody = { error: string; code?: string; params?: ApiErrorParams };
export type ApiFailure = { kind: "http" | "network" | "invalid-response"; status: number; code: string | null; params: ApiErrorParams; serverMessage: string | null };

/** Fixtures in tests/fixtures/i18n/api-errors.json include legacy envelopes,
 * platform HTML and preference payloads for Reader and portal consumers.
 * Callers retain the body so conflict versions and expired share event IDs survive. */
export function readApiFailure(status: number, body: unknown): ApiFailure {
  const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const params = value.params && typeof value.params === "object" && !Array.isArray(value.params) ? value.params : {};
  return { kind: "http", status,
    code: typeof value.code === "string" && value.code.trim() ? value.code : null,
    params: Object.fromEntries(Object.entries(params).filter(([, param]) => typeof param === "string" || (typeof param === "number" && Number.isFinite(param)))),
    serverMessage: typeof value.error === "string" && value.error.trim() ? value.error : null };
}

export function networkFailure(): ApiFailure {
  return { kind: "network", status: 0, code: null, params: {}, serverMessage: null };
}

export function invalidResponseFailure(status: number): ApiFailure {
  return { kind: "invalid-response", status, code: null, params: {}, serverMessage: null };
}

export type GenericFailure = "unauthenticated" | "forbidden" | "not-found" | "gone" | "conflict" | "too-large" | "rate-limited" | "unavailable" | "network" | "invalid-response" | "unknown";

export function genericFailure(failure: ApiFailure): GenericFailure {
  if (failure.kind !== "http") return failure.kind;
  switch (failure.status) {
    case 401: return "unauthenticated";
    case 403: return "forbidden";
    case 404: return "not-found";
    case 410: return "gone";
    case 409: return "conflict";
    case 413: return "too-large";
    case 429: return "rate-limited";
    default: return failure.status >= 500 && failure.status < 600 ? "unavailable" : "unknown";
  }
}

export const COMMON_ERROR_MESSAGES: MessageCatalog<GenericFailure> = defineMessages({
  "zh-Hant": {
    unauthenticated: "請先登入。", forbidden: "你沒有權限執行這個操作。", "not-found": "找不到這筆資料。", gone: "這筆資料已失效。",
    conflict: "資料已變更，請重新載入。", "too-large": "資料太大，請縮小後再試。", "rate-limited": "請求過於頻繁，請稍後再試。",
    unavailable: "服務暫時無法使用，請稍後再試。", network: "連線失敗，請檢查網路後再試。", "invalid-response": "無法讀取回應，請重新載入。", unknown: "操作未完成，請稍後再試。",
  },
  en: {
    unauthenticated: "Please sign in.", forbidden: "You do not have permission to do this.", "not-found": "This information could not be found.", gone: "This information has expired.",
    conflict: "The information has changed. Please reload.", "too-large": "The data is too large. Please reduce its size.", "rate-limited": "Too many requests. Please try again later.",
    unavailable: "The service is unavailable. Please try again later.", network: "Connection failed. Please check your network and try again.", "invalid-response": "The response could not be read. Please reload.", unknown: "The action could not be completed. Please try again later.",
  },
  ja: {
    unauthenticated: "ログインしてください。", forbidden: "この操作を行う権限がありません。", "not-found": "情報が見つかりません。", gone: "この情報は有効期限が切れています。",
    conflict: "情報が変更されました。再読み込みしてください。", "too-large": "データが大きすぎます。サイズを小さくしてください。", "rate-limited": "リクエストが多すぎます。しばらくしてから再試行してください。",
    unavailable: "サービスを利用できません。しばらくしてから再試行してください。", network: "接続できません。ネットワークを確認して再試行してください。", "invalid-response": "応答を読み取れません。再読み込みしてください。", unknown: "操作を完了できませんでした。しばらくしてから再試行してください。",
  },
});

export function failureMessage<K extends string>(failure: ApiFailure, locale: Locale, codeMessages?: MessageCatalog<K>): string {
  if (failure.code && codeMessages && Object.hasOwn(codeMessages["zh-Hant"], failure.code)) {
    return translate(codeMessages, locale, failure.code as K, failure.params);
  }
  if (locale === "zh-Hant" && failure.serverMessage) return failure.serverMessage;
  return translate(COMMON_ERROR_MESSAGES, locale, genericFailure(failure));
}

export type { ApiErrorCode } from "./api-error-codes";
