import { placementStatusLabel } from "./circle-records";
import { dayDateLabel, fullDateRange } from "./event-calendar";
import { DEFAULT_LOCALE, LOCALES, localizedHref, type Locale } from "./i18n/locale";
import { initialLocale, LOCALE_CHANGE_EVENT, storeLocale, switchLocaleUrl } from "./i18n/locale-browser";
import { translate, type MessageParams } from "./i18n/messages";
import { PUBLIC_HEADER_MESSAGES } from "./public-header";
import { PUBLIC_PAGE_LOCALE_ID, PUBLIC_PAGE_MESSAGES } from "./public-page-messages";

type PageTitles = Partial<Record<Locale, { title: string; description: string }>>;
const builtHrefs = new WeakMap<HTMLAnchorElement, string>();

const ENDONYM: Record<Locale, { name: string; short: string }> = {
  "zh-Hant": { name: "繁體中文", short: "中" },
  en: { name: "English", short: "EN" },
  ja: { name: "日本語", short: "日" },
};
const LANGUAGE_LABEL: Record<Locale, string> = { "zh-Hant": "介面語言", en: "Language", ja: "表示言語" };

function message(key: string, locale: Locale, params: MessageParams) {
  const [namespace, name] = key.includes(".") ? key.split(".", 2) : ["page", key];
  if (namespace === "header") return translate(PUBLIC_HEADER_MESSAGES, locale, name as "tagline" | "login", params);
  return translate(PUBLIC_PAGE_MESSAGES, locale, name as keyof (typeof PUBLIC_PAGE_MESSAGES)["zh-Hant"], params);
}

function params(element: Element): MessageParams {
  try {
    const value: unknown = JSON.parse(element.getAttribute("data-i18n-params") ?? "{}");
    return value && typeof value === "object" ? value as MessageParams : {};
  } catch {
    return {};
  }
}

/**
 * Rewrites a static page's system words in `locale`. Every value comes from a
 * catalog or a date helper keyed by what the build wrote, so switching back to
 * Traditional Chinese restores exactly the built page. Names, venues and
 * anything a circle or organizer typed carry no marker and are never touched.
 */
export function applyPublicPageLocale(root: Document, locale: Locale) {
  root.documentElement.lang = locale;
  root.querySelectorAll("[data-i18n-booths]").forEach((element) => {
    const labels: Record<Locale, string> = JSON.parse(element.getAttribute("data-i18n-booths")!);
    element.textContent = labels[locale];
  });
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = message(element.getAttribute("data-i18n")!, locale, params(element));
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    for (const pair of element.getAttribute("data-i18n-attr")!.split(";")) {
      const [attribute, key] = pair.split(":");
      if (attribute && key) element.setAttribute(attribute, message(key, locale, params(element)));
    }
  });
  // Dates the build wrote in the event's own published form; Chinese gets that form back.
  const dated = (selector: string, format: (value: string) => string) => root.querySelectorAll(selector).forEach((element) => {
    if (!element.hasAttribute("data-i18n-built")) element.setAttribute("data-i18n-built", element.textContent ?? "");
    element.textContent = locale === DEFAULT_LOCALE ? element.getAttribute("data-i18n-built") : format(element.getAttribute(selector.slice(1, -1))!);
  });
  dated("[data-i18n-day]", (iso) => dayDateLabel(iso, locale));
  dated("[data-i18n-range]", (range) => { const [start, end] = range.split("/"); return fullDateRange(start, end, locale); });
  root.querySelectorAll("[data-i18n-status]").forEach((element) => {
    const label = placementStatusLabel(element.getAttribute("data-i18n-status") as "moved" | "cancelled", locale);
    element.textContent = element.hasAttribute("data-i18n-wrap") ? locale === "en" ? ` (${label})` : `（${label}）` : label;
  });
  // Same-site links keep the language; the built href is the Chinese one.
  root.querySelectorAll<HTMLAnchorElement>("a[href^='/'], a[href^='?']").forEach((anchor) => {
    const built = builtHrefs.get(anchor) ?? anchor.getAttribute("href")!;
    builtHrefs.set(anchor, built);
    anchor.setAttribute("href", /^\/privacy\/?$/.test(built)
      ? locale === DEFAULT_LOCALE ? "/privacy/" : `/privacy/${locale}/`
      : localizedHref(built, locale));
  });
  const titles = readTitles(root);
  const own = titles[locale];
  if (own) {
    root.title = own.title;
    root.querySelector('meta[name="description"]')?.setAttribute("content", own.description);
  }
}

function readTitles(root: Document): PageTitles {
  const element = root.getElementById(PUBLIC_PAGE_LOCALE_ID);
  if (!element) return {};
  if (!element.hasAttribute("data-zh")) {
    element.setAttribute("data-zh", JSON.stringify({ title: root.title, description: root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "" }));
  }
  try {
    return { "zh-Hant": JSON.parse(element.getAttribute("data-zh")!), ...JSON.parse(element.textContent ?? "{}") };
  } catch {
    return {};
  }
}

/** The header's language control, as plain DOM: the same select-under-a-face as the React one. */
function mountSwitcher(root: Document, locale: Locale, onChange: (locale: Locale) => void) {
  const actions = root.querySelector(".site-header-actions");
  if (!actions || actions.querySelector(".site-header-language")) return;
  const label = root.createElement("label");
  label.className = "site-header-language";
  const face = root.createElement("span");
  face.className = "site-header-language-face";
  face.setAttribute("aria-hidden", "true");
  const select = root.createElement("select");
  for (const option of LOCALES) {
    const element = root.createElement("option");
    element.value = option;
    element.lang = option;
    element.textContent = ENDONYM[option].name;
    select.append(element);
  }
  const show = (current: Locale) => {
    select.value = current;
    select.setAttribute("aria-label", LANGUAGE_LABEL[current]);
    face.innerHTML = "";
    for (const [className, text] of [["full", ENDONYM[current].name], ["short", ENDONYM[current].short]] as const) {
      const span = root.createElement("span");
      span.className = `site-header-language-${className}`;
      span.lang = current;
      span.textContent = text;
      face.append(span);
    }
  };
  show(locale);
  select.addEventListener("change", () => {
    const next = LOCALES.find(option => option === select.value);
    if (next) onChange(next);
  });
  label.append(face, select);
  actions.prepend(label);
  return show;
}

/** Runs once per static page: apply the reader's language and offer the switch. */
export function startPublicPageLocale() {
  let locale = initialLocale(window.location.href);
  if (locale !== DEFAULT_LOCALE) applyPublicPageLocale(document, locale);
  const show = mountSwitcher(document, locale, (next) => {
    storeLocale(next);
    window.history.replaceState(window.history.state, "", switchLocaleUrl(window.location.href, next));
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: next }));
  });
  window.addEventListener(LOCALE_CHANGE_EVENT, (event) => {
    const next = (event as CustomEvent<unknown>).detail;
    if (typeof next !== "string" || next === locale || !(LOCALES as readonly string[]).includes(next)) return;
    locale = next as Locale;
    applyPublicPageLocale(document, locale);
    show?.(locale);
  });
  window.addEventListener("popstate", () => {
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: initialLocale(window.location.href) }));
  });
}
