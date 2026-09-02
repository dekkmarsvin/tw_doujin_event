import sampleDefinition from "../fixtures/events/sample/event.json";
import sampleReferences from "../fixtures/events/sample/reference-records.json";
import sampleTwoDefinition from "../fixtures/events/sample-two/event.json";
import sampleTwoReferences from "../fixtures/events/sample-two/reference-records.json";
import { circleCategoryLabels, parseCircleCategoryCatalog, type CircleCategoryCatalog } from "./circle-categories";

declare const __PUBLISHED_EVENTS__: readonly { definition: unknown; references: unknown }[];

export const EVENT_DEFINITION_SCHEMA = "event-definition/3" as const;

export type EventDayDefinition<TDay extends string | number = string | number> = { id: TDay; label: string; dateLabel: string };
export type EventAreaDefinition<TArea extends string = string> = { id: TArea; label: string; shortLabel: string };
type OfficialDataDefinition = { adapter: string; eventUrl: string; boothListUrls: Readonly<Record<string, string>> };
export type OrganizerRole = "lead" | "co-organizer" | "partner";
type OrganizerAssignment = { organizerId: string; role: OrganizerRole; name: string; officialUrl: string };
type CategoryCatalogReference = { organizerId: string; id: string; revision: string };
type VenueAssignment<TArea extends string = string> = {
  venueId: string;
  venueName: string;
  venueOfficialUrl: string;
  venueSpaceId: string;
  venueSpaceName: string;
  areaIds: readonly TArea[];
};

