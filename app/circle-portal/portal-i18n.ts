import { useCallback } from "react";
import { PortalError } from "../circle-editor-client";
import { failureMessage, networkFailure, readApiFailure } from "../i18n/api-error";
import { useLocale } from "../i18n/locale-context";
import type { Locale } from "../i18n/locale";
import { translate, type MessageParams } from "../i18n/messages";
import { PORTAL_MESSAGES } from "./portal-messages";
import { PORTAL_ERROR_MESSAGES } from "./portal-error-messages";

export type PortalNotice = string | { error: unknown };
export const noticeError = (error: unknown): PortalNotice => ({ error });

/** Unknown field errors and manually authored reasons remain readable. */
export function portalText(text: string, locale: Locale, params?: MessageParams) {
  return Object.hasOwn(PORTAL_MESSAGES["zh-Hant"], text) ? translate(PORTAL_MESSAGES, locale, text, params) : text;
}

export function portalNotice(value: PortalNotice, locale: Locale): string {
  if (typeof value === "string") return portalText(value, locale);
  const error = value.error;
  if (error instanceof PortalError) {
    if (locale === "zh-Hant") return error.message;
    if (!error.body?.code && Object.hasOwn(PORTAL_MESSAGES["zh-Hant"], error.message)) return portalText(error.message, locale);
    const failure = readApiFailure(error.status, error.body ?? { error: error.message });
    if (failure.params.kind === "thumbnail" || failure.params.kind === "catalog") {
      failure.params.kind = portalText(failure.params.kind === "thumbnail" ? "代表圖" : "品書", locale);
    }
    const translated = failureMessage(failure, locale, PORTAL_ERROR_MESSAGES);
    // Legacy/unknown envelopes and field validation still carry useful detail.
    // Keep it visible rather than replacing it with an unhelpful generic error.
    return failure.serverMessage && (failure.code === "invalid_fields" || !failure.code || !Object.hasOwn(PORTAL_ERROR_MESSAGES["zh-Hant"], failure.code))
      ? `${translated} ${portalText(failure.serverMessage, locale)}` : translated;
  }
  if (error instanceof Error && Object.hasOwn(PORTAL_MESSAGES["zh-Hant"], error.message)) return portalText(error.message, locale);
  return failureMessage(networkFailure(), locale);
}

export function usePortalText() {
  const { locale } = useLocale();
  return useCallback((text: string, params?: MessageParams) => portalText(text, locale, params), [locale]);
}
