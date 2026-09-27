import type { EventDefinition } from "./event-catalog";
import { dayDateLabel, eventDayCalendarDate } from "./event-calendar";
import { circlePath } from "./seo";

type SharedPlacement = { day: string | number; area: string; boothCode: string; status: "active" | "cancelled" | "moved" };

/**
 * The days a circle can actually be visited, earliest first, each with the
 * placement key a plan entry uses. A day the circle only moved away from or
 * cancelled is not one: planning it would send a reader to a booth that is
 * not the destination.
 *
 * Ordered by calendar date, then by declaration, for the same reason as
 * `circleBooths`: a corrected date can put day 2 before day 1 (ADR-0068).
 */
export function visitableDays<T extends SharedPlacement>(event: EventDefinition, placements: readonly T[]) {
  const days = new Map<string, { day: T["day"]; label: string; date: string | null; order: number; placements: T[] }>();
  for (const placement of placements) {
    if (placement.status !== "active") continue;
    const key = String(placement.day);
    const existing = days.get(key);
    if (existing) {
      existing.placements.push(placement);
      continue;
    }
    const order = event.days.findIndex((candidate) => String(candidate.id) === key);
    const date = eventDayCalendarDate(event, placement.day);
    days.set(key, {
      day: placement.day,
      label: date ? dayDateLabel(date) : event.days[order]?.dateLabel ?? key,
      date,
      order,
      placements: [placement],
    });
  }
  return [...days.values()].sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || a.order - b.order);
}

/**
 * The words a circle pastes into its own post. Only the official facts and the
 * page's stable address go in — the account, the claim and any unsaved draft
 * are not inputs, so none of them can reach it. `circle.name` is the official
 * record's current name, not the one captured when the claim was made.
 *
 * One venue is named once, after every date. Across several venues each date
 * names its own, grouping that day's booths under it: a list of venues after a
 * list of dates would not say which venue a reader goes to on which day.
 */
export function circlePromotion(event: EventDefinition, circle: { id: string; name: string }, placements: readonly SharedPlacement[], origin: string) {
  const url = `${origin}${circlePath(event.id, circle.id)}`;
  const days = visitableDays(event, placements);
  const venueOf = (placement: SharedPlacement) => event.venueAssignments.find((venue) => venue.areaIds.includes(placement.area))?.venueName ?? "";
  const codes = (onVenue: readonly SharedPlacement[]) => onVenue.map((placement) => placement.boothCode).join("、");
  const venues = [...new Set(days.flatMap(({ placements: onDay }) => onDay.map(venueOf)))];
  const booths = venues.length > 1
    ? days.map(({ label, placements: onDay }) => `${label} ${[...new Set(onDay.map(venueOf))]
      .map((venue) => `${venue ? `${venue} ` : ""}${codes(onDay.filter((placement) => venueOf(placement) === venue))}`).join("；")}`).join("／")
    : `${days.map(({ label, placements: onDay }) => `${label} ${codes(onDay)}`).join("／")}${venues[0] ? `｜${venues[0]}` : ""}`;
  const alias = event.aliases?.[0];
  const text = [
    `${circle.name}｜${event.name}${alias && alias !== event.name ? `（${alias}）` : ""}`,
    days.length > 0 && booths,
  ].filter(Boolean).join("\n");
  return { text, url, full: `${text}\n${url}` };
}
