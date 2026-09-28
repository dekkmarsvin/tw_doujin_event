import { parsePublicSearch, writePublicSearch } from "./public-search-url";
import { type AdvancedCircleSearch } from "./circle-search";
import type { PlanningDisplayFilters } from "./display-filter-controls";
import {
  eventUsesVenueSpaceSwitcher, venueAssignmentForArea,
  venueAssignmentForVenueSpace, type EventDefinition,
} from "./event-catalog";

export type PendingCircleSelection<TDay extends string | number> = {
  day: TDay;
  circleId: string | null;
  boothCode: string | null;
};

type EventUrlState<TDay extends string | number> = {
  eventId: string;
  day: TDay;
  venueSpaceId: string;
  query: string;
  genre: string;
  favoriteOnly: boolean;
  advancedSearch: AdvancedCircleSearch;
  planningDisplay: PlanningDisplayFilters;
  selection: PendingCircleSelection<TDay>;
};

/** The default opens the first declared venue space in full. */
export function defaultEventUrlState<TDay extends string | number, TArea extends string>(event: EventDefinition<TDay, TArea>): EventUrlState<TDay> {
  const day = event.days[0]?.id;
  const venueAssignment = event.venueAssignments[0];
  if (day === undefined || !venueAssignment || event.genres.length === 0) throw new Error(`Event ${event.id} has incomplete URL defaults.`);
  return {
    eventId: event.id,
    day,
    venueSpaceId: venueAssignment.venueSpaceId,
    query: "",
    genre: event.genres[0],
    favoriteOnly: false,
    advancedSearch: { creatorType: "ALL", workTopics: [], workTopicMode: "any", excludedWorkTopics: [], workType: "ALL", adultContent: "ALL" },
    planningDisplay: { favoriteGroupId: "ALL", visitStatus: "ALL", sort: "booth", density: "informative", mediaCount: 0 },
    selection: { day, circleId: null, boothCode: null },
  };
}

export type ResolvedUrlEvent =
  /** The URL addresses this event, either by naming it or by there being one. */
  | { kind: "event"; event: EventDefinition }
  /** No event named and more than one to offer, so the reader picks. */
  | { kind: "choose" }
  /** Named an event this build does not serve. */
  | { kind: "unpublished"; requested: string };

/**
 * Which event a URL addresses, before any of its other state is read.
 *
 * `event` is the only parameter that selects *what* the rest of the URL is
 * about, so an unknown one cannot fall back the way an unknown `day` or `genre`
 * does: silently answering with another event's map under someone's shared link
 * is worse than saying the link does not resolve. A URL that names nothing is
 * not an error — with one published event it means that event, and with several
 * it means the reader has not chosen yet.
 */
export function resolveUrlEvent(events: readonly EventDefinition[], input: URL | string): ResolvedUrlEvent {
  const url = typeof input === "string" ? new URL(input, "https://event.invalid/") : input;
  const requested = url.searchParams.get("event");
  if (requested === null) {
    return events.length === 1 && events[0] ? { kind: "event", event: events[0] } : { kind: "choose" };
  }
  const found = events.find(({ id }) => id === requested);
  return found ? { kind: "event", event: found } : { kind: "unpublished", requested };
}

