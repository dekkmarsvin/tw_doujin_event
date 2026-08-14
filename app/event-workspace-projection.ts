import type { MapSlotView } from "./accessible-event-map-renderer";
import { circleSearchText, type CircleViewRecord } from "./circle-records";
import { buildWorkTopicSuggestions, matchesAdvancedCircleSearch, type AdvancedCircleSearch } from "./circle-search";
import type { PlanningDisplayFilters } from "./display-filter-controls";
import type { EventDefinition } from "./event-catalog";
import type { PlanningDocument } from "./planning-store";

export type WorkspaceFilterDescriptor = {
  id: "area" | "genre" | "favorite" | "creator" | "work" | "work-type" | "adult" | "favorite-group" | "visit";
  label: string;
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
  const dayRecordsByCircleId = new Map(eventRecords.filter((record) => record.day === day).map((record) => [record.circle.id, record] as const));
  const selectedCandidate = recordsById.get(selectedRecordId ?? "") ?? null;
  const selected = selectedCandidate?.placement.eventId === event.id ? selectedCandidate : null;
  const selectedFavorite = selected ? favorites.find((item) => item.circleId === selected.circle.id) ?? null : null;
  const selectedPlan = selected ? plansById.get(selected.circle.id) ?? null : null;
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
    const statusLabels = [
      favorite ? "已收藏" : "",
      planEntries.some((entry) => entry.status === "next") ? "下一站" : "",
      planEntries.some((entry) => entry.status === "visited") ? "已走訪" : "",
      planEntries.some((entry) => entry.status === "planned") ? "待前往" : "",
    ].filter(Boolean);
    return [marker.code, {
      tone: representative.tone,
      label: marker.records.map((record) => record.name).join("、"),
      ariaLabel: [marker.code, marker.records.map((record) => record.name).join("、"), ...statusLabels, marker.records.map((record) => record.genre).join("、")].join("，"),
      selected: selected?.day === day && selected.code === marker.code,
      favorite,
      planned: planEntries.length > 0,
      next: planEntries.some((entry) => entry.status === "next"),
      visited: planEntries.some((entry) => entry.status === "visited"),
      thumbnailUrl: representative.circle.media[0]?.url,
    }];
  }));
  const filters: WorkspaceFilterDescriptor[] = [
    ...(event.areaMode === "switchable" && area !== "ALL" ? [{ id: "area" as const, label: event.areas.find((item) => item.id === area)?.label ?? area }] : []),
    ...(genre !== event.genres[0] ? [{ id: "genre" as const, label: genre }] : []),
    ...(favoriteOnly ? [{ id: "favorite" as const, label: "只看收藏" }] : []),
    ...(advancedSearch.creatorType !== "ALL" ? [{ id: "creator" as const, label: `創作者：${advancedSearch.creatorType}` }] : []),
    ...(advancedSearch.workQuery ? [{ id: "work" as const, label: `作品：${advancedSearch.workQuery}` }] : []),
    ...(advancedSearch.workType !== "ALL" ? [{ id: "work-type" as const, label: advancedSearch.workType }] : []),
    ...(advancedSearch.adultContent !== "ALL" ? [{ id: "adult" as const, label: advancedSearch.adultContent === "R18" ? "只看 R18" : "只看一般" }] : []),
    ...(planningDisplay.favoriteGroupId !== "ALL" ? [{ id: "favorite-group" as const, label: planningDisplay.favoriteGroupId === "UNGROUPED" ? "未分組收藏" : groups.get(planningDisplay.favoriteGroupId) ?? "收藏群組" }] : []),
    ...(planningDisplay.visitStatus !== "ALL" ? [{ id: "visit" as const, label: ({ planned: "待前往", next: "下一站", visited: "已走訪", "not-planned": "未加入行程" } as const)[planningDisplay.visitStatus] }] : []),
  ];
  return {
    favorites, favoriteIds, favoriteGroupLabels, dayPlan, plansById, dayRecordsByCircleId,
    selected, selectedFavorite, selectedPlan, nextEntry, nextRecord, navigationTargetRecord,
    visitedCount, sharedRecords, filtered, mapRecords, workTopicSuggestions, genreCounts,
    markers, markersByCode, slots, activeFilterDescriptors: filters,
  };
}
