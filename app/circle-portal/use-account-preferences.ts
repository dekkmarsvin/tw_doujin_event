import { useCallback, useEffect, useRef, useState } from "react";
import { PortalError, readAccountNotificationPreferences, saveAccountNotificationPreferences } from "../circle-editor-client";
import type { AccountNotificationCadence, AccountNotificationPreferences } from "../account-notifications";
import type { Locale } from "../i18n/locale";
import { noticeError, type PortalNotice } from "./portal-i18n";

type State = {
  saved: AccountNotificationPreferences | null;
  loading: boolean;
  busy: boolean;
  error: PortalNotice | null;
  conflict: boolean;
  savedNow: boolean;
  unsavedLocale: Locale | null;
};
const INITIAL: State = { saved: null, loading: true, busy: false, error: null, conflict: false, savedNow: false, unsavedLocale: null };

/** One version owner for the circle's header and settings dialog. A queued
 * explicit choice survives a slow read/write; entering through a URL never
 * overwrites an existing preference. Only locale is sent for a locale write. */
export function useAccountPreferences(email: string | undefined, initialLocale?: Locale) {
  const [state, setState] = useState<State>(INITIAL);
  const actions = useRef<{ chooseLocale(locale: Locale): void; chooseCadence(cadence: AccountNotificationCadence): void; retry(): void; reload(): void } | null>(null);
  const localeAtEntry = useRef(initialLocale);
  useEffect(() => { localeAtEntry.current = initialLocale; }, [initialLocale]);
  useEffect(() => {
    if (!email) return;
    let active = true;
    let current = { ...INITIAL };
    let desiredLocale: Locale | null = null;
    let initialReadComplete = false;
    const update = (patch: Partial<State>) => {
      current = { ...current, ...patch };
      if (active) setState(current);
    };
    const failed = (error: unknown) => update({ error: noticeError(error), conflict: error instanceof PortalError && error.status === 409 });
    const write = async (cadence?: AccountNotificationCadence) => {
      if (!active || current.busy || current.loading || !current.saved || current.conflict) return;
      const locale = cadence ? null : desiredLocale;
      if (!cadence && !locale) return;
      update({ busy: true, error: null, savedNow: false });
      try {
        const saved = await saveAccountNotificationPreferences({ version: current.saved.version, ...(cadence ? { cadence } : { locale: locale! }) });
        if (!active) return;
        if (locale === desiredLocale) desiredLocale = null;
        update({ saved, unsavedLocale: desiredLocale, savedNow: true });
      } catch (error) {
        if (active) failed(error);
      } finally {
        if (active) {
          update({ busy: false });
          if (!current.error && desiredLocale) void write();
        }
      }
    };
    const read = async (initialize: boolean) => {
      update({ loading: true, error: null, saved: null, savedNow: false });
      try {
        const saved = await readAccountNotificationPreferences();
        if (!active) return;
        initialReadComplete = true;
        // A conflict reload shows the server's state before another explicit
        // save. It must not replay a stale selection over a concurrent change.
        if (initialize && !desiredLocale && saved.locale === null) desiredLocale = localeAtEntry.current ?? null;
        update({ saved, loading: false, conflict: false, unsavedLocale: desiredLocale });
        if (initialize && desiredLocale) void write();
      } catch (error) {
        if (active) { failed(error); update({ loading: false }); }
      }
    };
    actions.current = {
      chooseLocale(locale) { desiredLocale = locale; update({ unsavedLocale: locale, savedNow: false }); if (!current.error) void write(); },
      chooseCadence(cadence) { if (!current.error && cadence !== current.saved?.cadence) void write(cadence); },
      retry() { if (!current.saved) void read(true); else void write(); },
      reload() { if (!current.busy && !current.loading) void read(!initialReadComplete); },
    };
    void read(true);
    return () => { active = false; actions.current = null; };
  }, [email]);
  const chooseLocale = useCallback((locale: Locale) => actions.current?.chooseLocale(locale), []);
  const chooseCadence = useCallback((cadence: AccountNotificationCadence) => actions.current?.chooseCadence(cadence), []);
  const retry = useCallback(() => actions.current?.retry(), []);
  const reload = useCallback(() => actions.current?.reload(), []);
  return { ...state, chooseLocale, chooseCadence, retry, reload };
}

export type AccountPreferencesController = ReturnType<typeof useAccountPreferences>;