export function parseEventUrlState<TDay extends string | number, TArea extends string>(event: EventDefinition<TDay, TArea>, input: URL | string) {
  const url = typeof input === "string" ? new URL(input, "https://event.invalid/") : input;
  const defaults = defaultEventUrlState(event);
  const requestedEvent = url.searchParams.get("event");
  if (requestedEvent && requestedEvent !== event.id) return { state: defaults, eventMatched: false };

  const dayValue = url.searchParams.get("day");
  const day = event.days.find(({ id }) => String(id) === dayValue)?.id ?? defaults.day;
  const areaValue = url.searchParams.get("area") ?? url.searchParams.get("hall");
  const declaredArea = event.areas.find(({ id }) => id === areaValue)?.id;
  const requestedVenueSpaceId = url.searchParams.get("venueSpaceId");
  const requestedAssignment = event.venueAssignments.find(({ venueSpaceId }) => venueSpaceId === requestedVenueSpaceId);
  // A legacy area/hall only helps locate its venue space. It never filters
  // booths. An explicit valid venueSpaceId takes precedence over either code.
  const inferredAssignment = declaredArea === undefined ? undefined : venueAssignmentForArea(event, declaredArea);
  const defaultAssignment = venueAssignmentForVenueSpace(event, defaults.venueSpaceId);
  const venueAssignment = requestedAssignment ?? inferredAssignment ?? defaultAssignment;
  const visit = url.searchParams.get("visit");
  const sort = url.searchParams.get("sort");
  const density = url.searchParams.get("density");
  const media = Number(url.searchParams.get("media"));
  const state: EventUrlState<TDay> = {
      eventId: event.id,
      day,
      venueSpaceId: venueAssignment.venueSpaceId,
      ...parsePublicSearch(event, url),
      favoriteOnly: url.searchParams.get("favorite") === "1",
      planningDisplay: {
        favoriteGroupId: url.searchParams.get("favoriteGroup") ?? "ALL",
        visitStatus: visit === "planned" || visit === "next" || visit === "visited" || visit === "not-planned" ? visit : "ALL",
        sort: sort === "name" || sort === "updated" ? sort : "booth",
        density: density === "compact" ? "compact" : "informative",
        mediaCount: media === 1 || media === 3 ? media : 0,
      },
      selection: {
        day,
        circleId: url.searchParams.get("selectedCircle"),
        boothCode: url.searchParams.get("selectedBooth"),
      },
  };
  return { eventMatched: true, state };
}

const OPTIONAL_PARAMETERS = ["venueSpaceId", "query", "genre", "favorite", "creator", "work", "workMode", "workExclude", "workType", "r18", "favoriteGroup", "visit", "sort", "density", "media", "selectedCircle", "selectedBooth"];

export function serializeEventUrlState<TDay extends string | number, TArea extends string>(
  event: EventDefinition<TDay, TArea>,
  state: EventUrlState<TDay>,
  input: URL | string,
) {
  if (state.eventId !== event.id) throw new Error(`Cannot serialize ${state.eventId} with event definition ${event.id}.`);
  const url = typeof input === "string" ? new URL(input, "https://event.invalid/") : new URL(input.toString());
  OPTIONAL_PARAMETERS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.delete("hall");
  url.searchParams.delete("area");
  url.searchParams.set("event", event.id);
  url.searchParams.set("day", String(state.day));
  const venueAssignment = venueAssignmentForVenueSpace(event, state.venueSpaceId);
  if (eventUsesVenueSpaceSwitcher(event)) url.searchParams.set("venueSpaceId", venueAssignment.venueSpaceId);
  writePublicSearch(event, state, url);
  if (state.favoriteOnly) url.searchParams.set("favorite", "1");
  if (state.planningDisplay.favoriteGroupId !== "ALL") url.searchParams.set("favoriteGroup", state.planningDisplay.favoriteGroupId);
  if (state.planningDisplay.visitStatus !== "ALL") url.searchParams.set("visit", state.planningDisplay.visitStatus);
  if (state.planningDisplay.sort !== "booth") url.searchParams.set("sort", state.planningDisplay.sort);
  if (state.planningDisplay.density !== "informative") url.searchParams.set("density", state.planningDisplay.density);
  if (state.planningDisplay.mediaCount) url.searchParams.set("media", String(state.planningDisplay.mediaCount));
  if (state.selection.circleId) url.searchParams.set("selectedCircle", state.selection.circleId);
  if (state.selection.boothCode) url.searchParams.set("selectedBooth", state.selection.boothCode);
  return url;
}

type UrlHistoryIntent = "replace" | "push";

export function shouldWriteEventUrl(input: { urlReady: boolean; catalogStatus: "loading" | "ready" | "error"; restoringFromPopstate: boolean }) {
  return input.urlReady && input.catalogStatus !== "loading" && !input.restoringFromPopstate;
}

/** Popstate restores state without immediately creating a new history entry. */
export function historyMethod(intent: UrlHistoryIntent, restoringFromPopstate: boolean): "none" | "replaceState" | "pushState" {
  if (restoringFromPopstate) return "none";
  return intent === "push" ? "pushState" : "replaceState";
}
