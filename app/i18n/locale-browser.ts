import { isLocale, localeFromUrl, localizedHref, resolveLocale, type Locale } from "./locale";

export const LOCALE_STORAGE_KEY = "ui-locale";

/** Fired on window after an explicit switch, so a page drawn by more than one
 * renderer (a static page and its React island) follows the one choice. */
export const LOCALE_CHANGE_EVENT = "ui-locale-change";

export function readStoredLocale(storage?: Pick<Storage, "getItem"> | null): Locale | null {
  try {
    const value = (storage === undefined ? globalThis.localStorage : storage)?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Only an explicit choice is persisted, never the language of an incoming link. */
export function storeLocale(locale: Locale, storage?: Pick<Storage, "setItem"> | null): boolean {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target) return false;
    target.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function browserLanguages(nav?: { languages?: readonly string[]; language?: string } | null): readonly string[] {
  try {
    const target = nav === undefined ? globalThis.navigator : nav;
    return target?.languages?.length ? target.languages : target?.language ? [target.language] : [];
  } catch {
    return [];
  }
}

export function initialLocale(href: string, storage?: Pick<Storage, "getItem"> | null, nav?: { languages?: readonly string[]; language?: string } | null): Locale {
  return resolveLocale({ url: localeFromUrl(href), stored: readStoredLocale(storage), browser: browserLanguages(nav) });
}

export function switchLocaleUrl(href: string, locale: Locale): string {
  return localizedHref(href, locale);
}
