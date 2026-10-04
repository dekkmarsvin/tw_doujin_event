import type { EventDefinition } from "./event-catalog";
import type { CircleCatalogPayload } from "./circle-records";
import { placementStatusLabel } from "./circle-records";
import { dayDateLabel, eventCalendar, eventDayCalendarDate, eventDayDate, taipeiDate } from "./event-calendar";
import { circleBooths, circlePath, eventPath, pageMetadata, PUBLIC_ORIGIN, readerLink, SHARE_IMAGE, SITE_TITLE } from "./seo";
import { CIRCLE_PAGE_ACTIONS_ID, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE, CIRCLE_PAGE_ROOT_ID, circlePageData, circlePageDataHtml } from "./circle-page-data";
import { PUBLIC_HEADER, publicHeaderHtml, publicLoginHref } from "./public-header";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const link = (href: string, text: string, className = "") => `<a${className ? ` class="${className}"` : ""} href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function metadataHtml(metadata: ReturnType<typeof pageMetadata>, canonical = true) {
  return `<title>${escapeHtml(metadata.title)}</title>
<meta name="description" content="${escapeHtml(metadata.description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(metadata.canonical)}"><meta property="og:url" content="${escapeHtml(metadata.canonical)}">` : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="場刊 Map"><meta property="og:locale" content="zh_TW">
<meta property="og:title" content="${escapeHtml(metadata.title)}"><meta property="og:description" content="${escapeHtml(metadata.description)}">
<meta property="og:image" content="${escapeHtml(metadata.image.url)}"><meta property="og:image:width" content="${metadata.image.width}"><meta property="og:image:height" content="${metadata.image.height}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(metadata.title)}"><meta name="twitter:description" content="${escapeHtml(metadata.description)}">`;
}

/** `loginHref` is where the header's "登入" leads from this page (#439). */
function documentHtml(metadata: ReturnType<typeof pageMetadata>, content: string, { loginHref, schema, assets = "" }: { loginHref: string; schema?: unknown; assets?: string }) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${metadataHtml(metadata)}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts/geist.css"><link rel="stylesheet" href="/discovery.css"><link rel="stylesheet" href="${PUBLIC_HEADER.stylesheet}">
${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ""}${assets}</head><body class="discovery">${publicHeaderHtml(loginHref)}<main>${content}</main><footer>${link(PORTAL_INTRO_PATH, "社團與主辦")}${link("/privacy/", "隱私權與資料使用")}</footer></body></html>`;
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

function eventFacts(event: EventDefinition) {
  const calendar = eventCalendar(event);
  const venues = [...new Set(event.venueAssignments.map((venue) => venue.venueName))];
  return `<p class="eyebrow">${escapeHtml(calendar.label)}</p><p>${escapeHtml(venues.join("、"))}</p>
<p>主辦單位：${event.organizerAssignments.map((organizer) => link(organizer.officialUrl, organizer.name)).join("、")}</p>
<p>${link(event.officialData.eventUrl, "活動網站")}</p>`;
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
export function discoveryPages(event: EventDefinition, catalog: CircleCatalogPayload, { circlePageAssets = "" }: { circlePageAssets?: string } = {}) {
  if (catalog.eventId !== event.id) throw new Error("Discovery catalog must belong to its event.");
  const pages = new Map<string, string>();
  const circles = catalog.circles.filter((circle) => catalog.placements.some((placement) => placement.circleId === circle.id));
  const placementsOf = (circleId: string) => catalog.placements.filter((placement) => placement.circleId === circleId);
  // Same-named circles are separate circles (their days are separate evidence);
  // the directory tells them apart by where each one is, as their titles do.
  const named = new Map<string, number>();
  for (const circle of circles) named.set(circle.name, (named.get(circle.name) ?? 0) + 1);
  const listed = (circle: (typeof circles)[number]) => (named.get(circle.name) ?? 0) > 1
    ? `${circle.name}（${circleBooths(event, placementsOf(circle.id))?.headline}）` : circle.name;
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
  const aliases = event.aliases?.length ? `<p>別稱：${escapeHtml(event.aliases.join("、"))}</p>` : "";
  const directory = (entries: readonly string[]) => `<ul class="circle-directory">${entries.map((entry) => `<li>${entry}</li>`).join("")}</ul>`;
  const entry = (circle: (typeof circles)[number], status = "") => link(circlePath(event.id, circle.id), `${listed(circle)}${status ? `（${status}）` : ""}`);
  pages.set(eventPath(event.id), documentHtml(pageMetadata(event), `<h1>${escapeHtml(event.name)}</h1>${aliases}${eventFacts(event)}
