import { normalizeWorkTopics, type AdvancedCircleSearch } from "./circle-search";
import type { WORK_TYPE_OPTIONS } from "./circle-overrides";
import type { PlanningDisplayFilters } from "./display-filter-controls";
import {
  eventUsesVenueSpaceSwitcher, venueAssignmentForArea,
  venueAssignmentForVenueSpace, type EventDefinition,
} from "./event-catalog";

/**
 * 作品類型在 URL 裡走 ASCII 代號。舊的 `original`／`derivative` 沒有對應的取向，
 * 讀到就當成未設定，舊連結仍然開得起來，只是少一個條件。
 */
const WORK_TYPE_PARAMETERS: Record<string, (typeof WORK_TYPE_OPTIONS)[number]> = {
  male: "男性向",
  female: "女性向",
  general: "一般向",
};

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
  const genreValue = url.searchParams.get("genre");
  const genre = genreValue && event.genres.includes(genreValue) ? genreValue : defaults.genre;
  const workType = url.searchParams.get("workType") ?? "";
  const adultContent = url.searchParams.get("r18");
  const visit = url.searchParams.get("visit");
  const sort = url.searchParams.get("sort");
  const density = url.searchParams.get("density");
  const media = Number(url.searchParams.get("media"));
  const state: EventUrlState<TDay> = {
      eventId: event.id,
      day,
      venueSpaceId: venueAssignment.venueSpaceId,
      query: url.searchParams.get("query") ?? "",
      genre,
      favoriteOnly: url.searchParams.get("favorite") === "1",
      advancedSearch: {
        creatorType: url.searchParams.get("creator") ?? "ALL",
        // Repeated rather than delimited, so a work whose title contains the
        // delimiter cannot split itself into two conditions.
        workTopics: normalizeWorkTopics(url.searchParams.getAll("work")),
        workTopicMode: url.searchParams.get("workMode") === "all" ? "all" : "any",
        excludedWorkTopics: normalizeWorkTopics(url.searchParams.getAll("workExclude")),
        // Own-property check, not a bare lookup: `?workType=__proto__` would
        // otherwise hand an inherited object to the search state and the applied
        // filter chip would try to render it.
        workType: Object.hasOwn(WORK_TYPE_PARAMETERS, workType) ? WORK_TYPE_PARAMETERS[workType] : "ALL",
        adultContent: adultContent === "include" ? "R18" : adultContent === "r15" ? "R15" : adultContent === "general" || adultContent === "exclude" ? "GENERAL" : "ALL",
      },
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
  const defaults = defaultEventUrlState(event);
  OPTIONAL_PARAMETERS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.delete("hall");
  url.searchParams.delete("area");
  url.searchParams.set("event", event.id);
  url.searchParams.set("day", String(state.day));
  const venueAssignment = venueAssignmentForVenueSpace(event, state.venueSpaceId);
  if (eventUsesVenueSpaceSwitcher(event)) url.searchParams.set("venueSpaceId", venueAssignment.venueSpaceId);
  if (state.query.trim()) url.searchParams.set("query", state.query.trim());
  if (state.genre !== defaults.genre) url.searchParams.set("genre", state.genre);
  if (state.favoriteOnly) url.searchParams.set("favorite", "1");
  if (state.advancedSearch.creatorType !== "ALL") url.searchParams.set("creator", state.advancedSearch.creatorType);
  normalizeWorkTopics(state.advancedSearch.workTopics).forEach((topic) => url.searchParams.append("work", topic));
  if (state.advancedSearch.workTopicMode === "all") url.searchParams.set("workMode", "all");
  normalizeWorkTopics(state.advancedSearch.excludedWorkTopics).forEach((topic) => url.searchParams.append("workExclude", topic));
  const workTypeParameter = Object.keys(WORK_TYPE_PARAMETERS).find((key) => WORK_TYPE_PARAMETERS[key] === state.advancedSearch.workType);

  if (workTypeParameter) url.searchParams.set("workType", workTypeParameter);
  if (state.advancedSearch.adultContent !== "ALL") url.searchParams.set("r18", state.advancedSearch.adultContent === "R18" ? "include" : state.advancedSearch.adultContent === "R15" ? "r15" : "general");
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
