import { circleSearchText, type CircleViewRecord } from "./circle-records";
import { ageRatingFilterLabel, matchesAdvancedCircleSearch, normalizeWorkTopics, type AdvancedCircleSearch } from "./circle-search";
import { venueAssignmentForVenueSpace, type EventDefinition } from "./event-catalog";

export type PublicSearch = { query: string; genre: string; advancedSearch: AdvancedCircleSearch };
export type PublicScope = { day: string | number | null; venueSpaceId: string | null };
export type PublicFilterDescriptor = { id: string; kind: "genre" | "creator" | "work" | "work-exclude" | "work-type" | "adult"; label: string; value?: string };

export function matchesPublicScope(record: CircleViewRecord, event: EventDefinition, scope: PublicScope) {
  return record.placement.eventId === event.id
    && (scope.day === null || record.day === scope.day)
    && (scope.venueSpaceId === null || venueAssignmentForVenueSpace(event, scope.venueSpaceId).areaIds.includes(record.hall));
}

export function matchesPublicSearch(record: CircleViewRecord, event: EventDefinition, search: PublicSearch) {
  const needle = search.query.trim().toLocaleLowerCase();
  return (search.genre === event.genres[0] || record.genre === search.genre)
    && matchesAdvancedCircleSearch(record, search.advancedSearch)
    && (!needle || circleSearchText(record).includes(needle));
}

export function describePublicSearchFilters(event: EventDefinition, search: PublicSearch): PublicFilterDescriptor[] {
  const { genre, advancedSearch } = search;
  const includedTopics = normalizeWorkTopics(advancedSearch.workTopics);
  // Under `all` every listed topic has to hold, so each chip reads as one more
  // requirement rather than one more alternative.
  const topicPrefix = includedTopics.length > 1 && advancedSearch.workTopicMode === "all" ? "同時包含：" : "作品：";
  return [
    ...(genre !== event.genres[0] ? [{ id: "genre", kind: "genre" as const, label: genre }] : []),
    ...(advancedSearch.creatorType !== "ALL" ? [{ id: "creator", kind: "creator" as const, label: `創作者：${advancedSearch.creatorType}` }] : []),
    ...includedTopics.map((topic) => ({ id: `work:${topic}`, kind: "work" as const, label: `${topicPrefix}${topic}`, value: topic })),
    ...normalizeWorkTopics(advancedSearch.excludedWorkTopics).map((topic) => ({ id: `work-exclude:${topic}`, kind: "work-exclude" as const, label: `排除：${topic}`, value: topic })),
    ...(advancedSearch.workType !== "ALL" ? [{ id: "work-type", kind: "work-type" as const, label: advancedSearch.workType }] : []),
    ...(advancedSearch.adultContent !== "ALL" ? [{ id: "adult", kind: "adult" as const, label: ageRatingFilterLabel(advancedSearch.adultContent) }] : []),
  ];
}
