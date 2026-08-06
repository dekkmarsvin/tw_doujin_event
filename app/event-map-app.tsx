"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GENRES } from "./ff47-booths";
import MapAdminImporter from "./map-admin-importer";
import AccessibleEventMapRenderer, { type MapSlotView } from "./accessible-event-map-renderer";
import { loadPublishedEventMap } from "./event-map-client";
import { FF47_EVENT_ID, type PublishedEventMap } from "./event-map";
import { CIRCLE_RECORDS, CIRCLE_RECORDS_BY_ID, circleSearchText, type CircleViewRecord } from "./circle-records";
import { CircleDetails, DayItinerary, SearchResults, type ActiveResultFilter } from "./event-workspace-panels";
import DisplayFilterControls, { DEFAULT_ADVANCED_FILTERS, type AdvancedFilters } from "./display-filter-controls";
import {
  addToVisitPlan,
  createFavoriteGroup,
  markVisited,
  moveVisitPlanEntry,
  moveVisitPlanEntryToIndex,
  removeFromVisitPlan,
  restoreFavorite,
  setNextStop,
  toggleFavorite,
  updateFavorite,
  type FavoriteRecord,
} from "./planning-store";
import { usePlanning } from "./use-planning";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import { resolveCircleSelection } from "./map-view-state";
import { clampMapZoom, zoomOffsetAroundPoint } from "./map-viewport";
import { FF47_EVENT, type FF47Area, type FF47Day } from "./event-catalog";
import styles from "./event-map-app.module.css";

type Hall = FF47Area;
type MobilePanel = "filters" | "results" | "details" | "plan";
type MapGesture =
  | { kind: "drag"; pointerId: number; x: number; y: number; ox: number; oy: number }
  | { kind: "pinch"; distance: number; zoom: number; mapX: number; mapY: number };

function parseDay(value: string | null): FF47Day | null {
  const day = Number(value);
  return FF47_EVENT.days.some((item) => item.id === day) ? day as FF47Day : null;
}

function parseArea(value: string | null): Hall {
  return FF47_EVENT.areas.some((area) => area.id === value) ? value as Hall : "ALL";
}

