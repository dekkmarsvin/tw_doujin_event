import type { AccountNotificationCadence } from "../account-notifications";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale";

export type RequestLinkLocaleResult = { ok: true; locale: Locale } | { ok: false };

export function parseRequestLinkLocale(value: unknown): RequestLinkLocaleResult {
  return value === undefined ? { ok: true, locale: DEFAULT_LOCALE } : isLocale(value) ? { ok: true, locale: value } : { ok: false };
}

export type AccountNotificationPreferencesView = { cadence: AccountNotificationCadence; version: number; locale: Locale | null };
export type AccountNotificationPreferencesUpdate = { version: number; cadence?: AccountNotificationCadence; locale?: Locale };

/** A null locale is omitted (no change). Omitting cadence means a locale-only write; servers must leave mail scheduling alone. */
export function parseAccountNotificationPreferencesUpdate(body: unknown): { ok: true; value: AccountNotificationPreferencesUpdate } | { ok: false; code: "invalid_notification_preferences" | "invalid_locale" } {
  const invalid = { ok: false, code: "invalid_notification_preferences" } as const;
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid;
  const value = body as Record<string, unknown>;
  const hasLocale = Object.hasOwn(value, "locale") && value.locale !== null, hasCadence = Object.hasOwn(value, "cadence");
  if (hasLocale && !isLocale(value.locale)) return { ok: false, code: "invalid_locale" };
  if (Object.keys(value).some(key => !["version", "cadence", "locale"].includes(key))
    || !Number.isSafeInteger(value.version) || (value.version as number) < 0 || (!hasLocale && !hasCadence)
    || (hasCadence && value.cadence !== "off" && value.cadence !== "hourly" && value.cadence !== "daily")) return invalid;
  return { ok: true, value: { version: value.version as number,
    ...(hasCadence ? { cadence: value.cadence as AccountNotificationCadence } : {}),
    ...(hasLocale ? { locale: value.locale as Locale } : {}) } };
}
