import type { EventDefinition } from "./event-catalog";
import { placementStatusLabel } from "./circle-records";
import { eventCalendar, eventDayCalendarDate, fullDateRange, shortDate } from "./event-calendar";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
import { defineMessages, translate } from "./i18n/messages";

export const PUBLIC_ORIGIN = "https://map.kotoban.top";
export const SITE_TITLE = "場刊 Map｜同人展逛攤地圖";
export const SITE_DESCRIPTION = "搜尋同人展攤位、收藏社團並規劃你的逛攤路線。";

/** Page titles and descriptions in each interface language. Names, dates,
 * venues and booth codes are filled in; the brand stays "場刊 Map". */
const METADATA_MESSAGES = defineMessages({
  "zh-Hant": {
    siteTitle: SITE_TITLE,
    siteDescription: SITE_DESCRIPTION,
    closing: "查看攤位位置、收藏社團並規劃逛攤路線。",
    listSeparator: "、",
    daySeparator: "；",
    eventTitle: "{event}攤位地圖與社團查詢｜場刊 Map",
    eventTitleAlias: "{event}（{alias}）",
    eventDescription: "{event}的社團與攤位地圖。{dates}，{venues}。{closing}",
    circleTitle: "{circle}｜{event}{booths}｜場刊 Map",
    circleWithBooths: "{circle}在{event}的攤位：{summary}。{venues}。{closing}",
    circleWithoutBooths: "{circle}在{event}的參展日期與攤位。{dates}，{venues}。{closing}",
    boothStatus: "{code}（{status}）",
  },
  en: {
    siteTitle: "場刊 Map | Doujin event booth map",
    siteDescription: "Search doujin event booths, save circles and plan your route.",
    closing: "See where booths are, save circles and plan your route.",
    listSeparator: ", ",
    daySeparator: "; ",
    eventTitle: "{event} booth map and circles | 場刊 Map",
    eventTitleAlias: "{event} ({alias}) ",
    eventDescription: "Circles and booth map for {event}. {dates}, {venues}. {closing}",
    circleTitle: "{circle} | {event}{booths} | 場刊 Map",
    circleWithBooths: "{circle} at {event}: booths {summary}. {venues}. {closing}",
    circleWithoutBooths: "{circle} at {event}: dates and booths. {dates}, {venues}. {closing}",
    boothStatus: "{code} ({status})",
  },
  ja: {
    siteTitle: "場刊 Map｜同人イベントの配置マップ",
    siteDescription: "同人イベントのスペースを検索し、サークルをお気に入りに登録して巡回ルートを計画できます。",
    closing: "スペースの場所を確認し、サークルをお気に入りに登録して巡回ルートを計画できます。",
    listSeparator: "、",
    daySeparator: "；",
    eventTitle: "{event}配置マップ・サークル検索｜場刊 Map",
    eventTitleAlias: "{event}（{alias}）",
    eventDescription: "{event}のサークルと配置マップ。{dates}、{venues}。{closing}",
    circleTitle: "{circle}｜{event}{booths}｜場刊 Map",
    circleWithBooths: "{event}の{circle}のスペース：{summary}。{venues}。{closing}",
    circleWithoutBooths: "{event}の{circle}の参加日とスペース。{dates}、{venues}。{closing}",
    boothStatus: "{code}（{status}）",
  },
});
/** The brand card every page shares (#363). A 1200×630 PNG, because most
 * platforms that unfurl a link refuse SVG; its address is absolute because
 * they fetch it from their own servers. */
export const SHARE_IMAGE = { url: `${PUBLIC_ORIGIN}/share-card.png`, width: 1200, height: 630 } as const;

function segment(id: string) {
  if (!id || id === "." || id === "..") throw new Error("Invalid discovery identifier.");
  return encodeURIComponent(id);
}
export const eventPath = (id: string) => `/events/${segment(id)}/`;
export const circlePath = (eventId: string, circleId: string) => `${eventPath(eventId)}circles/${segment(circleId)}/`;

export function readerLink(event: EventDefinition, placement?: { day: string | number; area: string; boothCode: string; circleId: string }) {
  const query = new URLSearchParams({ event: event.id });
  if (placement) {
    query.set("day", String(placement.day));
    query.set("area", placement.area);
    const venue = event.venueAssignments.find((assignment) => assignment.areaIds.includes(placement.area));
    if (venue) query.set("venueSpaceId", venue.venueSpaceId);
    query.set("selectedCircle", placement.circleId);
    query.set("selectedBooth", placement.boothCode);
  }
  return `/?${query}`;
}

/** A circle's placement as both the static page and the Reader hold it. */
export type MetadataPlacement = { day: string | number; boothCode: string; status: "active" | "cancelled" | "moved" };

/** Where a circle is, earliest day first, for a search result that must tell
 * two same-named circles apart. Only active placements say where a circle is
 * now; a moved or cancelled one always carries its status words (#361). */