<p class="entries">${link(readerLink(event), "開啟攤位地圖", "primary")}${link(readerLink(event) + "&view=browse", "逛品書", "secondary")}</p>
<section><h2>參展社團</h2><p>${circles.length} 個社團</p>${event.days.length > 1 ? dayDirectory() : directory(circles.map((circle) => entry(circle)))}</section>`, { loginHref: publicLoginHref({ eventId: event.id }), schema }));
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
        return [entry(circle, placementStatusLabel(status))];
      });
      return `<h3>${escapeHtml(date ? dayDateLabel(date) : day.dateLabel)}</h3><p>${onDay.length} 個社團</p>${directory(onDay)}`;
    }).join("");
  }
  for (const circle of circles) {
    const placements = placementsOf(circle.id);
    const cards = boothCards(event, placements);
    const venues = [...new Set(cards.filter((card) => card.status === "active").map((card) => card.venueName).filter(Boolean))];
    const claim = publicLoginHref({ eventId: event.id, circleId: circle.id });
    pages.set(circlePath(event.id, circle.id), documentHtml(pageMetadata(event, circle, placements), `<nav aria-label="活動">${link(eventPath(event.id), event.name)}</nav>
<h1>${escapeHtml(circle.name)}</h1><p class="eyebrow">${escapeHtml([calendar.label, ...venues].join(" · "))}</p>
<div id="${CIRCLE_PAGE_ACTIONS_ID}"></div>
<h2>參展攤位</h2><ol class="booth-cards">${cards.map((card) => boothCardHtml(event, card)).join("")}</ol>
<div id="${CIRCLE_PAGE_ROOT_ID}"></div>${circlePageDataHtml(circlePageData(catalog, circle.id))}
<p class="claim">這是你的社團嗎？${link(claim, "認領／管理資料")}</p>`, { loginHref: claim, assets: circlePageAssets }));
  }
  return pages;
}

type CardPlacement = CircleCatalogPayload["placements"][number];
type BoothCard = { day: CardPlacement["day"]; when: string; where: string; venueName: string; status: CardPlacement["status"]; placements: CardPlacement[]; planSlot: boolean };

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
  const cards = new Map<string, BoothCard & { date: string | null; order: number }>();
  for (const placement of placements) {
    const order = event.days.findIndex((candidate) => String(candidate.id) === String(placement.day));
    const date = eventDayCalendarDate(event, placement.day);
    const venue = event.venueAssignments.find((assignment) => assignment.areaIds.includes(placement.area));
    const area = event.areas.find((candidate) => candidate.id === placement.area);
    const where = [venue?.venueName, venue?.venueSpaceName, area?.label].filter(Boolean).join(" · ");
    const key = `${String(placement.day)}\u0000${where}\u0000${placement.status}`;
    const card = cards.get(key) ?? {
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
  const status = placementStatusLabel(card.status);
  const codes = card.placements.map((placement) => `<span class="booth-code tone-${escapeHtml(placement.tone)}">${escapeHtml(placement.boothCode)}</span>`).join("");
  return `<li class="booth-card${status ? " retired" : ""}"><p class="booth-when">${escapeHtml(card.when)}</p><p class="booth-codes">${codes}</p>
