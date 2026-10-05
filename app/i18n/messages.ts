import type { Locale } from "./locale";

export type MessageParams = Record<string, string | number>;
export type MessageValue = string | ((params: MessageParams, locale: Locale) => string);
export type MessageCatalog<K extends string> = { "zh-Hant": Record<K, MessageValue>; en: Partial<Record<K, MessageValue>>; ja: Partial<Record<K, MessageValue>> };

export function defineMessages<K extends string>(catalog: MessageCatalog<K>): MessageCatalog<K> {
  return catalog;
}

export function translate<K extends string>(catalog: MessageCatalog<K>, locale: Locale, key: K, params: MessageParams = {}): string {
  const value = catalog[locale][key] ?? catalog["zh-Hant"][key];
  return typeof value === "function" ? value(params, locale)
    : value.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function missingMessageKeys<K extends string>(catalog: MessageCatalog<K>, locale: Locale): K[] {
  return (Object.keys(catalog["zh-Hant"]) as K[]).filter(key => !Object.hasOwn(catalog[locale], key) || catalog[locale][key] === undefined);
}
