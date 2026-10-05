import { defineMessages } from "./i18n/messages";

/**
 * The header every public page opens with (#439): the brand leading home and
 * one "登入" that leads into the control surfaces.
 *
 * Two renderers share this definition: the event chooser draws it in React,
 * and the static introduction pages write it as a string at build time. Both
 * use these class names, styled once by `public/site-header.css`, so the pages
 * cannot drift apart the way two stylesheets did.
 *
 * Nothing here knows about sessions. The public pages stay static, so the entry
 * is a plain link that never asks the server who is reading; whether someone is
 * signed in is the control surface's question, answered after they arrive.
 */
export const PUBLIC_HEADER = {
  home: "/",
  mark: "場",
  name: "場刊 Map",
  tagline: "同人展逛攤地圖",
  login: "登入",
  stylesheet: "/site-header.css",
} as const;

/**
 * The header's words in each interface language. The brand stays "場刊 Map"
 * everywhere; Traditional Chinese reuses `PUBLIC_HEADER` so the static pages
 * that have not switched to a locale yet print the same thing.
 */
export const PUBLIC_HEADER_MESSAGES = defineMessages({
  "zh-Hant": { tagline: PUBLIC_HEADER.tagline, login: PUBLIC_HEADER.login },
  en: { tagline: "Doujin event booth map", login: "Sign in" },
  ja: { tagline: "同人イベントの配置マップ", login: "ログイン" },
});

/**
 * Where "登入" leads from a page: the circle portal, told which event and
 * circle the reader was looking at, so a circle's sign-in keeps its context. A
 * circle is only ever named together with its event, and nothing is guessed
 * when a page names neither.
 */
export function publicLoginHref({ eventId, circleId }: { eventId?: string; circleId?: string } = {}) {
  if (!eventId) return "/circle";
  const query = new URLSearchParams({ event: eventId });
  if (circleId) query.set("circle", circleId);
  return `/circle?${query}`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/**
 * The same header as the chooser's, for a page written without React. The
 * actions group is where the chooser's language switcher sits; a static page
 * keeps the same slot so one stylesheet lays out both.
 */
export function publicHeaderHtml(loginHref: string) {
  const { home, mark, name, tagline, login } = PUBLIC_HEADER;
  return `<header class="site-header"><a class="site-header-brand" href="${home}"><span class="site-header-mark" aria-hidden="true">${mark}</span><span class="site-header-name"><b>${name}</b><small data-i18n="header.tagline">${tagline}</small></span></a><div class="site-header-actions"><a class="site-header-login" href="${escapeHtml(loginHref)}" data-i18n="header.login">${login}</a></div></header>`;
}