${card.where ? `<p class="booth-where">${escapeHtml(card.where)}</p>` : ""}${status ? `<p class="status">${escapeHtml(status)}</p>` : ""}
<div class="booth-actions">${link(readerLink(event, card.placements[0]), "在地圖查看", "booth-map")}${card.planSlot ? `<span class="booth-plan" ${CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE}="${escapeHtml(String(card.day))}"></span>` : ""}</div></li>`;
}

export const PORTAL_INTRO_PATH = "/portal/";

type PortalDemo = { file: string; alt: string; caption: string };
type PortalSection = {
  id: string; title: string; tagline: string;
  access: { heading: string; ordered: boolean; items: readonly string[] };
  abilities: readonly string[]; notes: readonly string[];
  demos: readonly PortalDemo[]; action: { href: string; label: string };
};

// What signing in opens, for circles and organizers who have not used the
// site yet. The sign-in pages link here instead of carrying it, so a returning
// user signs in in one short step. Every line must stay true to the circle and
// organizer contracts: an action only some roles have names the role.
const PORTAL_SECTIONS: readonly PortalSection[] = [
  {
    id: "circle", title: "參展社團", tagline: "讓讀者在地圖上就認識你",
    access: { heading: "怎麼開始", ordered: true, items: [
      "輸入 email，收信點連結登入",
      "找到你的社團，送出認領。用和場刊登錄的官網同網域的信箱登入，或在場刊登錄的官網、連結整合頁、pixivFANBOX 或 Fantia 頁面貼出驗證碼，可以當場通過；其他情況由人工確認。",
      "通過後就能開始編輯",
    ] },
    abilities: [
      "上傳品書，出現在「逛品書」",
      "補上販售資訊、筆名、連結、社團主題與作品標籤",
      "先預覽讀者會看到的樣子再儲存",
      "把這次的出展頁分享到你的社群",
    ],
    notes: ["攤位、日期和社團名稱以主辦公布的為準。每場活動要分別認領。"],
    demos: [
      { file: "circle-map-card", alt: "讀者在地圖上點選攤位，社團卡片顯示社團填寫的販售資訊與品書", caption: "讀者在地圖點你的攤位，看到的就是你填的內容" },
      { file: "circle-editor", alt: "社團編輯販售資訊，旁邊的預覽同步更新後儲存", caption: "邊填邊預覽，確認後再儲存" },
    ],
    action: { href: "/circle", label: "前往社團資料" },
  },
  {
    id: "organizer", title: "活動主辦", tagline: "不寫程式，也能把活動放上地圖",
    access: { heading: "怎麼取得權限", ordered: false, items: [
      "收到邀請信：用信裡的連結登入，就會加入那場活動",
      "開放申請時：登入後送出活動申請，網站管理者核准後，你就是這場活動的負責人",
    ] },
    abilities: [
      "設定活動日期、場館與場地，下一場活動可以沿用",
      "匯入攤位名單，先預覽再儲存",
      "上傳配置圖，在上面畫出攤位地圖",
      "檢查並預覽讀者會看到的頁面，由負責人送審，網站管理者核准後發布",
      "負責人可以邀請協作者一起建置",
      "活動公開後，審核這場活動的社團認領",
    ],
    notes: ["活動資料和地圖要用桌機編輯，申請和審核進度用手機也能看。"],
    demos: [
      { file: "organizer-import", alt: "主辦選擇攤位名單檔案，預覽匯入結果後確認儲存", caption: "匯入攤位名單，預覽沒問題再儲存" },
      { file: "organizer-map", alt: "主辦上傳場地配置圖，在圖上畫出攤位", caption: "在配置圖上畫出攤位地圖" },
    ],
    action: { href: "/organizer", label: "前往主辦工作區" },
  },
];

/** Every demo file the page references, for the build to check and measure. */
export const PORTAL_DEMO_FILES = PORTAL_SECTIONS.flatMap((section) => section.demos.flatMap(({ file }) => [`${file}.webp`, `${file}-still.webp`]));

/** A looping demo, with its still frame for readers who asked for less motion. */
function portalDemoHtml({ file, alt, caption }: PortalDemo, size: { width: number; height: number }) {
  const media = `/portal/media/${file}`;
  return `<figure><picture><source media="(prefers-reduced-motion: reduce)" srcset="${media}-still.webp"><img src="${media}.webp" alt="${escapeHtml(alt)}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async"></picture><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

/**
 * `/portal/`: what circles and organizers get after signing in, and how.
 * `demoSize` is the pixel size every demo shares, read from the files at build.
 */
export function portalIntroPage(demoSize: { width: number; height: number }) {
  const metadata = {
    title: "社團與主辦｜場刊 Map",
    description: "參展社團認領後可以補上品書與販售資訊，活動主辦不寫程式也能匯入攤位名單、畫出攤位地圖。用 email 登入，不用設定密碼。",
    canonical: PUBLIC_ORIGIN + PORTAL_INTRO_PATH,
    image: SHARE_IMAGE,
  };
  const list = (items: readonly string[], ordered = false) => `<${ordered ? "ol" : "ul"}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
  const sections = PORTAL_SECTIONS.map((section) => `<section id="${section.id}" class="portal-section" aria-labelledby="${section.id}-title">
<p class="eyebrow">${escapeHtml(section.title)}</p><h2 id="${section.id}-title">${escapeHtml(section.tagline)}</h2>
<div class="portal-demos">${section.demos.map((demo) => portalDemoHtml(demo, demoSize)).join("")}</div>
<div class="portal-columns"><div><h3>${escapeHtml(section.access.heading)}</h3>${list(section.access.items, section.access.ordered)}</div>
<div><h3>你可以</h3>${list(section.abilities)}</div></div>
${section.notes.map((note) => `<p class="portal-note">${escapeHtml(note)}</p>`).join("")}
<p class="entries">${link(section.action.href, section.action.label, "primary")}</p></section>`).join("");
  return documentHtml(metadata, `<h1>社團與主辦</h1>
<p class="portal-lead">用 email 登入，不用設定密碼，登入後 7 天內不用再登入。逛活動、收藏和排行程都不用登入。</p>
<nav class="portal-jump" aria-label="本頁內容">${link("#circle", "參展社團")}${link("#organizer", "活動主辦")}</nav>${sections}`, { loginHref: publicLoginHref() });
}

export function sitemapHtml(paths: readonly string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map((path) => `<url><loc>${escapeHtml(PUBLIC_ORIGIN + path)}</loc></url>`).join("")}</urlset>`;
}
