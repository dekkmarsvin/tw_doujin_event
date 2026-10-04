import type { EventDefinition } from "../event-catalog";
import { eventCalendar, fullDateRange } from "../event-calendar";
import type { OrganizerEventSummary } from "../organizer-client";
import { groupOrganizerEvents } from "../organizer-event-groups";

export type AdminEventGroup = {
  id: string;
  eventId: string | null;
  name: string;
  published: EventDefinition | null;
  editions: OrganizerEventSummary[];
  calendar: { start: string | null; end: string | null; label: string };
};

export function candidateCalendar(candidate: OrganizerEventSummary) {
  return candidate.dateRange ? { ...candidate.dateRange, label: fullDateRange(candidate.dateRange.start, candidate.dateRange.end) }
    : { start: null, end: null, label: "日期未定" };
}

export function activityTime(calendar: { start: string | null; end: string | null }, today: string) {
  return calendar.end && today > calendar.end ? "已結束" : !calendar.start ? "日期未定" : today < calendar.start ? "尚未開始" : "進行中";
}

export function candidateHref(id: string, review = false) {
  return `/organizer?candidate=${encodeURIComponent(id)}${review ? "&section=review" : ""}`;
}

export type EditionStanding = "live" | "current" | "pending" | "failed" | "earlier";

/** An edition reaches published only after production is verified, so the newest
 * published edition of a public activity is the one being served. Without a public
 * page that edition stays visible but unconfirmed; older and abandoned ones fold away. */
export function editionStandings(group: AdminEventGroup) {
  const newest = group.editions.find(item => item.status === "published");
  return new Map<string, EditionStanding>(group.editions.map(item => [item.id, item === newest ? group.published ? "live" : "current"
    : item.status === "published" || item.status === "abandoned" ? "earlier"
    : item.status === "failed" ? "failed" : "pending"]));
}

/** Published dates stay attached to the public edition while each workspace keeps its own dates. */
export function groupAdminEvents(candidates: readonly OrganizerEventSummary[], published: readonly EventDefinition[], today: string): AdminEventGroup[] {
  const groups = new Map<string, AdminEventGroup>();
  for (const event of published) groups.set(`event:${event.id}`, {
    id: `event:${event.id}`, eventId: event.id, name: event.name, published: event, editions: [], calendar: eventCalendar(event),
  });
  for (const group of groupOrganizerEvents(candidates)) {
    const existing = groups.get(group.id);
    if (existing) existing.editions = group.editions;
    else groups.set(group.id, { id: group.id, eventId: group.latest.eventId, name: group.name,
      published: null, editions: group.editions, calendar: candidateCalendar(group.latest) });
  }
  const rank = { "進行中": 0, "尚未開始": 1, "日期未定": 2, "已結束": 3 };
  return [...groups.values()].sort((a, b) => {
    const stateA = activityTime(a.calendar, today), stateB = activityTime(b.calendar, today);
    return rank[stateA] - rank[stateB] || (stateA === "已結束"
      ? (b.calendar.end ?? "").localeCompare(a.calendar.end ?? "")
      : (a.calendar.start ?? "").localeCompare(b.calendar.start ?? "")) || a.id.localeCompare(b.id);
  });
}