export type EventDefinition<TDay extends string | number = string | number, TArea extends string = string> = {
  schema: typeof EVENT_DEFINITION_SCHEMA;
  id: string;
  name: string;
  /** Compatibility display label derived from the first pinned venue assignment. */
  venue: string;
  dateRangeLabel: string;
  dataUpdatedAt: string;
  dataLastUpdatedLabel: string;
  eventEndsAt: string;
  mapTemplate: string;
  areaMode: "single" | "switchable";
  days: readonly EventDayDefinition<TDay>[];
  areas: readonly EventAreaDefinition<TArea>[];
  organizerAssignments: readonly OrganizerAssignment[];
  categoryCatalog: CategoryCatalogReference;
  venueAssignments: readonly VenueAssignment<TArea>[];
  circleCategories: CircleCategoryCatalog;
  genres: readonly string[];
  officialData: OfficialDataDefinition;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}.`);
}

function https(value: unknown): value is string {
  if (!nonempty(value) || !value.startsWith("https://")) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isoInstant(value: unknown): value is string {
  if (!nonempty(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText = "0", offsetMinuteText = "0"] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText,
  ].map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59
    && !Number.isNaN(Date.parse(value));
}

function dataDateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

function referenceRecords(value: unknown) {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error("Event reference records are missing or invalid.");
  return value;
}

function findReference(
  records: Record<string, unknown>[],
  schema: string,
  id: string,
  matchesSelection: (record: Record<string, unknown>) => boolean = () => true,
) {
  const matches = records.filter((record) => record.schema === schema && record.id === id && matchesSelection(record));
  if (matches.length !== 1) throw new Error(`Event reference ${schema}:${id} must resolve exactly once.`);
  return matches[0];
}

/** Strict at the boundary: v2 and malformed v3 sources are rejected rather
 * than silently inheriting the new organizer or venue-space semantics. */
export function parseEventDefinition(value: unknown, references: unknown): EventDefinition {
  if (!isRecord(value) || value.schema !== EVENT_DEFINITION_SCHEMA) throw new Error("Unsupported event definition schema.");
  requireOnlyKeys(value, [
    "schema", "id", "name", "dateRangeLabel", "dataUpdatedAt", "eventEndsAt", "mapTemplate", "areaMode",
    "days", "areas", "organizerAssignments", "categoryCatalog", "venueAssignments", "officialData",
  ], "Event definition");
  for (const key of ["id", "name", "dateRangeLabel", "dataUpdatedAt", "eventEndsAt", "mapTemplate"] as const) {
    if (!nonempty(value[key])) throw new Error(`Event definition ${key} must be a non-empty string.`);
  }
  if (!isoInstant(value.dataUpdatedAt) || !isoInstant(value.eventEndsAt)) {
    throw new Error("Event definition timestamps must be valid ISO instants.");
  }
  if (value.areaMode !== "single" && value.areaMode !== "switchable") throw new Error("Event definition areaMode is invalid.");
  if (!Array.isArray(value.days) || value.days.length === 0 || !value.days.every((day) =>
    isRecord(day) && ((typeof day.id === "string" && nonempty(day.id)) || typeof day.id === "number")
      && nonempty(day.label) && nonempty(day.dateLabel))) {
    throw new Error("Event definition days are invalid.");
  }
  if (!Array.isArray(value.areas) || value.areas.length === 0 || !value.areas.every((area) =>
    isRecord(area) && nonempty(area.id) && nonempty(area.label) && nonempty(area.shortLabel))) {
    throw new Error("Event definition areas are invalid.");
  }
  value.days.forEach((day) => requireOnlyKeys(day, ["id", "label", "dateLabel"], "Event day"));
  value.areas.forEach((area) => requireOnlyKeys(area, ["id", "label", "shortLabel"], "Event area"));
  const days = value.days as EventDayDefinition[];
  const areas = value.areas as EventAreaDefinition[];
  const dayIds = new Set(days.map((day) => String(day.id)));
  if (dayIds.size !== days.length || new Set(areas.map((area) => area.id)).size !== areas.length) {
    throw new Error("Event definition day and area ids must be unique.");
  }

  if (!isRecord(value.officialData) || !nonempty(value.officialData.adapter) || !https(value.officialData.eventUrl)
    || !isRecord(value.officialData.boothListUrls) || !Object.values(value.officialData.boothListUrls).every(https)) {
    throw new Error("Event definition officialData is invalid.");
  }
  requireOnlyKeys(value.officialData, ["adapter", "eventUrl", "boothListUrls"], "Event officialData");
  const boothListDays = Object.keys(value.officialData.boothListUrls);
  if (boothListDays.length !== days.length || !boothListDays.every((day) => dayIds.has(day))) {
    throw new Error("Event definition day ids must cover official booth lists.");
  }

  const records = referenceRecords(references);
  if (!Array.isArray(value.organizerAssignments) || value.organizerAssignments.length === 0) {
    throw new Error("Event definition organizer assignments are invalid.");
  }
  const organizerAssignments = value.organizerAssignments.map((assignment, index) => {
    if (!isRecord(assignment) || !nonempty(assignment.organizerId)
      || !["lead", "co-organizer", "partner"].includes(String(assignment.role))) {
      throw new Error(`Event organizer assignment ${index} is invalid.`);
    }
    requireOnlyKeys(assignment, ["organizerId", "role"], `Event organizer assignment ${index}`);
    const organizer = findReference(records, "organizer/1", assignment.organizerId);
    if (!nonempty(organizer.name) || !https(organizer.officialUrl)) throw new Error(`Organizer ${assignment.organizerId} is invalid.`);
    return { organizerId: assignment.organizerId, role: assignment.role as OrganizerRole, name: organizer.name, officialUrl: organizer.officialUrl };
  });
  if (new Set(organizerAssignments.map(({ organizerId }) => organizerId)).size !== organizerAssignments.length
    || organizerAssignments.filter(({ role }) => role === "lead").length !== 1) {
    throw new Error("Event definition must assign unique organizers and exactly one lead.");
  }

  const categoryCatalog = value.categoryCatalog;
  if (!isRecord(categoryCatalog) || !nonempty(categoryCatalog.organizerId)
    || !nonempty(categoryCatalog.id) || !nonempty(categoryCatalog.revision)) {
    throw new Error("Event definition category catalog reference is invalid.");
  }
  requireOnlyKeys(categoryCatalog, ["organizerId", "id", "revision"], "Event category catalog reference");
  if (!organizerAssignments.some(({ organizerId }) => organizerId === categoryCatalog.organizerId)) {
    throw new Error("Event category catalog organizer is not assigned to the event.");
  }
  const categoryRecord = findReference(
    records,
    "category-catalog/1",
    categoryCatalog.id,
    (record) => record.organizerId === categoryCatalog.organizerId && record.revision === categoryCatalog.revision,
  );
  if (categoryRecord.organizerId !== categoryCatalog.organizerId || categoryRecord.revision !== categoryCatalog.revision
    || !Array.isArray(categoryRecord.sources) || categoryRecord.sources.length === 0
    || !categoryRecord.sources.every((source) => isRecord(source) && nonempty(source.id)
      && https(source.url) && nonempty(source.retrievedAt))) {
    throw new Error("Event category catalog reference does not match pinned data.");
  }
  const categoryOrganizer = organizerAssignments.find(({ organizerId }) => organizerId === categoryCatalog.organizerId)!;
  const circleCategories = parseCircleCategoryCatalog({
    schema: "circle-category-catalog/1",
    sources: categoryRecord.sources.map((source) => ({
      id: source.id,
      provider: categoryOrganizer.name,
      url: source.url,
      retrievedAt: source.retrievedAt,
    })),
    categories: categoryRecord.categories,
  });

  if (!Array.isArray(value.venueAssignments) || value.venueAssignments.length === 0) {
    throw new Error("Event definition venue assignments are invalid.");
  }
  const areaIds = new Set(areas.map(({ id }) => id));
  const assignedAreaIds: string[] = [];
  const venueAssignments = value.venueAssignments.map((assignment, index) => {
    if (!isRecord(assignment) || !nonempty(assignment.venueId) || !nonempty(assignment.venueSpaceId)
      || !Array.isArray(assignment.areaIds) || assignment.areaIds.length === 0 || !assignment.areaIds.every(nonempty)) {
      throw new Error(`Event venue assignment ${index} is invalid.`);
    }
    requireOnlyKeys(assignment, ["venueId", "venueSpaceId", "areaIds"], `Event venue assignment ${index}`);
    const venue = findReference(records, "venue/1", assignment.venueId);
    const venueSpace = findReference(records, "venue-space/1", assignment.venueSpaceId);
    if (venueSpace.venueId !== assignment.venueId || !nonempty(venue.name) || !https(venue.officialUrl) || !nonempty(venueSpace.name)) {
      throw new Error(`Event venue assignment ${index} does not match pinned data.`);
    }
    assignedAreaIds.push(...assignment.areaIds);
    return {
      venueId: assignment.venueId,
      venueName: venue.name,
      venueOfficialUrl: venue.officialUrl,
      venueSpaceId: assignment.venueSpaceId,
      venueSpaceName: venueSpace.name,
      areaIds: [...assignment.areaIds] as string[],
    };
  });
  if (new Set(venueAssignments.map(({ venueSpaceId }) => venueSpaceId)).size !== venueAssignments.length
    || assignedAreaIds.length !== areaIds.size || new Set(assignedAreaIds).size !== assignedAreaIds.length
    || assignedAreaIds.some((id) => !areaIds.has(id))) {
    throw new Error("Event venue assignments must uniquely cover every area.");
  }

  return {
    schema: EVENT_DEFINITION_SCHEMA,
    id: value.id as string,
    name: value.name as string,
    venue: venueAssignments[0].venueName,
    dateRangeLabel: value.dateRangeLabel as string,
    dataUpdatedAt: value.dataUpdatedAt as string,
    eventEndsAt: value.eventEndsAt as string,
    mapTemplate: value.mapTemplate as string,
    areaMode: value.areaMode,
    days,
    areas,
    organizerAssignments,
    categoryCatalog: categoryCatalog as unknown as CategoryCatalogReference,
    venueAssignments,
    circleCategories,
    genres: circleCategoryLabels(circleCategories),
    officialData: value.officialData as OfficialDataDefinition,
    dataLastUpdatedLabel: dataDateLabel(value.dataUpdatedAt as string),
  };
}

const injectedEvents = typeof __PUBLISHED_EVENTS__ === "undefined"
  ? [{ definition: sampleDefinition, references: sampleReferences }]
  : __PUBLISHED_EVENTS__;

/**
 * Exactly the events this build serves, in the order a reader is offered them.
 * The set comes from the staged data, so adding an event is a data change: no
 * event is named in code, and nothing here is a per-event constant.
 */
export const PUBLISHED_EVENTS: readonly EventDefinition[] = injectedEvents
  .map(({ definition, references }) => parseEventDefinition(definition, references));

const PUBLISHED_IDS = new Set(PUBLISHED_EVENTS.map((event) => event.id));
// Fixtures stay resolvable so tests and the dev server can name them, but they
// are never published: `getPublishedEvent` is what any public surface asks.
const fixtureDefinitions = [
  parseEventDefinition(sampleDefinition, sampleReferences),
  parseEventDefinition(sampleTwoDefinition, sampleTwoReferences),
];
const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  ...PUBLISHED_EVENTS,
  ...fixtureDefinitions.filter((event) => !PUBLISHED_IDS.has(event.id)),
];

export const EVENT_REGISTRY: ReadonlyMap<string, EventDefinition> = new Map(EVENT_DEFINITIONS.map((event) => [event.id, event]));

export function getEventDefinition(eventId: string) {
  return EVENT_REGISTRY.get(eventId) ?? null;
}

/** Resolves only to something a reader may reach; unpublished ids give null. */
export function getPublishedEvent(eventId: string) {
  return PUBLISHED_EVENTS.find((event) => event.id === eventId) ?? null;
}

/**
 * The event to show when a URL names none. It is a default, not a product
 * concept: nothing may assume it is the only event that exists.
 */
export const ACTIVE_EVENT = PUBLISHED_EVENTS[0];
export const ACTIVE_EVENT_ID = ACTIVE_EVENT.id;

export function eventUsesAreaSwitcher(event: EventDefinition) {
  return event.areaMode === "switchable" && event.areas.length > 1;
}

export function eventUsesVenueSpaceSwitcher(event: EventDefinition) {
  return event.venueAssignments.length > 1;
}

/**
 * A map artifact covers one day in one venue space, so an event needs scoped
 * maps as soon as it has more than one such pair -- two days in a single hall
 * counts, because a hall can be re-laid out overnight. This is deliberately not
 * `eventUsesVenueSpaceSwitcher`: that one answers whether the reader shows a
 * venue-space picker, which stays false for a single hall no matter how many
 * days it runs.
 */
export function eventUsesScopedMaps(event: Pick<EventDefinition, "days" | "venueAssignments">) {
  return event.days.length * event.venueAssignments.length > 1;
}

export function venueAssignmentForArea(event: EventDefinition, areaId: string) {
  return event.venueAssignments.find(({ areaIds }) => areaIds.includes(areaId)) ?? event.venueAssignments[0];
}
