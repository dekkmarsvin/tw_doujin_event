import type { AdvancedCircleSearch } from "./circle-search";
import type { PlanningDisplayFilters } from "./display-filter-controls";
import type { EventDefinition } from "./event-catalog";

export type PendingCircleSelection<TDay extends string | number> = {
  day: TDay;
  circleId: string | null;
  boothCode: string | null;
};

export type EventUrlState<TDay extends string | number, TArea extends string> = {
  eventId: string;
  day: TDay;
  area: TArea;
  query: string;
  genre: string;
  favoriteOnly: boolean;
  advancedSearch: AdvancedCircleSearch;
  planningDisplay: PlanningDisplayFilters;
  selection: PendingCircleSelection<TDay>;
};

export function defaultEventUrlState<TDay extends string | number, TArea extends string>(event: EventDefinition<TDay, TArea>): EventUrlState<TDay, TArea> {
  const day = event.days[0]?.id;
  const area = event.areas[0]?.id;
  if (day === undefined || area === undefined || event.genres.length === 0) throw new Error(`Event ${event.id} has incomplete URL defaults.`);
  return {
    eventId: event.id,
    day,
    area,
    query: "",
    genre: event.genres[0],
    favoriteOnly: false,
    advancedSearch: { creatorType: "ALL", workQuery: "", workType: "ALL", adultContent: "ALL" },
    planningDisplay: { favoriteGroupId: "ALL", visitStatus: "ALL", sort: "booth", density: "informative", mediaCount: 0 },
    selection: { day, circleId: null, boothCode: null },
  };
}

export function parseEventUrlState<TDay extends string | number, TArea extends string>(event: EventDefinition<TDay, TArea>, input: URL | string) {
  const url = typeof input === "string" ? new URL(input, "https://event.invalid/") : input;
  const defaults = defaultEventUrlState(event);
  const requestedEvent = url.searchParams.get("event");
  if (requestedEvent && requestedEvent !== event.id) return { state: defaults, eventMatched: false };

  const dayValue = url.searchParams.get("day");
  const day = event.days.find(({ id }) => String(id) === dayValue)?.id ?? defaults.day;
  const areaValue = url.searchParams.get("area") ?? url.searchParams.get("hall");
  const area = event.areas.find(({ id }) => id === areaValue)?.id ?? defaults.area;
  const genreValue = url.searchParams.get("genre");
  const genre = genreValue && event.genres.includes(genreValue) ? genreValue : defaults.genre;
  const workType = url.searchParams.get("workType");
  const adultContent = url.searchParams.get("r18");
  const visit = url.searchParams.get("visit");
  const sort = url.searchParams.get("sort");
  const density = url.searchParams.get("density");
  const media = Number(url.searchParams.get("media"));
  const state: EventUrlState<TDay, TArea> = {
      eventId: event.id,
      day,
      area,
      query: url.searchParams.get("query") ?? "",
      genre,
      favoriteOnly: url.searchParams.get("favorite") === "1",
      advancedSearch: {
        creatorType: url.searchParams.get("creator") ?? "ALL",
        workQuery: url.searchParams.get("work") ?? "",
        workType: workType === "original" ? "原創" : workType === "derivative" ? "二創" : "ALL",
        adultContent: adultContent === "include" ? "R18" : adultContent === "general" || adultContent === "exclude" ? "GENERAL" : "ALL",
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

const OPTIONAL_PARAMETERS = ["query", "genre", "favorite", "creator", "work", "workType", "r18", "favoriteGroup", "visit", "sort", "density", "media", "selectedCircle", "selectedBooth"];

export function serializeEventUrlState<TDay extends string | number, TArea extends string>(
  event: EventDefinition<TDay, TArea>,
  state: EventUrlState<TDay, TArea>,
  input: URL | string,
) {
  if (state.eventId !== event.id) throw new Error(`Cannot serialize ${state.eventId} with event definition ${event.id}.`);
  const url = typeof input === "string" ? new URL(input, "https://event.invalid/") : new URL(input.toString());
  const defaults = defaultEventUrlState(event);
  OPTIONAL_PARAMETERS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.delete("hall");
  url.searchParams.set("event", event.id);
  url.searchParams.set("day", String(state.day));
  url.searchParams.set("area", state.area);
  if (state.query.trim()) url.searchParams.set("query", state.query.trim());
  if (state.genre !== defaults.genre) url.searchParams.set("genre", state.genre);
  if (state.favoriteOnly) url.searchParams.set("favorite", "1");
  if (state.advancedSearch.creatorType !== "ALL") url.searchParams.set("creator", state.advancedSearch.creatorType);
  if (state.advancedSearch.workQuery.trim()) url.searchParams.set("work", state.advancedSearch.workQuery.trim());
  if (state.advancedSearch.workType !== "ALL") url.searchParams.set("workType", state.advancedSearch.workType === "原創" ? "original" : "derivative");
  if (state.advancedSearch.adultContent !== "ALL") url.searchParams.set("r18", state.advancedSearch.adultContent === "R18" ? "include" : "general");
  if (state.planningDisplay.favoriteGroupId !== "ALL") url.searchParams.set("favoriteGroup", state.planningDisplay.favoriteGroupId);
  if (state.planningDisplay.visitStatus !== "ALL") url.searchParams.set("visit", state.planningDisplay.visitStatus);
  if (state.planningDisplay.sort !== "booth") url.searchParams.set("sort", state.planningDisplay.sort);
  if (state.planningDisplay.density !== "informative") url.searchParams.set("density", state.planningDisplay.density);
  if (state.planningDisplay.mediaCount) url.searchParams.set("media", String(state.planningDisplay.mediaCount));
  if (state.selection.circleId) url.searchParams.set("selectedCircle", state.selection.circleId);
  if (state.selection.boothCode) url.searchParams.set("selectedBooth", state.selection.boothCode);
  return url;
}

export type UrlHistoryIntent = "replace" | "push";

export function shouldWriteEventUrl(input: { urlReady: boolean; catalogStatus: "loading" | "ready" | "error"; restoringFromPopstate: boolean }) {
  return input.urlReady && input.catalogStatus !== "loading" && !input.restoringFromPopstate;
}

/** Popstate restores state without immediately creating a new history entry. */
export function historyMethod(intent: UrlHistoryIntent, restoringFromPopstate: boolean): "none" | "replaceState" | "pushState" {
  if (restoringFromPopstate) return "none";
  return intent === "push" ? "pushState" : "replaceState";
}
