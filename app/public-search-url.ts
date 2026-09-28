import { normalizeWorkTopics } from "./circle-search";
import type { WORK_TYPE_OPTIONS } from "./circle-overrides";
import type { EventDefinition } from "./event-catalog";
import type { PublicSearch } from "./public-circle-search";

/**
 * 作品類型在 URL 裡走 ASCII 代號。舊的 `original`／`derivative` 沒有對應的取向，
 * 讀到就當成未設定，舊連結仍然開得起來，只是少一個條件。
 */
const WORK_TYPE_PARAMETERS: Record<string, (typeof WORK_TYPE_OPTIONS)[number]> = {
  male: "男性向",
  female: "女性向",
  general: "一般向",
};

export function parsePublicSearch(event: EventDefinition, url: URL): PublicSearch {
  const genreValue = url.searchParams.get("genre");
  const genre = genreValue && event.genres.includes(genreValue) ? genreValue : event.genres[0];
  const workType = url.searchParams.get("workType") ?? "";
  const adultContent = url.searchParams.get("r18");
  return { query: url.searchParams.get("query") ?? "", genre,
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
  };
}

export function writePublicSearch(event: EventDefinition, state: PublicSearch, url: URL) {
  const defaults = { genre: event.genres[0] };
  if (state.query.trim()) url.searchParams.set("query", state.query.trim());
  if (state.genre !== defaults.genre) url.searchParams.set("genre", state.genre);
  if (state.advancedSearch.creatorType !== "ALL") url.searchParams.set("creator", state.advancedSearch.creatorType);
  normalizeWorkTopics(state.advancedSearch.workTopics).forEach((topic) => url.searchParams.append("work", topic));
  if (state.advancedSearch.workTopicMode === "all") url.searchParams.set("workMode", "all");
  normalizeWorkTopics(state.advancedSearch.excludedWorkTopics).forEach((topic) => url.searchParams.append("workExclude", topic));
  const workTypeParameter = Object.keys(WORK_TYPE_PARAMETERS).find((key) => WORK_TYPE_PARAMETERS[key] === state.advancedSearch.workType);

  if (workTypeParameter) url.searchParams.set("workType", workTypeParameter);
  if (state.advancedSearch.adultContent !== "ALL") url.searchParams.set("r18", state.advancedSearch.adultContent === "R18" ? "include" : state.advancedSearch.adultContent === "R15" ? "r15" : "general");
}
