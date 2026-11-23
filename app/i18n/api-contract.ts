import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale";

export type RequestLinkLocaleResult = { ok: true; locale: Locale } | { ok: false };

export function parseRequestLinkLocale(value: unknown): RequestLinkLocaleResult {
  return value === undefined ? { ok: true, locale: DEFAULT_LOCALE } : isLocale(value) ? { ok: true, locale: value } : { ok: false };
}

export type AccountNotificationPreferencesView = { version: number; locale: Locale | null };
export type AccountNotificationPreferencesUpdate = { version: number; locale?: Locale };

/** The account's language is the only setting left (#546). */
export function parseAccountNotificationPreferencesUpdate(body: unknown): { ok: true; value: AccountNotificationPreferencesUpdate } | { ok: false; code: "invalid_notification_preferences" | "invalid_locale" } {
  const invalid = { ok: false, code: "invalid_notification_preferences" } as const;
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["version", "locale"].includes(key))
    || !Number.isSafeInteger(value.version) || (value.version as number) < 0 || !Object.hasOwn(value, "locale") || value.locale === null) return invalid;
  if (!isLocale(value.locale)) return { ok: false, code: "invalid_locale" };
  return { ok: true, value: { version: value.version as number, locale: value.locale } };
}
