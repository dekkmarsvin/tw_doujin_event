export const LOCALES = ["zh-Hant", "en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-Hant";
export const LOCALE_QUERY_PARAM = "lang";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some(locale => locale === value);
}

export function canonicalLocale(value: unknown): Locale | null {
  return typeof value === "string" ? LOCALES.find(locale => locale.toLowerCase() === value.toLowerCase()) ?? null : null;
}

export function matchLanguageTag(tag: string): Locale | null {
  const parts = tag.toLowerCase().split("-");
  if (parts[0] === "en" || parts[0] === "ja") return parts[0];
  if (parts[0] !== "zh" || parts.some(part => ["hans", "cn", "sg"].includes(part))) return null;
  return parts.length === 1 || parts[1] === "hant" || ["tw", "hk", "mo"].includes(parts[1]) ? "zh-Hant" : null;
}

export function localeFromUrl(url: URL | string): Locale | null {
  try {
    return canonicalLocale((typeof url === "string" ? new URL(url, "https://locale.invalid/") : url).searchParams.get(LOCALE_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function resolveLocale(input: { url?: Locale | null; stored?: Locale | null; browser?: readonly string[] }): Locale {
  if (isLocale(input.url)) return input.url;
  if (isLocale(input.stored)) return input.stored;
  for (const tag of input.browser ?? []) {
    const locale = matchLanguageTag(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/** In-app links omit the default language; mail links (#526) explicitly set all three.
 * Edit only lang so unrelated query encoding, order and relative shape survive. */
export function localizedHref(href: string, locale: Locale): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const head = hashAt < 0 ? href : href.slice(0, hashAt);
  const queryAt = head.indexOf("?");
  const path = queryAt < 0 ? head : head.slice(0, queryAt);
  const query = queryAt < 0 ? [] : head.slice(queryAt + 1).split("&").filter(Boolean);
  let replaced = false;
  const result = query.flatMap(param => {
    if (!new URLSearchParams(param).has(LOCALE_QUERY_PARAM)) return [param];
    if (locale === DEFAULT_LOCALE || replaced) return [];
    replaced = true;
    return [`${LOCALE_QUERY_PARAM}=${locale}`];
  });
  if (locale !== DEFAULT_LOCALE && !replaced) result.push(`${LOCALE_QUERY_PARAM}=${locale}`);
  return path + (result.length ? `?${result.join("&")}` : "") + hash;
}
