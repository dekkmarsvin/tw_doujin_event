import type { EventDefinition } from "./event-catalog";
import type { CircleCatalogPayload } from "./circle-records";
import { placementStatusLabel } from "./circle-records";
import { dayDateLabel, eventCalendar, eventDayCalendarDate, eventDayDate, taipeiDate } from "./event-calendar";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
import { circleBooths, circlePath, eventPath, OG_LOCALE, pageMetadata, PUBLIC_ORIGIN, readerLink, SHARE_IMAGE, SITE_TITLE } from "./seo";
import { CIRCLE_PAGE_ACTIONS_ID, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE, CIRCLE_PAGE_ROOT_ID, circlePageData, circlePageDataHtml } from "./circle-page-data";
import { PUBLIC_HEADER, publicHeaderHtml, publicLoginHref } from "./public-header";
import { PUBLIC_PAGE_LOCALE_ID, PUBLIC_PAGE_MESSAGES, type PublicPageMessageKey } from "./public-page-messages";
import { translate, type MessageParams } from "./i18n/messages";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const link = (href: string, text: string, className = "") => `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
/** Built in Chinese and keyed, so the page script can say it in the reader's language (#525). */
const say = (key: PublicPageMessageKey, params?: MessageParams) => translate(PUBLIC_PAGE_MESSAGES, DEFAULT_LOCALE, key, params);
const keyed = (key: PublicPageMessageKey, params?: MessageParams) => ` data-i18n="${key}"${params ? ` data-i18n-params="${escapeHtml(JSON.stringify(params))}"` : ""}`;
const text = (tag: string, key: PublicPageMessageKey, params?: MessageParams, attributes = "") => `<${tag}${attributes}${keyed(key, params)}>${escapeHtml(say(key, params))}</${tag}>`;
const keyedLink = (href: string, key: PublicPageMessageKey, className = "") => `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(href)}"${keyed(key)}>${escapeHtml(say(key))}</a>`;
/** A booth status the script can reword; the build writes the Chinese form. */
const statusHtml = (status: "active" | "cancelled" | "moved", wrapped = false) => status === "active" ? ""
  : `<span data-i18n-status="${status}"${wrapped ? " data-i18n-wrap" : ""}>${escapeHtml(wrapped ? `（${placementStatusLabel(status)}）` : placementStatusLabel(status))}</span>`;
/** The other languages' title and description, for the page script to swap in. */
type PageTitles = Partial<Record<Locale, { title: string; description: string }>>;
const titlesFor = (build: (locale: Locale) => { title: string; description: string }): PageTitles =>
  Object.fromEntries((["en", "ja"] as const).map((locale) => { const { title, description } = build(locale); return [locale, { title, description }]; }));

