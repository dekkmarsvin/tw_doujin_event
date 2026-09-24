import type { EventDefinition } from "./event-catalog";
import { placementStatusLabel } from "./circle-records";
import { eventCalendar, eventDayCalendarDate, fullDateRange, shortDate } from "./event-calendar";

export const PUBLIC_ORIGIN = "https://map.kotoban.top";
export const SITE_TITLE = "場刊 Map｜同人展逛攤地圖";
export const SITE_DESCRIPTION = "搜尋同人展攤位、收藏社團並規劃你的逛攤路線。";
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
export function circleBooths(event: EventDefinition, placements: readonly MetadataPlacement[]) {
  const order = (day: string | number) => event.days.findIndex((candidate) => String(candidate.id) === String(day));
  // Earliest by calendar date: a corrected date can leave day 1 after day 2
  // (ADR-0068). Declaration order only decides between days with no date.
  const rows = placements.map((placement) => ({ ...placement, date: eventDayCalendarDate(event, placement.day) }))
    .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || order(a.day) - order(b.day)
      || a.boothCode.localeCompare(b.boothCode, "en", { numeric: true }));
  if (!rows.length) return null;
  const when = (row: (typeof rows)[number], format: (iso: string) => string) => row.date ? format(row.date)
    : event.days[order(row.day)]?.dateLabel ?? String(row.day);
  const active = rows.filter((row) => row.status === "active");
  const first = active[0] ?? rows[0];
  const headline = active.length
    ? `${when(first, shortDate)} ${active.filter((row) => String(row.day) === String(first.day)).map((row) => row.boothCode).join("、")}`
    : `${when(first, shortDate)} ${first.boothCode} ${placementStatusLabel(first.status)}`;
  const summary = [...new Set(rows.map((row) => String(row.day)))].map((day) => {
    const onDay = rows.filter((row) => String(row.day) === day);
    const codes = onDay.map((row) => row.status === "active" ? row.boothCode : `${row.boothCode}（${placementStatusLabel(row.status)}）`);
    return `${when(onDay[0], (iso) => fullDateRange(iso))} ${codes.join("、")}`;
  }).join("；");
  return { headline, summary };
}

export function pageMetadata(event?: EventDefinition, circle?: { id: string; name: string }, placements: readonly MetadataPlacement[] = []) {
  if (!event) return { title: SITE_TITLE, description: SITE_DESCRIPTION, canonical: `${PUBLIC_ORIGIN}/`, image: SHARE_IMAGE };
  const calendar = eventCalendar(event);
  const dates = calendar.start ? fullDateRange(calendar.start, calendar.end) : calendar.label;
  const venues = [...new Set(event.venueAssignments.map((venue) => venue.venueName))].join("、");
  const closing = "查看攤位位置、收藏社團並規劃逛攤路線。";
  // Aliases are what organizers and readers actually call the event (ADR-0068).
  // The event page gives both names; a circle page uses the first alias, the
  // event's short name. An event without aliases reads as it always did.
  const aliases = event.aliases ?? [];
  if (!circle) return {
    title: `${aliases.length ? `${event.name}（${aliases[0]}）` : `${event.name} `}攤位地圖與社團查詢｜場刊 Map`,
    description: `${aliases.length ? `${event.name}（${aliases.join("、")}）` : event.name}的社團與攤位地圖。${dates}，${venues}。${closing}`,
    canonical: PUBLIC_ORIGIN + eventPath(event.id),
    // An event page shares its own picture when it has one (#396); circle
    // pages and the homepage keep the brand card.
    image: event.image ?? SHARE_IMAGE,
  };
  const booths = circleBooths(event, placements);
  return {
    title: `${circle.name}｜${aliases[0] ?? event.name}${booths ? ` ${booths.headline}` : ""}｜場刊 Map`,
    description: `${circle.name}在${event.name}的${booths ? `攤位：${booths.summary}。${venues}` : `參展日期與攤位。${dates}，${venues}`}。${closing}`,
    canonical: PUBLIC_ORIGIN + circlePath(event.id, circle.id),
    image: SHARE_IMAGE,
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