export default function EventMapApp() {
  const [day, setDay] = useState<FF47Day>(FF47_EVENT.days[0].id);
  const [hall, setHall] = useState<Hall>("ALL");
  const [genre, setGenre] = useState("全部類別");
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(DEFAULT_ADVANCED_FILTERS);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [leftMode, setLeftMode] = useState<"search" | "plan">("search");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("results");
  const [onsiteMode, setOnsiteMode] = useState(false);
  const [zoom, setZoom] = useState(.8);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [publishedMap, setPublishedMap] = useState<PublishedEventMap | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [favoriteUndo, setFavoriteUndo] = useState<{ favorite: FavoriteRecord; circleName: string } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const { document: planning, ready: planningReady, update: updatePlanning, storageError: planningStorageError } = usePlanning(FF47_EVENT_ID);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const fullDetailRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<MapGesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const historyIntent = useRef<"replace" | "push">("replace");
  const suppressUrlWrite = useRef(false);
  const lastAutoSelection = useRef("");
  const pendingRestoreCode = useRef<string | null>(null);

  useEffect(() => {
    const restore = (fromHistory = false) => {
      const url = new URL(window.location.href);
      const restoredDay = parseDay(url.searchParams.get("day")) ?? 1;
      const restoredArea = url.searchParams.get("area") ?? url.searchParams.get("hall");
      const nextHall = parseArea(restoredArea);
      const restoredQuery = url.searchParams.get("query") ?? "";
      const restoredGenre = url.searchParams.get("genre");
      const restoredVisit = url.searchParams.get("visit");
      const restoredSort = url.searchParams.get("sort");
      const restoredDensity = url.searchParams.get("density");
      const restoredMedia = Number(url.searchParams.get("media"));
      const selectedCircle = url.searchParams.get("selectedCircle");
      const selectedBooth = url.searchParams.get("selectedBooth");
      const selected = resolveCircleSelection(CIRCLE_RECORDS, CIRCLE_RECORDS_BY_ID, restoredDay, selectedCircle, selectedBooth);
      if (fromHistory) suppressUrlWrite.current = true;
      setDay(restoredDay);
      setHall(nextHall);
      setQuery(restoredQuery);
      setGenre(restoredGenre && GENRES.includes(restoredGenre) ? restoredGenre : "全部類別");
      setFavoriteOnly(url.searchParams.get("favorite") === "1");
      setAdvanced({
        favoriteGroupId: url.searchParams.get("favoriteGroup") ?? "ALL",
        visitStatus: restoredVisit === "planned" || restoredVisit === "next" || restoredVisit === "visited" || restoredVisit === "not-planned" ? restoredVisit : "ALL",
        sort: restoredSort === "name" || restoredSort === "updated" ? restoredSort : "booth",
        density: restoredDensity === "compact" ? "compact" : "informative",
        mediaCount: restoredMedia === 1 || restoredMedia === 3 ? restoredMedia : 0,
      });
      setSelectedRecordId(selected?.recordId ?? null);
      setMobilePanel(selected ? "details" : "results");
      pendingRestoreCode.current = selected?.code ?? null;
    };
    queueMicrotask(() => {
      restore();
      setUrlReady(true);
    });
    const onPopState = () => restore(true);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedEventMap(FF47_EVENT_ID)
      .then((map) => { if (!cancelled) setPublishedMap(map); })
      .catch((error) => { if (!cancelled) setMapError(error instanceof Error ? error.message : "讀取活動地圖失敗。"); })
      .finally(() => { if (!cancelled) setMapLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!favoriteUndo) return;
    const timeout = window.setTimeout(() => setFavoriteUndo(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [favoriteUndo]);

  useModalFocus(showFullDetail, fullDetailRef, () => setShowFullDetail(false));

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    if (suppressUrlWrite.current) {
      suppressUrlWrite.current = false;
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("event", FF47_EVENT_ID);
    url.searchParams.set("day", String(day));
    url.searchParams.set("area", hall);
    url.searchParams.delete("hall");
    if (query.trim()) url.searchParams.set("query", query.trim()); else url.searchParams.delete("query");
    if (genre !== "全部類別") url.searchParams.set("genre", genre); else url.searchParams.delete("genre");
    if (favoriteOnly) url.searchParams.set("favorite", "1"); else url.searchParams.delete("favorite");
    if (advanced.favoriteGroupId !== "ALL") url.searchParams.set("favoriteGroup", advanced.favoriteGroupId); else url.searchParams.delete("favoriteGroup");
    if (advanced.visitStatus !== "ALL") url.searchParams.set("visit", advanced.visitStatus); else url.searchParams.delete("visit");
    if (advanced.sort !== "booth") url.searchParams.set("sort", advanced.sort); else url.searchParams.delete("sort");
    if (advanced.density !== "informative") url.searchParams.set("density", advanced.density); else url.searchParams.delete("density");
    if (advanced.mediaCount) url.searchParams.set("media", String(advanced.mediaCount)); else url.searchParams.delete("media");
    const selected = CIRCLE_RECORDS_BY_ID.get(selectedRecordId ?? "");
    if (selected) {
      url.searchParams.set("selectedCircle", selected.recordId);
      url.searchParams.set("selectedBooth", selected.code);
    } else {
      url.searchParams.delete("selectedCircle");
      url.searchParams.delete("selectedBooth");
    }
    const method = historyIntent.current === "push" ? "pushState" : "replaceState";
    window.history[method](null, "", url);
    historyIntent.current = "replace";
  }, [advanced, day, favoriteOnly, genre, hall, query, selectedRecordId, urlReady]);

  const favorites = useMemo(() => planning.favorites.filter((item) => item.eventId === FF47_EVENT_ID), [planning.favorites]);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.circleId)), [favorites]);
  const favoriteGroupLabels = useMemo(() => {
    const groups = new Map(planning.favoriteGroups.map((group) => [group.id, group.name]));
    return new Map(favorites.flatMap((favorite) => favorite.groupId && groups.has(favorite.groupId) ? [[favorite.circleId, groups.get(favorite.groupId)!] as const] : []));
  }, [favorites, planning.favoriteGroups]);
  const dayPlan = useMemo(() => planning.visitPlans.filter((item) => item.eventId === FF47_EVENT_ID && item.day === day).sort((a, b) => a.routeOrder - b.routeOrder), [day, planning.visitPlans]);
  const plansById = useMemo(() => new Map(dayPlan.map((entry) => [entry.circleId, entry])), [dayPlan]);
  const selected = CIRCLE_RECORDS_BY_ID.get(selectedRecordId ?? "") ?? null;
  const selectedFavorite = selected ? favorites.find((item) => item.circleId === selected.recordId) ?? null : null;
  const selectedPlan = selected ? plansById.get(selected.recordId) ?? null : null;
  const nextEntry = dayPlan.find((entry) => entry.status === "next") ?? null;
  const nextRecord = nextEntry ? CIRCLE_RECORDS_BY_ID.get(nextEntry.circleId) ?? null : null;
  const onsiteTargetEntry = nextEntry ?? dayPlan.find((entry) => entry.status !== "visited") ?? null;
  const onsiteTargetRecord = onsiteTargetEntry ? CIRCLE_RECORDS_BY_ID.get(onsiteTargetEntry.circleId) ?? null : null;
  const visitedCount = dayPlan.filter((entry) => entry.status === "visited").length;
  const sharedRecords = selected ? CIRCLE_RECORDS.filter((record) => record.day === selected.day && record.code === selected.code) : [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const visible = CIRCLE_RECORDS.filter((record) => {
      const favorite = favorites.find((item) => item.circleId === record.recordId);
      const plan = plansById.get(record.recordId);
      const groupMatches = advanced.favoriteGroupId === "ALL" || (advanced.favoriteGroupId === "UNGROUPED" ? !!favorite && !favorite.groupId : favorite?.groupId === advanced.favoriteGroupId);
      const visitMatches = advanced.visitStatus === "ALL" || (advanced.visitStatus === "not-planned" ? !plan : plan?.status === advanced.visitStatus);
      return record.day === day
      && (hall === "ALL" || record.hall === hall)
      && (genre === "全部類別" || record.genre === genre)
      && (!favoriteOnly || favoriteIds.has(record.recordId))
      && groupMatches && visitMatches
      && (!needle || circleSearchText(record).includes(needle));
    });
    return visible.sort((a, b) => {
      if (advanced.sort === "name") return a.name.localeCompare(b.name, "zh-Hant");
      if (advanced.sort === "updated") {
        const updated = (record: CircleViewRecord) => favorites.find((item) => item.circleId === record.recordId)?.updatedAt ?? plansById.get(record.recordId)?.updatedAt ?? record.sources[0]?.fetchedAt ?? "";
        return updated(b).localeCompare(updated(a)) || a.code.localeCompare(b.code, undefined, { numeric: true });
      }
      return a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name, "zh-Hant");
    });
  }, [advanced, day, favoriteIds, favoriteOnly, favorites, genre, hall, plansById, query]);

  const mapRecords = useMemo(() => onsiteMode
    ? dayPlan.flatMap((entry) => CIRCLE_RECORDS_BY_ID.get(entry.circleId) ?? [])
    : filtered,
  [dayPlan, filtered, onsiteMode]);

  const markers = useMemo(() => {
    const byCode = new Map<string, CircleViewRecord[]>();
    mapRecords.forEach((record) => byCode.set(record.code, [...(byCode.get(record.code) ?? []), record]));
    return [...byCode.entries()].map(([code, records]) => ({ code, records }));
  }, [mapRecords]);
  const markersByCode = useMemo(() => new Map(markers.map((marker) => [marker.code, marker])), [markers]);

  const focusCode = useCallback((code: string) => {
    if (!publishedMap || !mapRef.current) return;
    const slot = publishedMap.layout.rows.flatMap((row) => row.slots).find((item) => item.code === code);
    if (!slot) return;
    const floorHeight = 950;
    const floorScale = floorHeight / publishedMap.layout.height;
    const targetZoom = window.innerWidth <= 760 ? 1.18 : 1.02;
    const centerX = (slot.rect.x + slot.rect.width / 2) * floorScale;
    const centerY = (slot.rect.y + slot.rect.height / 2) * floorScale;
    const viewport = mapRef.current.getBoundingClientRect();
    setZoom(targetZoom);
    setOffset({ x: viewport.width / 2 - 18 - centerX * targetZoom, y: viewport.height / 2 - 18 - centerY * targetZoom });
  }, [publishedMap]);

  useEffect(() => {
    const code = pendingRestoreCode.current;
    if (!code || !publishedMap) return;
    pendingRestoreCode.current = null;
    const frame = window.requestAnimationFrame(() => focusCode(code));
    return () => window.cancelAnimationFrame(frame);
  }, [day, focusCode, publishedMap, selectedRecordId]);

  const selectRecord = useCallback((record: CircleViewRecord, panel: MobilePanel = "details", addHistory = true) => {
    if (addHistory) historyIntent.current = "push";
    setSelectedRecordId(record.recordId);
    setMobilePanel(panel);
    focusCode(record.code);
  }, [focusCode]);

  useEffect(() => {
    const key = `${day}|${hall}|${genre}|${favoriteOnly}|${query.trim()}|${filtered[0]?.recordId ?? ""}`;
    if (!query.trim() || filtered.length !== 1 || lastAutoSelection.current === key) return;
    lastAutoSelection.current = key;
    selectRecord(filtered[0], "details", false);
  }, [day, favoriteOnly, filtered, genre, hall, query, selectRecord]);

  const slots = useMemo(() => Object.fromEntries(markers.map((marker): [string, MapSlotView] => {
    const representative = marker.records[0];
    const planEntries = marker.records.flatMap((record) => plansById.get(record.recordId) ?? []);
    const favorite = marker.records.some((record) => favoriteIds.has(record.recordId));
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
    }];
  })), [day, favoriteIds, markers, plansById, selected]);

  const clearResultFilters = () => { historyIntent.current = "push"; setGenre("全部類別"); setFavoriteOnly(false); setHall("ALL"); setAdvanced(DEFAULT_ADVANCED_FILTERS); };
  const clearFilters = () => { clearResultFilters(); setQuery(""); };
  const resetMap = () => { setZoom(.8); setOffset({ x: 0, y: 0 }); };
  const stepZoom = (delta: number) => {
    const viewport = mapRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const point = { x: viewport.width / 2, y: viewport.height / 2 };
    const nextZoom = clampMapZoom(+(zoom + delta).toFixed(2));
    if (nextZoom === zoom) return;
    setOffset((current) => zoomOffsetAroundPoint(current, zoom, nextZoom, point));
    setZoom(nextZoom);
  };
  const toggleOnsiteMode = () => {
    const enabled = !onsiteMode;
    setOnsiteMode(enabled);
    if (!enabled) return;
    setHall("ALL");
    setLeftMode("plan");
    setMobilePanel(onsiteTargetRecord ? "details" : "plan");
    if (onsiteTargetRecord) selectRecord(onsiteTargetRecord, "details", false);
  };
  const toggleFavoriteSafely = (record: CircleViewRecord) => {
    const existing = favorites.find((item) => item.circleId === record.recordId);
    updatePlanning((current) => toggleFavorite(current, FF47_EVENT_ID, record.recordId));
    setFavoriteUndo(existing ? { favorite: existing, circleName: record.name } : null);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    const active = [...pointers.current.values()];
    if (active.length === 1) gesture.current = { kind: "drag", pointerId: event.pointerId, x: active[0].x, y: active[0].y, ox: offset.x, oy: offset.y };
    if (active.length === 2) {
      const center = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
      gesture.current = { kind: "pinch", distance: Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y), zoom, mapX: (center.x - offset.x) / zoom, mapY: (center.y - offset.y) / zoom };
    }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const active = [...pointers.current.values()];
    if (active.length >= 2 && gesture.current?.kind === "pinch") {
      const center = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
      const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y);
      const nextZoom = Math.max(.35, Math.min(1.8, gesture.current.zoom * distance / Math.max(1, gesture.current.distance)));
      setZoom(nextZoom);
      setOffset({ x: center.x - gesture.current.mapX * nextZoom, y: center.y - gesture.current.mapY * nextZoom });
    } else if (gesture.current?.kind === "drag" && gesture.current.pointerId === event.pointerId) {
      const point = pointers.current.get(event.pointerId)!;
      setOffset({ x: gesture.current.ox + point.x - gesture.current.x, y: gesture.current.oy + point.y - gesture.current.y });
    }
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const remaining = [...pointers.current.entries()][0];
    gesture.current = remaining ? { kind: "drag", pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, ox: offset.x, oy: offset.y } : null;
  };
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const nextZoom = clampMapZoom(+(zoom * Math.exp(-event.deltaY * .0012)).toFixed(3));
    if (nextZoom === zoom) return;
    setOffset(zoomOffsetAroundPoint(offset, zoom, nextZoom, point));
    setZoom(nextZoom);
  };
  const floorHeight = 950;
  const floorWidth = publishedMap ? floorHeight * publishedMap.layout.width / publishedMap.layout.height : 1344;
  const itineraryPanel = <DayItinerary day={day} entries={dayPlan} recordsById={CIRCLE_RECORDS_BY_ID} onSelect={selectRecord} onMove={(circleId, direction) => updatePlanning((current) => moveVisitPlanEntry(current, FF47_EVENT_ID, day, circleId, direction))} onMoveTo={(circleId, targetIndex) => updatePlanning((current) => moveVisitPlanEntryToIndex(current, FF47_EVENT_ID, day, circleId, targetIndex))} onVisit={(entry) => updatePlanning((current) => markVisited(current, FF47_EVENT_ID, day, entry.circleId, entry.status !== "visited"))} onRemove={(circleId) => updatePlanning((current) => removeFromVisitPlan(current, FF47_EVENT_ID, day, circleId))} />;
  const resultSetKey = `${day}|${hall}|${genre}|${favoriteOnly}|${advanced.favoriteGroupId}|${advanced.visitStatus}|${advanced.sort}|${advanced.density}|${query}`;
  const activeResultFilters: ActiveResultFilter[] = [
    ...(hall !== "ALL" ? [{ id: "area", label: hall === "A" ? "A–K 區" : "L–W 區", onClear: () => { historyIntent.current = "push"; setHall("ALL"); } }] : []),
    ...(genre !== "全部類別" ? [{ id: "genre", label: genre, onClear: () => { historyIntent.current = "push"; setGenre("全部類別"); } }] : []),
    ...(favoriteOnly ? [{ id: "favorite", label: "只看收藏", onClear: () => { historyIntent.current = "push"; setFavoriteOnly(false); } }] : []),
    ...(advanced.favoriteGroupId !== "ALL" ? [{ id: "favorite-group", label: advanced.favoriteGroupId === "UNGROUPED" ? "未分組收藏" : planning.favoriteGroups.find((group) => group.id === advanced.favoriteGroupId)?.name ?? "收藏群組", onClear: () => { historyIntent.current = "push"; setAdvanced((current) => ({ ...current, favoriteGroupId: "ALL" })); } }] : []),
    ...(advanced.visitStatus !== "ALL" ? [{ id: "visit", label: ({ planned: "待前往", next: "下一站", visited: "已走訪", "not-planned": "未加入行程" } as const)[advanced.visitStatus], onClear: () => { historyIntent.current = "push"; setAdvanced((current) => ({ ...current, visitStatus: "ALL" })); } }] : []),
  ];
  const resultsPanel = <SearchResults key={resultSetKey} records={filtered} selectedId={selectedRecordId} favoriteIds={favoriteIds} favoriteGroupLabels={favoriteGroupLabels} plans={plansById} density={advanced.density} query={query} activeFilters={activeResultFilters} onSelect={selectRecord} onToggleFavorite={toggleFavoriteSafely} onClearFilters={clearResultFilters} onClearQuery={() => { historyIntent.current = "push"; setQuery(""); }} />;
  const detailActions = {
    onSelectShared: selectRecord,
    onToggleFavorite: () => selected && toggleFavoriteSafely(selected),
    onTogglePlan: () => selected && updatePlanning((current) => selectedPlan ? removeFromVisitPlan(current, FF47_EVENT_ID, day, selected.recordId) : addToVisitPlan(current, FF47_EVENT_ID, day, selected.recordId)),
    onSetNext: () => selected && updatePlanning((current) => setNextStop(current, FF47_EVENT_ID, day, selected.recordId)),
    onUpdateFavorite: (groupId: string | null, memo: string) => selected && updatePlanning((current) => updateFavorite(current, FF47_EVENT_ID, selected.recordId, groupId, memo)),
    onCreateGroup: (name: string) => updatePlanning((current) => createFavoriteGroup(current, name)),
  };
  const detailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} compact onClose={() => { historyIntent.current = "push"; setSelectedRecordId(null); setShowFullDetail(false); }} onOpenFull={() => setShowFullDetail(true)} {...detailActions} />;
  const fullDetailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} onClose={() => setShowFullDetail(false)} {...detailActions} />;
  const mobileFiltersPanel = <section className={styles.mobileFilters} aria-label="攤位篩選">
    <header><div><small>FILTERS</small><b>篩選攤位</b></div><button onClick={clearFilters}>全部清除</button></header>
    <fieldset><legend>創作類別</legend><div className="genres">{GENRES.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className={`dot dot-${value}`} />{value}<small>{CIRCLE_RECORDS.filter((record) => record.day === day && (value === "全部類別" || record.genre === value)).length}</small></button>)}</div></fieldset>
    <label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個社團</small></span></label>
    <DisplayFilterControls value={advanced} groups={planning.favoriteGroups} onApply={(next) => { historyIntent.current = "push"; setAdvanced(next); }} />
  </section>;

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span aria-hidden="true">場</span><div><b>場刊 MAP</b><small>同人展逛攤地圖</small></div></div><div className="event"><i>活動</i><div><b>{FF47_EVENT.name}</b><small>{FF47_EVENT.dateRangeLabel} · {FF47_EVENT.venue}</small></div></div><label className="search"><span aria-hidden="true"><UiIcon name="search" /></span><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setLeftMode("search"); setMobilePanel("results"); }} placeholder="搜尋社團、攤位或作品" aria-label="搜尋社團、攤位或作品" /><kbd>⌘ K</kbd></label><button className="help" onClick={() => setShowAdmin(true)}>管理</button></header>
    <section className="toolbar" aria-label="日期與場館篩選"><div className="days">{FF47_EVENT.days.map((eventDay) => <button key={eventDay.id} className={day === eventDay.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setDay(eventDay.id); setSelectedRecordId(null); }}><b>{eventDay.label}</b><span>{eventDay.dateLabel}</span></button>)}</div><div className="mobile-halls">{FF47_EVENT.areas.map((area) => <button key={area.id} className={hall === area.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setHall(area.id); }}>{area.label}</button>)}</div><div className="open-hours" role="status"><span />本機行程 · {planningStorageError ? "儲存異常，請開啟規劃資料" : planningReady ? "自動保存" : "讀取中"}</div><button className={`${styles.onsiteToggle} ${onsiteMode ? styles.onsiteToggleActive : ""}`} aria-pressed={onsiteMode} onClick={toggleOnsiteMode}><UiIcon name="locate" />{onsiteMode ? "退出展場模式" : "展場模式"}</button></section>
    <div className={`workspace ${styles.workspace}`}>
      <aside className={`filters ${styles.leftRail}`}>
        <div className={styles.modeTabs} role="tablist" aria-label="規劃工具"><button role="tab" aria-selected={leftMode === "search"} onClick={() => setLeftMode("search")}>搜尋</button><button role="tab" aria-selected={leftMode === "plan"} onClick={() => setLeftMode("plan")}>行程 <span>{dayPlan.length}</span></button></div>
        {leftMode === "search" ? <><div className={styles.filterStack}><div className="filter-title"><b>篩選攤位</b><button onClick={clearFilters}>全部清除</button></div><fieldset><legend>展區</legend><div className="segments">{FF47_EVENT.areas.map((area) => <button key={area.id} className={hall === area.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setHall(area.id); }}>{area.shortLabel}</button>)}</div></fieldset><fieldset><legend>創作類別</legend><div className="genres">{GENRES.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className={`dot dot-${value}`} />{value}<small>{CIRCLE_RECORDS.filter((record) => record.day === day && (value === "全部類別" || record.genre === value)).length}</small></button>)}</div></fieldset><label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個社團</small></span></label></div><DisplayFilterControls value={advanced} groups={planning.favoriteGroups} onApply={(next) => { historyIntent.current = "push"; setAdvanced(next); }} />{resultsPanel}</> : itineraryPanel}
      </aside>
      <section className="map-region" aria-label="攤位地圖">
        <div className="map-title"><div><small>VECTOR FLOOR MAP</small><h1>{FF47_EVENT.venue} <em>{FF47_EVENT.areas.find((area) => area.id === hall)?.label}</em></h1></div><div className={styles.mapMeta}><p><b>{mapRecords.length}</b> {onsiteMode ? "個行程攤位" : "個符合條件的社團"}</p><button onClick={() => setShowAdmin(true)}>管理地圖</button></div></div>
        {onsiteMode && <div className={styles.onsiteBanner} role="status"><span><UiIcon name="locate" /></span><div><b>展場模式 · 地圖只顯示 DAY {day} 行程</b><small>已走訪 {visitedCount} 站 · 剩餘 {Math.max(0, dayPlan.length - visitedCount)} 站{onsiteTargetRecord ? ` · 目前目標 ${onsiteTargetRecord.code}` : ""}</small></div><button onClick={toggleOnsiteMode}>退出</button></div>}
        {publishedMap && <div className={styles.layoutStatus} role="status"><span><UiIcon name="check" /></span><div><b>活動地圖已發布</b><small>revision {publishedMap.revision} · {publishedMap.sourceName}</small></div><button onClick={() => setShowAdmin(true)}>更新</button></div>}
        {nextRecord && !onsiteMode && <div className="route"><span><UiIcon name="external" /></span><button className={styles.routeMain} onClick={() => selectRecord(nextRecord)}><small>下一站</small><b>{nextRecord.code} · {nextRecord.name}</b></button><button onClick={() => updatePlanning((current) => removeFromVisitPlan(current, FF47_EVENT_ID, day, nextRecord.recordId))} aria-label="從行程移除下一站"><UiIcon name="close" /></button></div>}
        <div ref={mapRef} className="map" onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
          {publishedMap ? <div className={`floor ${styles.vectorFloor}`} style={{ width: `${floorWidth}px`, height: `${floorHeight}px`, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}><AccessibleEventMapRenderer eventName={FF47_EVENT.name} layout={publishedMap.layout} slots={slots} onSelect={(code) => { const marker = markersByCode.get(code); if (marker) selectRecord(marker.records[0]); }} /></div> : <div className={styles.mapState}><b>{mapLoading ? "正在讀取活動地圖…" : mapError ? "活動地圖讀取失敗" : "此活動尚未發布地圖"}</b><span className={mapError ? styles.mapError : ""}>{mapError || (mapLoading ? "請稍候" : "請由管理介面匯入 FF47 配置圖；發布後所有使用者會看到同一張地圖。")}</span>{!mapLoading && <button onClick={() => setShowAdmin(true)}>開啟管理地圖</button>}</div>}
          <div className="controls" aria-label="地圖縮放控制"><button type="button" onClick={() => stepZoom(.1)} aria-label="放大地圖"><UiIcon name="plus" /></button><span aria-live="polite">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => stepZoom(-.1)} aria-label="縮小地圖"><UiIcon name="minus" /></button><button type="button" onClick={resetMap} aria-label="重設地圖位置"><UiIcon name="locate" /></button></div><div className="compass"><small>N</small><UiIcon name="north" /></div>
        </div>
      </section>
      <aside className={styles.rightRail}><div className={styles.detailSlot}>{detailsPanel}</div><div className={styles.planSlot}>{itineraryPanel}</div></aside>
      <aside className={styles.mobileDock} aria-label="行動版工作面板"><div className={styles.mobileTabs} role="tablist" aria-label="行動版工作區"><button role="tab" aria-selected={mobilePanel === "filters"} onClick={() => setMobilePanel("filters")}>篩選</button><button role="tab" aria-selected={mobilePanel === "results"} onClick={() => setMobilePanel("results")}>結果 <span>{filtered.length}</span></button><button role="tab" aria-selected={mobilePanel === "details"} onClick={() => setMobilePanel("details")} disabled={!selected}>詳情</button><button role="tab" aria-selected={mobilePanel === "plan"} onClick={() => setMobilePanel("plan")}>行程 <span>{dayPlan.length}</span></button></div><div className={styles.mobilePanel}>{mobilePanel === "filters" ? mobileFiltersPanel : mobilePanel === "results" ? resultsPanel : mobilePanel === "details" ? detailsPanel : itineraryPanel}</div></aside>
    </div>
    {favoriteUndo && <div className={styles.undoToast} role="status"><span>已取消收藏「{favoriteUndo.circleName}」</span><button onClick={() => { updatePlanning((current) => restoreFavorite(current, favoriteUndo.favorite)); setFavoriteUndo(null); }}>復原收藏</button><button onClick={() => setFavoriteUndo(null)} aria-label="關閉收藏復原提示"><UiIcon name="close" /></button></div>}
    {showFullDetail && selected && <div className={styles.fullDetailBackdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setShowFullDetail(false); }}><div ref={fullDetailRef} className={styles.fullDetailDialog} role="dialog" aria-modal="true" aria-label={`${selected.name} 完整詳情`} tabIndex={-1}>{fullDetailsPanel}</div></div>}
    {showAdmin && <MapAdminImporter eventId={FF47_EVENT_ID} onPublished={(map) => { setPublishedMap(map); setMapError(""); setMapLoading(false); setShowAdmin(false); resetMap(); }} onClose={() => setShowAdmin(false)} />}
  </main>;
}
