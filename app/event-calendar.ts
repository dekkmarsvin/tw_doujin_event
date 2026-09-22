import type { EventDefinition } from "./event-catalog";

const taipeiCalendar = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
export const taipeiDate = (now: number) => taipeiCalendar.format(now);

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

/** Publication emits ISO days; older reviewed events use month/day labels.
 * The end date supplies their year, including dates before a New Year wrap. */
export function eventDayDate(label: string, end: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const legacy = /^(\d{1,2})月(\d{1,2})日(?:[・（(].*)?$/.exec(label);
  if (!legacy) return null;
  const [, month, day] = legacy.map(Number);
  const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const year = Number(end.slice(0, 4)) - (monthDay > end.slice(5) ? 1 : 0);
  return calendarDate(year, month, day);
}

export function eventCalendar(event: EventDefinition) {
  const end = taipeiDate(Date.parse(event.eventEndsAt));
  const days = event.days.map((day) => eventDayDate(day.dateLabel, end));
  if (!days.length || days.some((day) => !day || day > end)) return { start: null, end, label: event.dateRangeLabel };
  const start = (days as string[]).sort()[0];
  const full = (date: string) => date.slice(2).replaceAll("-", ".");
  const tail = start.slice(0, 7) === end.slice(0, 7) ? end.slice(8)
    : start.slice(0, 4) === end.slice(0, 4) ? end.slice(5).replace("-", ".") : full(end);
  return { start, end, label: start === end ? full(start) : `${full(start)}-${tail}` };
}

export const EVENT_GROUPS = [
  { id: "upcoming", label: "即將到來" },
  { id: "ongoing", label: "舉辦中" },
  { id: "past", label: "過往活動" },
  { id: "undated", label: "日期待確認" },
] as const;

export function groupCalendarEvents(events: readonly EventDefinition[], today: string) {
  const entries = events.map((event) => {
    const calendar = eventCalendar(event);
    const group = today > calendar.end ? "past" : !calendar.start ? "undated" : today < calendar.start ? "upcoming" : "ongoing";
    return { event, ...calendar, group };
  }).sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.event.id.localeCompare(b.event.id));
  return EVENT_GROUPS.map((group) => ({ ...group, entries: entries.filter((entry) => entry.group === group.id) })).filter((group) => group.entries.length > 0);
}
