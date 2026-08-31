import type { MapSlotView } from "./accessible-event-map-renderer";
import { circleSearchText, placementStatusLabel, type CircleViewRecord } from "./circle-records";
import { buildWorkTopicSuggestions, describeCircleMatch, matchesAdvancedCircleSearch, normalizeWorkTopics, type AdvancedCircleSearch, type CircleMatchReason } from "./circle-search";
import type { PlanningDisplayFilters } from "./display-filter-controls";
import type { EventDefinition } from "./event-catalog";
import type { PlanningDocument } from "./planning-store";

export type WorkspaceFilterKind = "area" | "genre" | "favorite" | "creator" | "work" | "work-exclude" | "work-type" | "adult" | "favorite-group" | "visit";

/** `kind` says which control owns the chip; `id` is unique because work topics
 * produce one chip each. `value` carries the topic the chip would remove. */
export type WorkspaceFilterDescriptor = {
  id: string;
  kind: WorkspaceFilterKind;
  label: string;
  value?: string;
};

type ProjectionInput = {
  event: EventDefinition;
  records: CircleViewRecord[];
  recordsById: ReadonlyMap<string, CircleViewRecord>;
  recordsByCircleId: ReadonlyMap<string, CircleViewRecord[]>;
  planning: PlanningDocument;
  day: CircleViewRecord["day"];
  area: string;
  genre: string;
  query: string;
  favoriteOnly: boolean;
  advancedSearch: AdvancedCircleSearch;
  planningDisplay: PlanningDisplayFilters;
  navigationMode: boolean;
  selectedRecordId: string | null;
};

/**
 * Where a moved placement now points: the same circle's live booth in this
 * event. The catalog carries no forwarding field, so a move with no active
 * placement simply has no destination and the reader is told that much.
 */
function movedDestination(record: CircleViewRecord, eventRecords: CircleViewRecord[]) {
  const live = eventRecords.filter((item) => item.circle.id === record.circle.id && item.placement.status === "active");
  return live.find((item) => item.day === record.day) ?? live[0] ?? null;
}