/** `metadata.locale` is optional so a page that builds its own metadata (the short-link page) stays Traditional Chinese. */
export function metadataHtml(metadata: Omit<ReturnType<typeof pageMetadata>, "locale"> & { locale?: Locale }, canonical = true) {
  return `<title>${escapeHtml(metadata.title)}</title>
<meta name="description" content="${escapeHtml(metadata.description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(metadata.canonical)}"><meta property="og:url" content="${escapeHtml(metadata.canonical)}">` : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="場刊 Map"><meta property="og:locale" content="${OG_LOCALE[metadata.locale ?? DEFAULT_LOCALE]}">
<meta property="og:title" content="${escapeHtml(metadata.title)}"><meta property="og:description" content="${escapeHtml(metadata.description)}">
<meta property="og:image" content="${escapeHtml(metadata.image.url)}"><meta property="og:image:width" content="${metadata.image.width}"><meta property="og:image:height" content="${metadata.image.height}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(metadata.title)}"><meta name="twitter:description" content="${escapeHtml(metadata.description)}">`;
}

/** `loginHref` is where the header's "登入" leads from this page (#439). */
function documentHtml(metadata: Parameters<typeof metadataHtml>[0], content: string, { loginHref, schema, assets = "", titles }: { loginHref: string; schema?: unknown; assets?: string; titles?: PageTitles }) {
  return `<!doctype html><html lang="${metadata.locale ?? DEFAULT_LOCALE}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${metadataHtml(metadata)}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts/geist.css"><link rel="stylesheet" href="/discovery.css"><link rel="stylesheet" href="${PUBLIC_HEADER.stylesheet}">
${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ""}${titles ? `<script type="application/json" id="${PUBLIC_PAGE_LOCALE_ID}">${json(titles)}</script>` : ""}${assets}</head><body class="discovery">${publicHeaderHtml(loginHref)}<main>${content}</main><footer>${keyedLink(PORTAL_INTRO_PATH, "footerPortal")}${keyedLink("/privacy/", "footerPrivacy")}</footer></body></html>`;
}

// Postal code, country, city or county, postal code, district, the rest.
const TAIWAN_ADDRESS = /^(?:(\d{3}(?:\d{2,3})?) ?)?(?:(?:中華民國|[臺台]灣) ?)?([臺台]北市|新北市|桃園市|[臺台]中市|[臺台]南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|[臺台]東縣|澎湖縣|金門縣|連江縣) ?(?:(\d{3}(?:\d{2,3})?) ?)?(?:([^\s\d]{1,3}?[區鄉鎮市]) ?)?(.+)$/u;

/**
 * The venue's address as schema.org wants it, split from the one line the
 * venue's official page prints (#395). Taiwanese addresses name the city or
 * county, then the district, and put the postal code in front of either; a
 * line that does not read that way is still an address, and goes out whole
 * as the street rather than being dropped or guessed at.
 */
export function venuePostalAddress(address: string) {
  const [, leadingCode, region, innerCode, locality, street] = TAIWAN_ADDRESS.exec(address) ?? [];
  const postalCode = leadingCode ?? innerCode;
  return region ? {
    "@type": "PostalAddress", streetAddress: street, ...(locality ? { addressLocality: locality } : {}), addressRegion: region,
    ...(postalCode ? { postalCode } : {}), addressCountry: "TW",
  } : { "@type": "PostalAddress", streetAddress: address, addressCountry: "TW" };
}

/** The event's dates, rewritten for the reader when they are real dates. */
function calendarHtml(calendar: ReturnType<typeof eventCalendar>) {
  return calendar.start ? `<span data-i18n-range="${calendar.start}/${calendar.end}">${escapeHtml(calendar.label)}</span>` : escapeHtml(calendar.label);
}

function eventFacts(event: EventDefinition) {
  const calendar = eventCalendar(event);
  const venues = [...new Set(event.venueAssignments.map((venue) => venue.venueName))];
  return `<p class="eyebrow">${calendarHtml(calendar)}</p><p>${escapeHtml(venues.join("、"))}</p>
<p>${text("span", "organizers")}${event.organizerAssignments.map((organizer) => link(organizer.officialUrl, organizer.name)).join("、")}</p>
<p>${keyedLink(event.officialData.eventUrl, "eventSite")}</p>`;
}

/** The site's own name for search results (#365). Only the homepage carries
 * it, once, in the head the build writes; the Reader never adds another. */
export function websiteSchemaHtml() {
  return `<script type="application/ld+json">${json({ "@context": "https://schema.org", "@type": "WebSite", name: "場刊 Map", url: `${PUBLIC_ORIGIN}/` })}</script>`;
}

/** What the homepage shows before its script runs, under the same header the
 * chooser then draws, so the header does not move when the chooser takes over. */
export function homepageSummary(events: readonly EventDefinition[]) {
  return `${publicHeaderHtml(publicLoginHref())}<main class="discovery-summary"><h1>${escapeHtml(SITE_TITLE)}</h1><p>選擇活動，查看日期、場館、社團與攤位。</p><ul>${events.map((event) => `<li>${link(eventPath(event.id), event.name)} · ${escapeHtml(eventCalendar(event).label)} · ${escapeHtml(event.venue)}</li>`).join("")}</ul></main>`;
}

/**
 * Only the reviewed base is accepted; no overlay fields are projected into HTML.
 *
 * `circlePageAssets` is the tags that load a circle page's own script, which
 * reads the circle's content live and offers the planning actions. The page is
 * complete without it: name, every placement and its map link are static.
 */
export function discoveryPages(event: EventDefinition, catalog: CircleCatalogPayload, { circlePageAssets = "", pageAssets = "" }: { circlePageAssets?: string; pageAssets?: string } = {}) {
  if (catalog.eventId !== event.id) throw new Error("Discovery catalog must belong to its event.");
  const pages = new Map<string, string>();
  const circles = catalog.circles.filter((circle) => catalog.placements.some((placement) => placement.circleId === circle.id));
  const placementsOf = (circleId: string) => catalog.placements.filter((placement) => placement.circleId === circleId);
  // Same-named circles are separate circles (their days are separate evidence);
  // the directory tells them apart by where each one is, as their titles do.
  const named = new Map<string, number>();
  for (const circle of circles) named.set(circle.name, (named.get(circle.name) ?? 0) + 1);
  const listed = (circle: (typeof circles)[number]) => {
    const name = escapeHtml(circle.name);
    if ((named.get(circle.name) ?? 0) < 2) return name;
    const suffixes = Object.fromEntries((["zh-Hant", "en", "ja"] as const).map((locale) =>
      [locale, `（${circleBooths(event, placementsOf(circle.id), locale)?.headline}）`]));
    return `${name}<span data-i18n-booths="${escapeHtml(JSON.stringify(suffixes))}">${escapeHtml(suffixes["zh-Hant"])}</span>`;
  };
  const dateEnd = taipeiDate(Date.parse(event.eventEndsAt));
  const dates = event.days.map((day) => eventDayDate(day.dateLabel, dateEnd));
  const calendar = eventCalendar(event);
  const schema = dates.every(Boolean) ? {
    "@context": "https://schema.org", "@type": "Event", name: event.name,
    ...(event.aliases?.length ? { alternateName: [...event.aliases] } : {}),
    url: PUBLIC_ORIGIN + eventPath(event.id), description: pageMetadata(event).description,
    // The event's own picture when it has one (#396), else the brand card the
    // page's og:image also names; Search Console asks for one either way.
    image: [pageMetadata(event).image.url],
    startDate: [...dates].sort()[0], endDate: [...dates].sort().at(-1),
    location: [...new Map(event.venueAssignments.map((venue) => [venue.venueId, { "@type": "Place", name: venue.venueName, url: venue.venueOfficialUrl,
      ...(venue.venueAddress ? { address: venuePostalAddress(venue.venueAddress) } : {}) }])).values()],
    organizer: event.organizerAssignments.map((organizer) => ({ "@type": "Organization", name: organizer.name, url: organizer.officialUrl })),
  } : undefined;
  const aliases = event.aliases?.length ? `<p>${text("span", "aliases")}${escapeHtml(event.aliases.join("、"))}</p>` : "";
  const directory = (entries: readonly string[]) => `<ul class="circle-directory">${entries.map((entry) => `<li>${entry}</li>`).join("")}</ul>`;
  const entry = (circle: (typeof circles)[number], status: "active" | "cancelled" | "moved" = "active") => `<a href="${escapeHtml(circlePath(event.id, circle.id))}">${listed(circle)}${statusHtml(status, true)}</a>`;
  pages.set(eventPath(event.id), documentHtml(pageMetadata(event), `<h1>${escapeHtml(event.name)}</h1>${aliases}${eventFacts(event)}
<p class="entries">${keyedLink(readerLink(event), "openMap", "primary")}${keyedLink(readerLink(event) + "&view=browse", "browse", "secondary")}</p>
<section>${text("h2", "circlesHeading")}${text("p", "circleCount", { count: circles.length })}${event.days.length > 1 ? dayDirectory() : directory(circles.map((circle) => entry(circle)))}</section>`,
  { loginHref: publicLoginHref({ eventId: event.id }), schema, assets: pageAssets, titles: titlesFor((locale) => pageMetadata(event, undefined, [], locale)) }));
  /** A multi-day event lists its circles day by day, the way readers plan and
   * search a day (#364). A circle appears under every day it has a placement,
   * each entry linking to its one page; a day it only moved away from or
   * cancelled carries the status words, so it is never listed as present. */
  function dayDirectory() {
    const days = event.days.map((day, index) => ({ day, index, date: eventDayCalendarDate(event, day.id) }))
      .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || a.index - b.index);
    return days.map(({ day, date }) => {
      const onDay = circles.flatMap((circle) => {
        const all = placementsOf(circle.id);
        const here = all.filter((placement) => String(placement.day) === String(day.id));
        if (!here.length) return [];
        if (here.some((placement) => placement.status === "active")) return [entry(circle)];
        // Label the day by where the circle ended up, not by catalog order: a
        // circle still somewhere in the event moved; one nowhere withdrew.
        const elsewhere = all.some((placement) => placement.status === "active");
        const has = (status: "moved" | "cancelled") => here.some((placement) => placement.status === status);
        const status = elsewhere ? (has("moved") ? "moved" : "cancelled") : (has("cancelled") ? "cancelled" : "moved");
        return [entry(circle, status)];
      });
      return `<h3${date ? ` data-i18n-day="${date}"` : ""}>${escapeHtml(date ? dayDateLabel(date) : day.dateLabel)}</h3>${text("p", "circleCount", { count: onDay.length })}${directory(onDay)}`;
    }).join("");
  }
  for (const circle of circles) {
    const placements = placementsOf(circle.id);
    const cards = boothCards(event, placements);
    const venues = [...new Set(cards.filter((card) => card.status === "active").map((card) => card.venueName).filter(Boolean))];
    const claim = publicLoginHref({ eventId: event.id, circleId: circle.id });
    pages.set(circlePath(event.id, circle.id), documentHtml(pageMetadata(event, circle, placements), `<nav aria-label="${escapeHtml(say("eventNav"))}" data-i18n-attr="aria-label:eventNav">${link(eventPath(event.id), event.name)}</nav>
<h1>${escapeHtml(circle.name)}</h1><p class="eyebrow">${[calendarHtml(calendar), ...venues.map(escapeHtml)].join(" · ")}</p>
<div id="${CIRCLE_PAGE_ACTIONS_ID}"></div>
${text("h2", "boothsHeading")}<ol class="booth-cards">${cards.map((card) => boothCardHtml(event, card)).join("")}</ol>
<div id="${CIRCLE_PAGE_ROOT_ID}"></div>${circlePageDataHtml(circlePageData(catalog, circle.id))}
<p class="claim">${text("span", "claimQuestion")}${keyedLink(claim, "claimLink")}</p>`,
    { loginHref: claim, assets: circlePageAssets, titles: titlesFor((locale) => pageMetadata(event, circle, placements, locale)) }));
  }
  return pages;
}

type CardPlacement = CircleCatalogPayload["placements"][number];
type BoothCard = { day: CardPlacement["day"]; when: string; date: string | null; where: string; venueName: string; status: CardPlacement["status"]; placements: CardPlacement[]; planSlot: boolean };

/**
 * A circle's placements as a reader goes looking for them: one card per day
 * and place, the booth codes large. Booths the circle holds side by side on
 * one day share a card; a booth it moved away from or cancelled gets its own,
 * so the status words never sit beside a booth that is still the destination.
 *
 * The first card the circle can actually be visited at on each day carries the
 * slot the page script fills with that day's plan action — one per day, as a
 * plan is one per day. Without the script the card is still complete.
 */
function boothCards(event: EventDefinition, placements: readonly CardPlacement[]) {
  const cards = new Map<string, BoothCard & { order: number }>();
  for (const placement of placements) {
    const order = event.days.findIndex((candidate) => String(candidate.id) === String(placement.day));
    const date = eventDayCalendarDate(event, placement.day);
    const venue = event.venueAssignments.find((assignment) => assignment.areaIds.includes(placement.area));
    const area = event.areas.find((candidate) => candidate.id === placement.area);
    const where = [venue?.venueName, venue?.venueSpaceName, area?.label].filter(Boolean).join(" · ");
    const key = `${String(placement.day)}\u0000${where}\u0000${placement.status}`;
    const card: BoothCard & { order: number } = cards.get(key) ?? {
      day: placement.day, when: date ? dayDateLabel(date) : event.days[order]?.dateLabel ?? String(placement.day),
      where, venueName: venue?.venueName ?? "", status: placement.status, placements: [], planSlot: false, date, order,
    };
    card.placements.push(placement);
    cards.set(key, card);
  }
  const sorted = [...cards.values()].sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || a.order - b.order
    || Number(a.status !== "active") - Number(b.status !== "active")
    || a.placements[0].boothCode.localeCompare(b.placements[0].boothCode, "en", { numeric: true }));
  const planned = new Set<string>();
  for (const card of sorted) {
    card.placements.sort((a, b) => a.boothCode.localeCompare(b.boothCode, "en", { numeric: true }));
    if (card.status === "active" && !planned.has(String(card.day))) {
      card.planSlot = true;
      planned.add(String(card.day));
    }
  }
  return sorted;
}

function boothCardHtml(event: EventDefinition, card: BoothCard) {
  const retired = card.status !== "active";
  const codes = card.placements.map((placement) => `<span class="booth-code tone-${escapeHtml(placement.tone)}">${escapeHtml(placement.boothCode)}</span>`).join("");
  return `<li class="booth-card${retired ? " retired" : ""}"><p class="booth-when"${card.date ? ` data-i18n-day="${card.date}"` : ""}>${escapeHtml(card.when)}</p><p class="booth-codes">${codes}</p>
${card.where ? `<p class="booth-where">${escapeHtml(card.where)}</p>` : ""}${retired ? `<p class="status">${statusHtml(card.status)}</p>` : ""}
<div class="booth-actions">${keyedLink(readerLink(event, card.placements[0]), "viewOnMap", "booth-map")}${card.planSlot ? `<span class="booth-plan" ${CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE}="${escapeHtml(String(card.day))}"></span>` : ""}</div></li>`;
}

export const PORTAL_INTRO_PATH = "/portal/";

type PortalDemo = { file: string; alt: PublicPageMessageKey; caption: PublicPageMessageKey };
type PortalSection = {
  id: string; title: PublicPageMessageKey; tagline: PublicPageMessageKey;
  access: { heading: PublicPageMessageKey; ordered: boolean; items: readonly PublicPageMessageKey[] };
  abilities: readonly PublicPageMessageKey[]; notes: readonly PublicPageMessageKey[];
  demos: readonly PortalDemo[]; action: { href: string; label: PublicPageMessageKey };
};

// What signing in opens, for circles and organizers who have not used the
// site yet. The sign-in pages link here instead of carrying it, so a returning
// user signs in in one short step. Every line must stay true to the circle and
// organizer contracts: an action only some roles have names the role. The
// words live in PUBLIC_PAGE_MESSAGES, in all three languages.
const PORTAL_SECTIONS: readonly PortalSection[] = [
  {
    id: "circle", title: "portalCircleTitle", tagline: "portalCircleTagline",
    access: { heading: "portalCircleAccess", ordered: true, items: ["portalCircleAccess1", "portalCircleAccess2", "portalCircleAccess3"] },
    abilities: ["portalCircleAbility1", "portalCircleAbility2", "portalCircleAbility3", "portalCircleAbility4"],
    notes: ["portalCircleNote"],
    demos: [
      { file: "circle-map-card", alt: "portalCircleDemo1Alt", caption: "portalCircleDemo1" },
      { file: "circle-editor", alt: "portalCircleDemo2Alt", caption: "portalCircleDemo2" },
    ],
    action: { href: "/circle", label: "portalCircleAction" },
  },
  {
    id: "organizer", title: "portalOrganizerTitle", tagline: "portalOrganizerTagline",
    access: { heading: "portalOrganizerAccess", ordered: false, items: ["portalOrganizerAccess1", "portalOrganizerAccess2"] },
    abilities: ["portalOrganizerAbility1", "portalOrganizerAbility2", "portalOrganizerAbility3", "portalOrganizerAbility4", "portalOrganizerAbility5", "portalOrganizerAbility6"],
    notes: ["portalOrganizerNote"],
    demos: [
      { file: "organizer-import", alt: "portalOrganizerDemo1Alt", caption: "portalOrganizerDemo1" },
      { file: "organizer-map", alt: "portalOrganizerDemo2Alt", caption: "portalOrganizerDemo2" },
    ],
    action: { href: "/organizer", label: "portalOrganizerAction" },
  },
];

/** Every demo file the page references, for the build to check and measure. */
export const PORTAL_DEMO_FILES = PORTAL_SECTIONS.flatMap((section) => section.demos.flatMap(({ file }) => [`${file}.webp`, `${file}-still.webp`]));

/** A looping demo, with its still frame for readers who asked for less motion. */
function portalDemoHtml({ file, alt, caption }: PortalDemo, size: { width: number; height: number }) {
  const media = `/portal/media/${file}`;
  return `<figure><picture><source media="(prefers-reduced-motion: reduce)" srcset="${media}-still.webp"><img src="${media}.webp" alt="${escapeHtml(say(alt))}" data-i18n-attr="alt:${alt}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async"></picture>${text("figcaption", caption)}</figure>`;
}

/**
 * `/portal/`: what circles and organizers get after signing in, and how.
 * `demoSize` is the pixel size every demo shares, read from the files at build.
 */
export function portalIntroPage(demoSize: { width: number; height: number }, { pageAssets = "" }: { pageAssets?: string } = {}) {
  const metadata = {
    title: say("portalTitle"),
    description: say("portalDescription"),
    canonical: PUBLIC_ORIGIN + PORTAL_INTRO_PATH,
    image: SHARE_IMAGE,
  };
  const list = (items: readonly PublicPageMessageKey[], ordered = false) => `<${ordered ? "ol" : "ul"}>${items.map((item) => text("li", item)).join("")}</${ordered ? "ol" : "ul"}>`;
  const sections = PORTAL_SECTIONS.map((section) => `<section id="${section.id}" class="portal-section" aria-labelledby="${section.id}-title">
${text("p", section.title, undefined, ' class="eyebrow"')}${text("h2", section.tagline, undefined, ` id="${section.id}-title"`)}
<div class="portal-demos">${section.demos.map((demo) => portalDemoHtml(demo, demoSize)).join("")}</div>
<div class="portal-columns"><div>${text("h3", section.access.heading)}${list(section.access.items, section.access.ordered)}</div>
<div>${text("h3", "portalYouCan")}${list(section.abilities)}</div></div>
${section.notes.map((note) => text("p", note, undefined, ' class="portal-note"')).join("")}
<p class="entries">${keyedLink(section.action.href, section.action.label, "primary")}</p></section>`).join("");
  const titles: PageTitles = Object.fromEntries((["en", "ja"] as const).map((locale) => [locale, {
    title: translate(PUBLIC_PAGE_MESSAGES, locale, "portalTitle"), description: translate(PUBLIC_PAGE_MESSAGES, locale, "portalDescription"),
  }]));
  return documentHtml(metadata, `${text("h1", "portalHeading")}
<nav class="portal-jump" aria-label="${escapeHtml(say("portalJump"))}" data-i18n-attr="aria-label:portalJump">${keyedLink("#circle", "portalCircleTitle")}${keyedLink("#organizer", "portalOrganizerTitle")}</nav>${sections}`, { loginHref: publicLoginHref(), assets: pageAssets, titles });
}

export function sitemapHtml(paths: readonly string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map((path) => `<url><loc>${escapeHtml(PUBLIC_ORIGIN + path)}</loc></url>`).join("")}</urlset>`;
}
