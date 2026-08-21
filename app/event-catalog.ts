import ff47Definition from "../data/events/ff47/event.json";

export const EVENT_DEFINITION_SCHEMA = "event-definition/1" as const;

export type EventDayDefinition<TDay extends string | number = string | number> = { id: TDay; label: string; dateLabel: string };
export type EventAreaDefinition<TArea extends string = string> = { id: TArea; label: string; shortLabel: string };
export type OrganizerDefinition = {
  adapter: string;
  eventUrl: string;
  boothListUrls: Readonly<Record<string, string>>;
};

export type EventDefinition<TDay extends string | number = string | number, TArea extends string = string> = {
  schema: typeof EVENT_DEFINITION_SCHEMA;
  id: string;
  name: string;
  venue: string;
  dateRangeLabel: string;
  dataUpdatedAt: string;
  dataLastUpdatedLabel: string;
  eventEndsAt: string;
  mapTemplate: string;
  areaMode: "single" | "switchable";
  days: readonly EventDayDefinition<TDay>[];
  areas: readonly EventAreaDefinition<TArea>[];
  /** Creator-category filter vocabulary. The first entry is the unfiltered option. */
  genres: readonly string[];
  organizer: OrganizerDefinition;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function dataDateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

/** Strict at the boundary: a malformed pinned event must stop the build, not
 * become a partly working event whose defaults are guessed in the UI. */
export function parseEventDefinition(value: unknown): EventDefinition {
  if (!isRecord(value) || value.schema !== EVENT_DEFINITION_SCHEMA) throw new Error("Unsupported event definition schema.");
  for (const key of ["id", "name", "venue", "dateRangeLabel", "dataUpdatedAt", "eventEndsAt", "mapTemplate"] as const) {
    if (!nonempty(value[key])) throw new Error(`Event definition ${key} must be a non-empty string.`);
  }
  if (Number.isNaN(Date.parse(value.dataUpdatedAt as string)) || Number.isNaN(Date.parse(value.eventEndsAt as string))) {
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
  if (!Array.isArray(value.genres) || value.genres.length === 0 || !value.genres.every(nonempty)) {
    throw new Error("Event definition genres are invalid.");
  }
  if (!isRecord(value.organizer) || !nonempty(value.organizer.adapter) || !nonempty(value.organizer.eventUrl)
    || !isRecord(value.organizer.boothListUrls)
    || !Object.values(value.organizer.boothListUrls).every(nonempty)) {
    throw new Error("Event definition organizer is invalid.");
  }
  const days = value.days as EventDayDefinition[];
  const areas = value.areas as EventAreaDefinition[];
  const dayIds = new Set(days.map((day) => String(day.id)));
  const boothListDays = Object.keys(value.organizer.boothListUrls);
  if (dayIds.size !== days.length || boothListDays.length !== days.length || !boothListDays.every((day) => dayIds.has(day))) {
    throw new Error("Event definition day ids must be unique and cover organizer booth lists.");
  }
  if (new Set(areas.map((area) => area.id)).size !== areas.length) throw new Error("Event definition area ids must be unique.");

  return {
    ...(value as Omit<EventDefinition, "dataLastUpdatedLabel">),
    dataLastUpdatedLabel: dataDateLabel(value.dataUpdatedAt as string),
  };
}

const EVENT_DEFINITIONS = [parseEventDefinition(ff47Definition)] as const;

/** The registry is the only shared-code list that changes when an event is
 * added. Existing event definitions and organizer adapters remain untouched. */
export const EVENT_REGISTRY: ReadonlyMap<string, EventDefinition> = new Map(
  EVENT_DEFINITIONS.map((event) => [event.id, event]),
);

export function getEventDefinition(eventId: string) {
  return EVENT_REGISTRY.get(eventId) ?? null;
}

export const ACTIVE_EVENT = EVENT_DEFINITIONS[0];
export const ACTIVE_EVENT_ID = ACTIVE_EVENT.id;

export function eventUsesAreaSwitcher(event: EventDefinition) {
  return event.areaMode === "switchable" && event.areas.length > 1;
}
