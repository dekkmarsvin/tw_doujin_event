import type { EventDefinition } from "./event-catalog";
import { eventCalendar } from "./event-calendar";

export const PUBLIC_ORIGIN = "https://map.kotoban.top";
export const SITE_TITLE = "場刊 Map｜同人展逛攤地圖";
export const SITE_DESCRIPTION = "搜尋同人展攤位、收藏社團並規劃你的逛攤路線。";

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

export function pageMetadata(event?: EventDefinition, circle?: { id: string; name: string }) {
  const dates = event && eventCalendar(event).label;
  const venues = event && [...new Set(event.venueAssignments.map((venue) => venue.venueName))].join("、");
  // Aliases are what organizers and readers actually call the event (ADR-0068).
  // The event page gives both names; a circle page uses the first alias, the
  // event's short name. An event without aliases reads exactly as it did.
  const aliases = event?.aliases ?? [];
  const named = !event ? "" : circle ? `${aliases[0] ?? event.name} ` : aliases.length ? `${event.name}（${aliases[0]}）` : `${event.name} `;
  const described = event && !circle && aliases.length ? `${event.name}（${aliases.join("、")}）` : event?.name;
  return {
    title: event ? `${circle ? `${circle.name}｜` : ""}${named}攤位地圖與社團查詢｜場刊 Map` : SITE_TITLE,
    description: event ? `${circle ? `${circle.name}在` : ""}${described}的${circle ? "參展日期與攤位" : "社團與攤位地圖"}。${dates}，${venues}。查看攤位位置、收藏社團並規劃逛攤路線。` : SITE_DESCRIPTION,
    canonical: PUBLIC_ORIGIN + (event ? circle ? circlePath(event.id, circle.id) : eventPath(event.id) : "/"),
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
  meta("twitter:title", metadata.title);
  meta("twitter:description", metadata.description);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); }
  canonical.href = metadata.canonical;
  if (noindex) meta("robots", "noindex");
  else document.head.querySelector('meta[name="robots"]')?.remove();
}
