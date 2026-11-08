import type { EventDefinition } from "../event-catalog";
import type { CircleViewRecord } from "../circle-records";

/** The portal supplies only this circle's placements; retired booths are not destinations. */
export function guidePlacements(event: EventDefinition, circleId: string, records: CircleViewRecord[]) {
  return event.days.flatMap(day => records.filter(record =>
    record.placement.eventId === event.id && record.placement.circleId === circleId &&
    record.placement.day === day.id && record.placement.status === "active"
  ).flatMap(record => event.venueAssignments.filter(venue => venue.areaIds.includes(record.placement.area))
    .map(venue => ({ placement: record.placement, venue }))));
}
