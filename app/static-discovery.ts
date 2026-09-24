import type { EventDefinition } from "./event-catalog";
import type { CircleCatalogPayload } from "./circle-records";
import { placementStatusLabel } from "./circle-records";
import { eventCalendar, eventDayDate, taipeiDate } from "./event-calendar";
import { circlePath, eventPath, pageMetadata, PUBLIC_ORIGIN, readerLink, SITE_TITLE } from "./seo";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const link = (href: string, text: string, className = "") => `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function metadataHtml(metadata: ReturnType<typeof pageMetadata>, canonical = true) {
  return `<title>${escapeHtml(metadata.title)}</title>
<meta name="description" content="${escapeHtml(metadata.description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(metadata.canonical)}"><meta property="og:url" content="${escapeHtml(metadata.canonical)}">` : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="場刊 Map"><meta property="og:locale" content="zh_TW">
<meta property="og:title" content="${escapeHtml(metadata.title)}"><meta property="og:description" content="${escapeHtml(metadata.description)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(metadata.title)}"><meta name="twitter:description" content="${escapeHtml(metadata.description)}">`;
}

function documentHtml(metadata: ReturnType<typeof pageMetadata>, content: string, schema?: unknown) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${metadataHtml(metadata)}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts/geist.css"><link rel="stylesheet" href="/discovery.css">
${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ""}</head><body class="discovery"><header>${link("/", "場刊 Map")}</header><main>${content}</main><footer>${link("/privacy", "隱私權與資料使用")}</footer></body></html>`;
}

function eventFacts(event: EventDefinition) {
  const calendar = eventCalendar(event);
  const venues = [...new Set(event.venueAssignments.map((venue) => venue.venueName))];
  return `<p class="eyebrow">${escapeHtml(calendar.label)}</p><p>${escapeHtml(venues.join("、"))}</p>
<p>主辦單位：${event.organizerAssignments.map((organizer) => link(organizer.officialUrl, organizer.name)).join("、")}</p>
<p>${link(event.officialData.eventUrl, "活動網站")}</p>`;
}

export function homepageSummary(events: readonly EventDefinition[]) {
  return `<main class="discovery-summary"><h1>${escapeHtml(SITE_TITLE)}</h1><p>選擇活動，查看日期、場館、社團與攤位。</p><ul>${events.map((event) => `<li>${link(eventPath(event.id), event.name)} · ${escapeHtml(eventCalendar(event).label)} · ${escapeHtml(event.venue)}</li>`).join("")}</ul></main>`;
}

/** Only the reviewed base is accepted; no overlay fields are projected into HTML. */
export function discoveryPages(event: EventDefinition, catalog: CircleCatalogPayload) {
  if (catalog.eventId !== event.id) throw new Error("Discovery catalog must belong to its event.");
  const pages = new Map<string, string>();
  const circles = catalog.circles.filter((circle) => catalog.placements.some((placement) => placement.circleId === circle.id));
  const dateEnd = taipeiDate(Date.parse(event.eventEndsAt));
  const dates = event.days.map((day) => eventDayDate(day.dateLabel, dateEnd));
  const calendar = eventCalendar(event);
  const schema = dates.every(Boolean) ? {
    "@context": "https://schema.org", "@type": "Event", name: event.name,
    ...(event.aliases?.length ? { alternateName: [...event.aliases] } : {}),
    url: PUBLIC_ORIGIN + eventPath(event.id), description: pageMetadata(event).description,
    startDate: [...dates].sort()[0], endDate: [...dates].sort().at(-1),
    location: [...new Map(event.venueAssignments.map((venue) => [venue.venueId, { "@type": "Place", name: venue.venueName, url: venue.venueOfficialUrl }])).values()],
    organizer: event.organizerAssignments.map((organizer) => ({ "@type": "Organization", name: organizer.name, url: organizer.officialUrl })),
  } : undefined;
  const aliases = event.aliases?.length ? `<p>別稱：${escapeHtml(event.aliases.join("、"))}</p>` : "";
  pages.set(eventPath(event.id), documentHtml(pageMetadata(event), `<h1>${escapeHtml(event.name)}</h1>${aliases}${eventFacts(event)}
<p>${link(readerLink(event), "開啟攤位地圖", "primary")}</p>
<section><h2>參展社團</h2><p>${circles.length} 個社團</p><ul class="circle-directory">${circles.map((circle) => `<li>${link(circlePath(event.id, circle.id), circle.name)}</li>`).join("")}</ul></section>`, schema));
  for (const circle of circles) {
    const placements = catalog.placements.filter((placement) => placement.circleId === circle.id);
    const rows = placements.map((placement) => {
      const day = event.days.find((candidate) => String(candidate.id) === String(placement.day));
      const venue = event.venueAssignments.find((assignment) => assignment.areaIds.includes(placement.area));
      const area = event.areas.find((candidate) => candidate.id === placement.area);
      const status = placementStatusLabel(placement.status);
      return `<li><div><strong>${escapeHtml(placement.boothCode)}</strong>${status ? ` <span class="status">${escapeHtml(status)}</span>` : ""}
<p>${escapeHtml([day?.dateLabel, venue?.venueName, venue?.venueSpaceName, area?.label].filter(Boolean).join(" · "))}</p></div>${link(readerLink(event, placement), "在地圖查看")}</li>`;
    }).join("");
    pages.set(circlePath(event.id, circle.id), documentHtml(pageMetadata(event, circle), `<nav aria-label="活動">${link(eventPath(event.id), event.name)}</nav>
<h1>${escapeHtml(circle.name)}</h1><p>${escapeHtml(event.name)} · ${escapeHtml(calendar.label)}</p><h2>參展攤位</h2><ul class="placements">${rows}</ul>
<p>${link(eventPath(event.id), "全部參展社團")}</p><p>${link(event.officialData.eventUrl, "活動網站")}</p>`));
  }
  return pages;
}

export function sitemapHtml(paths: readonly string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map((path) => `<url><loc>${escapeHtml(PUBLIC_ORIGIN + path)}</loc></url>`).join("")}</urlset>`;
}