export function projectEventWorkspace(input: ProjectionInput) {
  const { event, records, recordsById, recordsByCircleId, planning, day, area, genre, query, favoriteOnly, advancedSearch, planningDisplay, navigationMode, selectedRecordId } = input;
  const eventRecords = records.filter((record) => record.placement.eventId === event.id);
  const favorites = planning.favorites.filter((item) => item.eventId === event.id);
  const favoriteIds = new Set(favorites.map((item) => item.circleId));
  const groups = new Map(planning.favoriteGroups.map((group) => [group.id, group.name]));
  const favoriteGroupLabels = new Map(favorites.flatMap((favorite) => favorite.groupId && groups.has(favorite.groupId)
    ? [[favorite.circleId, groups.get(favorite.groupId)!] as const]
    : []));
  const dayPlan = planning.visitPlans
    .filter((item) => item.eventId === event.id && item.day === day)
    .sort((left, right) => left.routeOrder - right.routeOrder);
  const plansById = new Map(dayPlan.map((entry) => [entry.circleId, entry]));
  // A circle that moved holds both the retired booth and its current one on the
  // same day, so the itinerary and the next stop have to resolve to the booth a
  // reader can still walk to.
  const dayRecordsByCircleId = new Map<string, CircleViewRecord>();
  eventRecords.filter((record) => record.day === day).forEach((record) => {
    const current = dayRecordsByCircleId.get(record.circle.id);
    if (current?.placement.status === "active" && record.placement.status !== "active") return;
    dayRecordsByCircleId.set(record.circle.id, record);
  });
  const selectedCandidate = recordsById.get(selectedRecordId ?? "") ?? null;
  const selected = selectedCandidate?.placement.eventId === event.id ? selectedCandidate : null;
  const selectedFavorite = selected ? favorites.find((item) => item.circleId === selected.circle.id) ?? null : null;
  const selectedPlan = selected ? plansById.get(selected.circle.id) ?? null : null;
  // Only where the organizer's own data already carries the new booth. Nothing
  // here guesses a destination for a placement that has none.
  const selectedMovedDestination = selected?.placement.status === "moved"
    ? movedDestination(selected, eventRecords)
    : null;
  const nextEntry = dayPlan.find((entry) => entry.status === "next") ?? null;
  const nextRecord = nextEntry ? dayRecordsByCircleId.get(nextEntry.circleId) ?? null : null;
  const navigationTargetEntry = nextEntry ?? dayPlan.find((entry) => entry.status !== "visited") ?? null;
  const navigationTargetRecord = navigationTargetEntry ? dayRecordsByCircleId.get(navigationTargetEntry.circleId) ?? null : null;
  const visitedCount = dayPlan.filter((entry) => entry.status === "visited").length;
  const sharedRecords = selected ? eventRecords.filter((record) => record.day === selected.day && record.code === selected.code) : [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = eventRecords.filter((record) => {
    const favorite = favorites.find((item) => item.circleId === record.circle.id);
    const plan = plansById.get(record.circle.id);
    const groupMatches = planningDisplay.favoriteGroupId === "ALL"
      || (planningDisplay.favoriteGroupId === "UNGROUPED" ? !!favorite && !favorite.groupId : favorite?.groupId === planningDisplay.favoriteGroupId);
    const visitMatches = planningDisplay.visitStatus === "ALL"
      || (planningDisplay.visitStatus === "not-planned" ? !plan : plan?.status === planningDisplay.visitStatus);
    return record.day === day
      && (area === "ALL" || record.hall === area)
      && (genre === event.genres[0] || record.genre === genre)
      && (!favoriteOnly || favoriteIds.has(record.circle.id))
      && groupMatches && visitMatches
      && matchesAdvancedCircleSearch(record, advancedSearch)
      && (!needle || circleSearchText(record).includes(needle));
  }).sort((left, right) => {
    if (planningDisplay.sort === "name") return left.name.localeCompare(right.name, "zh-Hant");
    if (planningDisplay.sort === "updated") {
      const updated = (record: CircleViewRecord) => favorites.find((item) => item.circleId === record.circle.id)?.updatedAt
        ?? plansById.get(record.circle.id)?.updatedAt ?? record.sources[0]?.fetchedAt ?? "";
      return updated(right).localeCompare(updated(left)) || left.code.localeCompare(right.code, undefined, { numeric: true });
    }
    return left.code.localeCompare(right.code, undefined, { numeric: true }) || left.name.localeCompare(right.name, "zh-Hant");
  });
  const mapRecords = navigationMode
    ? dayPlan.flatMap((entry) => (recordsByCircleId.get(entry.circleId) ?? []).filter((record) => record.placement.eventId === event.id && record.day === day))
    : filtered;
  const workTopicSuggestions = buildWorkTopicSuggestions(eventRecords);
  // Only the visible result set is explained; the reasons are read per card and
  // recomputing them there would repeat the alias expansion on every render.
  const matchReasonsByRecordId = new Map<string, CircleMatchReason[]>(
    filtered.map((record) => [record.recordId, describeCircleMatch(record, { query, search: advancedSearch })] as const),
  );
  const genreCounts = new Map<string, number>(event.genres.map((value) => [value, 0]));
  eventRecords.forEach((record) => {
    if (record.day !== day) return;
    genreCounts.set(event.genres[0], (genreCounts.get(event.genres[0]) ?? 0) + 1);
    if (genreCounts.has(record.genre)) genreCounts.set(record.genre, (genreCounts.get(record.genre) ?? 0) + 1);
  });
  const markerRecords = new Map<string, CircleViewRecord[]>();
  mapRecords.forEach((record) => markerRecords.set(record.code, [...(markerRecords.get(record.code) ?? []), record]));
  const markers = [...markerRecords].map(([code, markerItems]) => ({ code, records: markerItems }));
  const markersByCode = new Map(markers.map((marker) => [marker.code, marker]));
  const slots = Object.fromEntries(markers.map((marker): [string, MapSlotView] => {
    const representative = marker.records[0];
    const planEntries = marker.records.flatMap((record) => plansById.get(record.circle.id) ?? []);
    const favorite = marker.records.some((record) => favoriteIds.has(record.circle.id));
    // A booth handed over keeps an active placement, and that booth is still a
    // destination; only a code where nothing is active reads as retired.
    const retired = marker.records.every((record) => record.placement.status !== "active")
      ? marker.records[0].placement.status as "cancelled" | "moved"
      : undefined;
    // Only a wholly retired booth gets slot-level wording: on a booth someone
    // else took over, one label for two circles would say nothing usable.
    const retiredLabels = retired ? [placementStatusLabel(retired)] : [];
    const statusLabels = [
      ...retiredLabels,
      favorite ? "已收藏" : "",
      planEntries.some((entry) => entry.status === "next") ? "下一站" : "",
      planEntries.some((entry) => entry.status === "visited") ? "已走訪" : "",
      planEntries.some((entry) => entry.status === "planned") ? "待前往" : "",
    ].filter(Boolean);
    return [marker.code, {
      tone: representative.tone,
      label: [marker.records.map((record) => record.name).join("、"), ...retiredLabels].join("，"),
      ariaLabel: [marker.code, marker.records.map((record) => record.name).join("、"), ...statusLabels,
        ...new Set(marker.records.map((record) => record.genre).filter((value) => value !== event.genres[0]))].join("，"),
      selected: selected?.day === day && selected.code === marker.code,
      favorite,
      planned: planEntries.length > 0,
      next: planEntries.some((entry) => entry.status === "next"),
      visited: planEntries.some((entry) => entry.status === "visited"),
      retired,
      thumbnailUrl: representative.circle.media[0]?.url,
    }];
  }));
  const includedTopics = normalizeWorkTopics(advancedSearch.workTopics);
  // Under `all` every listed topic has to hold, so each chip reads as one more
  // requirement rather than one more alternative.
  const topicPrefix = includedTopics.length > 1 && advancedSearch.workTopicMode === "all" ? "同時包含：" : "作品：";
  const filters: WorkspaceFilterDescriptor[] = [
    ...(event.areaMode === "switchable" && area !== "ALL" ? [{ id: "area", kind: "area" as const, label: event.areas.find((item) => item.id === area)?.label ?? area }] : []),
    ...(genre !== event.genres[0] ? [{ id: "genre", kind: "genre" as const, label: genre }] : []),
    ...(favoriteOnly ? [{ id: "favorite", kind: "favorite" as const, label: "只看收藏" }] : []),
    ...(advancedSearch.creatorType !== "ALL" ? [{ id: "creator", kind: "creator" as const, label: `創作者：${advancedSearch.creatorType}` }] : []),
    ...includedTopics.map((topic) => ({ id: `work:${topic}`, kind: "work" as const, label: `${topicPrefix}${topic}`, value: topic })),
    ...normalizeWorkTopics(advancedSearch.excludedWorkTopics).map((topic) => ({ id: `work-exclude:${topic}`, kind: "work-exclude" as const, label: `排除：${topic}`, value: topic })),
    ...(advancedSearch.workType !== "ALL" ? [{ id: "work-type", kind: "work-type" as const, label: advancedSearch.workType }] : []),
    ...(advancedSearch.adultContent !== "ALL" ? [{ id: "adult", kind: "adult" as const, label: advancedSearch.adultContent === "R18" ? "只看 R18" : "只看一般" }] : []),
    ...(planningDisplay.favoriteGroupId !== "ALL" ? [{ id: "favorite-group", kind: "favorite-group" as const, label: planningDisplay.favoriteGroupId === "UNGROUPED" ? "未分組收藏" : groups.get(planningDisplay.favoriteGroupId) ?? "收藏群組" }] : []),
    ...(planningDisplay.visitStatus !== "ALL" ? [{ id: "visit", kind: "visit" as const, label: ({ planned: "待前往", next: "下一站", visited: "已走訪", "not-planned": "未加入行程" } as const)[planningDisplay.visitStatus] }] : []),
  ];
  return {
    favorites, favoriteIds, favoriteGroupLabels, dayPlan, plansById, dayRecordsByCircleId,
    selected, selectedFavorite, selectedPlan, selectedMovedDestination, nextEntry, nextRecord, navigationTargetRecord,
    visitedCount, sharedRecords, filtered, mapRecords, workTopicSuggestions, matchReasonsByRecordId, genreCounts,
    markers, markersByCode, slots, activeFilterDescriptors: filters,
  };
}