export function circleBooths(event: EventDefinition, placements: readonly MetadataPlacement[], locale: Locale = DEFAULT_LOCALE) {
  const order = (day: string | number) => event.days.findIndex((candidate) => String(candidate.id) === String(day));
  // Earliest by calendar date: a corrected date can leave day 1 after day 2
  // (ADR-0068). Declaration order only decides between days with no date.
  const rows = placements.map((placement) => ({ ...placement, date: eventDayCalendarDate(event, placement.day) }))
    .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || order(a.day) - order(b.day)
      || a.boothCode.localeCompare(b.boothCode, "en", { numeric: true }));
  if (!rows.length) return null;
  const t = (key: keyof (typeof METADATA_MESSAGES)["zh-Hant"], params?: Record<string, string>) => translate(METADATA_MESSAGES, locale, key, params);
  const when = (row: (typeof rows)[number], format: (iso: string) => string) => row.date ? format(row.date)
    : event.days[order(row.day)]?.dateLabel ?? String(row.day);
  const active = rows.filter((row) => row.status === "active");
  const first = active[0] ?? rows[0];
  const headline = active.length
    ? `${when(first, (iso) => shortDate(iso, locale))} ${active.filter((row) => String(row.day) === String(first.day)).map((row) => row.boothCode).join(t("listSeparator"))}`
    : `${when(first, (iso) => shortDate(iso, locale))} ${first.boothCode} ${placementStatusLabel(first.status, locale)}`;
  const summary = [...new Set(rows.map((row) => String(row.day)))].map((day) => {
    const onDay = rows.filter((row) => String(row.day) === day);
    const codes = onDay.map((row) => row.status === "active" ? row.boothCode : t("boothStatus", { code: row.boothCode, status: placementStatusLabel(row.status, locale) }));
    return `${when(onDay[0], (iso) => fullDateRange(iso, iso, locale))} ${codes.join(t("listSeparator"))}`;
  }).join(t("daySeparator"));
  return { headline, summary };
}

/** The open-graph spelling of each interface language. */
export const OG_LOCALE: Record<Locale, string> = { "zh-Hant": "zh_TW", en: "en_US", ja: "ja_JP" };

/**
 * A page's title, description, canonical address and card. `locale` is the
 * interface language the page is written in; it reaches the dates, booth
 * statuses, sentences, `og:locale` and the static page's `lang`. Canonical
 * addresses never carry a language: one indexable page per event or circle.
 */
export function pageMetadata(event?: EventDefinition, circle?: { id: string; name: string }, placements: readonly MetadataPlacement[] = [], locale: Locale = DEFAULT_LOCALE) {
  const t = (key: keyof (typeof METADATA_MESSAGES)["zh-Hant"], params?: Record<string, string>) => translate(METADATA_MESSAGES, locale, key, params);
  if (!event) return { title: t("siteTitle"), description: t("siteDescription"), canonical: `${PUBLIC_ORIGIN}/`, image: SHARE_IMAGE, locale };
  const calendar = eventCalendar(event, locale);
  const dates = calendar.start ? fullDateRange(calendar.start, calendar.end, locale) : calendar.label;
  const venues = [...new Set(event.venueAssignments.map((venue) => venue.venueName))].join(t("listSeparator"));
  const closing = t("closing");
  // Aliases are what organizers and readers actually call the event (ADR-0068).
  // The event page gives both names; a circle page uses the first alias, the
  // event's short name. An event without aliases reads as it always did.
  const aliases = event.aliases ?? [];
  if (!circle) return {
    title: t("eventTitle", { event: aliases.length ? t("eventTitleAlias", { event: event.name, alias: aliases[0] }) : `${event.name} ` }),
    description: t("eventDescription", { event: aliases.length ? t("eventTitleAlias", { event: event.name, alias: aliases.join(t("listSeparator")) }).trimEnd() : event.name, dates, venues, closing }),
    canonical: PUBLIC_ORIGIN + eventPath(event.id),
    // An event page shares its own picture when it has one (#396); circle
    // pages and the homepage keep the brand card.
    image: event.image ?? SHARE_IMAGE,
    locale,
  };
  const booths = circleBooths(event, placements, locale);
  return {
    title: t("circleTitle", { circle: circle.name, event: aliases[0] ?? event.name, booths: booths ? ` ${booths.headline}` : "" }),
    description: booths ? t("circleWithBooths", { circle: circle.name, event: event.name, summary: booths.summary, venues, closing })
      : t("circleWithoutBooths", { circle: circle.name, event: event.name, dates, venues, closing }),
    canonical: PUBLIC_ORIGIN + circlePath(event.id, circle.id),
    image: SHARE_IMAGE,
    locale,
  };
}

/** Reader only: the two control-plane documents keep their own robots policy. */
export function applyReaderMetadata(metadata: ReturnType<typeof pageMetadata>, noindex = false) {
  document.title = metadata.title;
  const meta = (key: string, value: string, attribute = "name") => {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) { element = document.createElement("meta"); element.setAttribute(attribute, key); document.head.append(element); }
    element.content = value;
  };
  meta("description", metadata.description);
  meta("og:title", metadata.title, "property");
  meta("og:description", metadata.description, "property");
  meta("og:url", metadata.canonical, "property");
  meta("og:image", metadata.image.url, "property");
  meta("og:image:width", String(metadata.image.width), "property");
  meta("og:image:height", String(metadata.image.height), "property");
  meta("twitter:card", "summary_large_image");
  meta("twitter:title", metadata.title);
  meta("twitter:description", metadata.description);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); }
  canonical.href = metadata.canonical;
  if (noindex) meta("robots", "noindex");
  else document.head.querySelector('meta[name="robots"]')?.remove();
}
