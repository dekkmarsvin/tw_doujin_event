import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locale";
import { initialLocale, storeLocale, switchLocaleUrl } from "./locale-browser";
import { translate, type MessageCatalog, type MessageParams } from "./messages";

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

/**
 * Outside a provider every component reads Traditional Chinese, so a surface
 * this period does not translate (Organizer, Admin, map contribution) keeps
 * rendering exactly what it rendered before without knowing locales exist.
 */
const LocaleContext = createContext<LocaleState>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

/**
 * Holds the interface language for one page.
 *
 * Switching only re-renders: nothing below is keyed by locale, so the Reader's
 * planning owner, a circle draft or a half-typed sign-in form survive the
 * switch. The URL is replaced, not pushed — a language is not a place back
 * should return to — and no navigation event is fired, so the Reader's own URL
 * resolution does not run again. Only an explicit switch is remembered; a
 * `?lang=` arriving on someone else's link changes this visit alone.
 */
export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setState] = useState<Locale>(() => initial ?? (typeof window === "undefined" ? DEFAULT_LOCALE : initialLocale(window.location.href)));

  useEffect(() => {
    // Back and forward can cross a `lang` the page itself wrote.
    const onPopState = () => setState(initialLocale(window.location.href));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    storeLocale(next);
    window.history.replaceState(window.history.state, "", switchLocaleUrl(window.location.href, next));
    setState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

/**
 * Declares the page language for a surface whose own words follow the locale.
 * A surface not translated yet must not call it: its Chinese would otherwise be
 * announced, broken and typeset as English or Japanese. On unmount the page
 * returns to Traditional Chinese, the language every other surface is in.
 */
export function useDocumentLanguage() {
  const { locale } = useContext(LocaleContext);
  useEffect(() => {
    document.documentElement.lang = locale;
    return () => { document.documentElement.lang = DEFAULT_LOCALE; };
  }, [locale]);
}

/** `t(key, params)` bound to the current locale and one surface's catalog. */
export function useMessages<K extends string>(catalog: MessageCatalog<K>) {
  const { locale } = useContext(LocaleContext);
  return useCallback((key: K, params?: MessageParams) => translate(catalog, locale, key, params), [catalog, locale]);
}
