import type { EventDefinition } from "./event-catalog";
import { eventDayCalendarDate } from "./event-calendar";
import type { CircleViewRecord } from "./circle-records";
import { buildWorkTopicSuggestions } from "./circle-search";
import { describePublicSearchFilters, matchesPublicScope, matchesPublicSearch } from "./public-circle-search";
import type { CatalogBrowseState } from "./catalog-browse-url";

export function projectCatalogBrowse(event: EventDefinition, records: CircleViewRecord[], state: CatalogBrowseState) {
  const scoped = records.filter((record) => matchesPublicScope(record, event, state));
  const matching = scoped.filter((record) => matchesPublicSearch(record, event, state));
  const dayOrder = (record: CircleViewRecord) => event.days.findIndex((day) => String(day.id) === String(record.day));
  const venueOrder = (record: CircleViewRecord) => event.venueAssignments.findIndex((space) => space.areaIds.includes(record.hall));
  const compare = (a: CircleViewRecord, b: CircleViewRecord) => {
    const ad = eventDayCalendarDate(event, a.day), bd = eventDayCalendarDate(event, b.day);
    return (ad && bd ? ad.localeCompare(bd) : 0) || dayOrder(a) - dayOrder(b)
      || venueOrder(a) - venueOrder(b) || a.code.localeCompare(b.code, "en", { numeric: true });
  };
  const groups = new Map<string, CircleViewRecord[]>();
  for (const record of matching) groups.set(record.circle.id, [...(groups.get(record.circle.id) ?? []), record]);
  const cards = [...groups.values()].map((items) => {
    const placements = [...items].sort(compare);
    const destinations = placements.filter((record) => record.placement.status === "active");
    const circle = placements[0].circle;
    return { circle, placements, destinations, catalog: circle.media.filter((media) => media.kind === "catalog") };
  }).sort((a, b) => Number(!a.destinations.length) - Number(!b.destinations.length)
    || compare(a.destinations[0] ?? a.placements[0], b.destinations[0] ?? b.placements[0])
    || a.circle.id.localeCompare(b.circle.id));
  return {
    withCatalog: cards.filter((card) => card.catalog.length > 0),
    withoutCatalog: cards.filter((card) => card.catalog.length === 0),
    circleCount: cards.length, placementCount: matching.length,
    topics: buildWorkTopicSuggestions(scoped),
    filters: describePublicSearchFilters(event, state),
  };
}
export type CatalogBrowseCard = ReturnType<typeof projectCatalogBrowse>["withCatalog"][number];
