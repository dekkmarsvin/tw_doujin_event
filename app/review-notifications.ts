import { formatTaipeiTime, renderLetter } from "./mail-letter";

export type NotificationCadence = "five_minutes" | "hourly" | "daily";
export type NotificationPreferences = { enabled: boolean; cadence: NotificationCadence; version: number };
export type ReviewKind = "application" | "organizer" | "claim" | "map";

export function isNotificationCadence(value: unknown): value is NotificationCadence {
  return value === "five_minutes" || value === "hourly" || value === "daily";
}

/** Strictly next slot. Taipei 09:00 is UTC 01:00 (no daylight saving). */
export function nextNotificationSlot(cadence: NotificationCadence, now: number) {
  const interval = cadence === "daily" ? 86_400_000 : cadence === "hourly" ? 3_600_000 : 300_000;
  const offset = cadence === "daily" ? 3_600_000 : 0;
  return (Math.floor((now - offset) / interval) + 1) * interval + offset;
}

export function notificationRetryDelay(attempt: number) {
  return Math.min(60_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 9), 6 * 3_600_000);
}

/**
 * One row per kind and event. A single row gets the button; several rows each
 * link to where they are reviewed, since they go to different entries.
 */
export function reviewDigest(origin: string, groups: Array<{ kind: ReviewKind; event_id: string | null; total: number }>, now?: number) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Invalid notification origin.");
  }
  const labels = { application: "活動申請", organizer: "活動內容送審", claim: "社團認領", map: "地圖貢獻" };
  const rows = groups.map(group => {
    const url = new URL(group.kind === "application" || group.kind === "organizer" ? "/organizer" : "/admin", base);
    if (url.pathname === "/admin" && group.event_id) url.searchParams.set("event", group.event_id);
    if (group.kind === "map") url.hash = "map-review";
    if (group.kind === "claim") url.hash = "admin";
    return { label: `${labels[group.kind]}${group.event_id ? `（${group.event_id}）` : ""}`, value: `${group.total} 筆`, href: url.href };
  });
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const single = rows.length === 1;
  return renderLetter({
    kind: "general",
    subject: `場刊 Map：${total} 筆新增待審項目`,
    preheader: rows.map(row => `${row.label} ${row.value}`).join(" · "),
    category: "待審通知",
    ...(now === undefined ? {} : { stamp: formatTaipeiTime(now) }),
    title: `${total} 筆新增待審項目`,
    paragraphs: [],
    facts: rows.map(row => single ? { label: row.label, value: row.value } : row),
    ...(single ? { action: { label: "前往審核", href: rows[0].href } } : {}),
    footerLink: { label: "通知設定", href: new URL("/admin#review-notifications", base).href },
    origin: base.origin,
  });
}
