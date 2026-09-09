"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent } from "react";
import { createPortal } from "react-dom";
import { useMapViewport } from "./use-map-viewport";
import AccessibleEventMapRenderer from "./accessible-event-map-renderer";
import { loadStaticEventMapResource } from "./static-event-map-client";
import type { PublishedEventMap } from "./event-map";
import { resolveCircleIdAliases, type CircleViewRecord } from "./circle-records";
import { useCircleCatalog } from "./use-circle-catalog";
import { CircleDetails, DayItinerary, SearchResults, type ActiveResultFilter } from "./event-workspace-panels";
import AdvancedCircleSearchControls from "./advanced-circle-search";
import {
  DEFAULT_ADVANCED_CIRCLE_SEARCH,
  advancedCircleSearchCount,
  type AdvancedCircleSearch,
} from "./circle-search";
import PlanningDisplayControls, { DEFAULT_PLANNING_DISPLAY_FILTERS, type PlanningDisplayFilters } from "./display-filter-controls";
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
  updateVisitPlanPurchase,
  type FavoriteRecord,
} from "./planning-store";
import { usePlanning } from "./use-planning";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import { resolveCircleSelection } from "./map-view-state";
import { calculatePinchMapView, clampMapZoom, mapViewFromWheel, shouldShowMapMedia, zoomOffsetAroundPoint, type MapPinchOrigin } from "./map-viewport";
import { eventUsesAreaSwitcher, eventUsesScopedMaps, venueAssignmentForArea, type EventAreaDefinition, type EventDayDefinition, type EventDefinition } from "./event-catalog";
import { defaultEventUrlState, historyMethod, parseEventUrlState, serializeEventUrlState, shouldWriteEventUrl, type PendingCircleSelection } from "./event-url-state";
import { projectEventWorkspace } from "./event-workspace-projection";
import PlanningTools from "./planning-tools";
import ReaderHelp from "./reader-help";
import styles from "./event-map-app.module.css";

type Hall = EventAreaDefinition["id"];
type EventDay = EventDayDefinition["id"];
type MobilePanel = "filters" | "results" | "details" | "plan";
type MobileSheetLevel = "peek" | "half" | "full";
type TextScale = "standard" | "large" | "extra";

const TEXT_SCALE_STORAGE_KEY = "event-map-text-scale";
const LEGACY_TEXT_SCALE_STORAGE_KEY = "ff47-event-map-text-scale";
const CATEGORY_DOT_COLORS = ["var(--mint)", "var(--lilac)", "var(--blue)", "var(--amber)", "#4ba9a0", "var(--coral)"] as const;

/** Presentation cycles through a fixed semantic palette; category labels stay
 * in event data and are never turned into CSS selectors. Text remains the
 * authority because colors repeat when an organizer publishes many options. */
function categoryDotStyle(genres: readonly string[], category: string) {
  const index = genres.indexOf(category) - 1;
  return index < 0 ? undefined : { background: CATEGORY_DOT_COLORS[index % CATEGORY_DOT_COLORS.length] };
}
type MapGesture =
  | { kind: "drag"; pointerId: number; x: number; y: number; ox: number; oy: number }
  | ({ kind: "pinch" } & MapPinchOrigin);

/**
 * Renders one event. The caller remounts on a different event (`key={event.id}`)
 * rather than resetting state field by field: every `useState` below seeds from
 * this event's defaults, and a stale day or area from the previous event would
 * be indistinguishable from a deliberate choice.
 */
export default function EventMapApp({ event }: { event: EventDefinition }) {
  const eventId = event.id;
  const genres: readonly string[] = event.genres;
  const urlDefaults = defaultEventUrlState(event);
  const showAreaSwitcher = eventUsesAreaSwitcher(event);
  const { catalog, status: catalogStatus, error: catalogError } = useCircleCatalog(eventId);
  const { records: circleRecords, recordsById: circleRecordsById, recordsByCircleId: circleRecordsByCircleId } = catalog;
  const catalogReady = catalogStatus === "ready";
  const [day, setDay] = useState<EventDay>(urlDefaults.day);
  const [hall, setHall] = useState<Hall>(urlDefaults.area);
  const [genre, setGenre] = useState<string>(event.genres[0]);
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [advancedSearch, setAdvancedSearch] = useState<AdvancedCircleSearch>(DEFAULT_ADVANCED_CIRCLE_SEARCH);
  const [planningDisplay, setPlanningDisplay] = useState<PlanningDisplayFilters>(DEFAULT_PLANNING_DISPLAY_FILTERS);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("results");
  const [mobileSheetLevel, setMobileSheetLevel] = useState<MobileSheetLevel>("peek");
  const [mobileSheetDragHeight, setMobileSheetDragHeight] = useState<number | null>(null);
  const [mobileSheetDragging, setMobileSheetDragging] = useState(false);
  const [navigationMode, setNavigationMode] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [desktopPanel, setDesktopPanel] = useState<"explore" | "plan">("explore");
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(false);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  // A multi-space event serves one map per day × venue-space, so a map is only
  // the current map while its scope still matches the chosen day and hall. The
  // loaded scope travels with the map and the render reads the pair: switching
  // scope falls back to the loading state instead of leaving the previous
  // floor on screen, which would otherwise pair the old geometry with the new
  // day's booth data and place — or let a reader select — booths at the wrong
  // coordinates until the fetch lands.
  const [loadedMap, setLoadedMap] = useState<{ scopeKey: string; artifactKey: string; map: PublishedEventMap } | null>(null);
  const mapScopeKey = eventUsesScopedMaps(event)
    ? `${String(day)}\0${venueAssignmentForArea(event, hall).venueSpaceId}`
    : eventId;
  const publishedMap = loadedMap?.scopeKey === mapScopeKey ? loadedMap.map : null;
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [textScale, setTextScale] = useState<TextScale>("standard");
  const [favoriteUndo, setFavoriteUndo] = useState<{ favorite: FavoriteRecord; circleName: string } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const { document: planning, ready: planningReady, update: updatePlanning, storageError: planningStorageError } = usePlanning(eventId, catalogStatus !== "loading");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const floorRef = useRef<HTMLDivElement | null>(null);
  const fullDetailRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<MapGesture | null>(null);
  const mapGestureFrame = useRef<number | null>(null);
  const mobileSheetGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const mobileSheetWasDragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const fitToolsRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);
  const desktopTabRef = useRef<HTMLButtonElement | null>(null);
  const planPanelRef = useRef<HTMLDivElement | null>(null);
  const selectionSource = useRef<Element | null>(null);
  const restoreInterrupted = useRef(false);
  const historyIntent = useRef<"replace" | "push">("replace");
  const suppressUrlWrite = useRef(false);
  const lastAutoSelection = useRef("");
  const pendingRestoreCode = useRef<string | null>(null);
  const pendingSelection = useRef<PendingCircleSelection<EventDay> | null>(null);
  const viewport = useMapViewport({
    elements: { map: mapRef, floor: floorRef, tools: toolsRef, fitTools: fitToolsRef, controls: controlsRef, details: detailsRef },
    publishedMap, scope: mapScopeKey, artifactKey: publishedMap ? loadedMap!.artifactKey : null, desktop, detailsOpen: desktopDetailsOpen,
  });
  const { view: mapView, viewRef: mapViewRef, setView: setMapView, minimum: mapMinZoom, floorHeight, floorWidth, getInset: getFloorInset, position: focusCode, cancelPosition } = viewport;
  const { zoom, offset } = mapView;
  const interruptPosition = useCallback(() => { restoreInterrupted.current = true; cancelPosition(); }, [cancelPosition]);
  const previousDesktop = useRef<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px)");
    const update = () => {
      if (previousDesktop.current === media.matches) return;
      setDesktop(media.matches);
      if (media.matches) setDesktopDetailsOpen(Boolean(selectedRecordId));
      else if (previousDesktop.current !== null) {
        setMobilePanel(selectedRecordId ? "details" : desktopPanel === "plan" ? "plan" : "results");
        if (selectedRecordId) setMobileSheetLevel("half");
      }
      previousDesktop.current = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [desktopPanel, selectedRecordId]);
  useEffect(() => {
    planPanelRef.current?.querySelectorAll<HTMLElement>("*").forEach((node) => { if (node.scrollTop) node.scrollTop = 0; });
  }, [day]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_TEXT_SCALE_STORAGE_KEY);
      if (stored === "standard" || stored === "large" || stored === "extra") queueMicrotask(() => setTextScale(stored));
    } catch {
      // Font scaling remains available for this session when storage is blocked.
    }
  }, []);

  const changeTextScale = (next: TextScale) => {
    setTextScale(next);
    try { window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, next); } catch { /* Keep the in-memory preference. */ }
  };

  useEffect(() => () => {
    if (mapGestureFrame.current !== null) cancelAnimationFrame(mapGestureFrame.current);
  }, []);

  useEffect(() => {
    const restore = (fromHistory = false) => {
      const { state } = parseEventUrlState(event, window.location.href);
      // The catalog snapshot may still be in flight. Filters restore now; the
      // shared circle/booth selection is resolved once records are available.
      pendingSelection.current = state.selection;
      if (fromHistory) restoreInterrupted.current = false;
      cancelPosition();
      setRestoreVersion((current) => current + 1);
      if (fromHistory) suppressUrlWrite.current = true;
      setDay(state.day);
      setHall(state.area);
      setQuery(state.query);
      setGenre(state.genre);
      setFavoriteOnly(state.favoriteOnly);
      setAdvancedSearch(state.advancedSearch);
      setPlanningDisplay(state.planningDisplay);
    };
    queueMicrotask(() => {
      restore();
      setUrlReady(true);
    });
    const onPopState = () => restore(true);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [cancelPosition, event]);

  // Apply a shareable circle/booth link as soon as the catalog can resolve it,
  // whether it arrives before or after the snapshot download completes.
  useEffect(() => {
    const pending = pendingSelection.current;
    if (!pending || !catalogReady) return;
    pendingSelection.current = null;
    const selected = resolveCircleSelection(
      circleRecords, circleRecordsById, pending.day, pending.circleId, pending.boothCode,
      (circleId) => resolveCircleIdAliases(circleId, eventId),
    );
    setSelectedRecordId(selected?.recordId ?? null);
    setMobilePanel(selected ? "details" : "results");
    setMobileSheetLevel(selected ? "half" : "peek");
    setDesktopDetailsOpen(Boolean(selected));
    pendingRestoreCode.current = !restoreInterrupted.current ? selected?.code ?? null : null;
  }, [catalogReady, circleRecords, circleRecordsById, eventId, restoreVersion]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) { setMapLoading(true); setMapError(""); }
    });
    const scope = eventUsesScopedMaps(event)
      ? { periodKey: String(day), venueSpaceId: venueAssignmentForArea(event, hall).venueSpaceId }
      : undefined;
    const scopeKey = mapScopeKey;
    void loadStaticEventMapResource(eventId, scope)
      .then((resource) => { if (!cancelled) setLoadedMap({ scopeKey, ...resource }); })
      .catch((error) => { if (!cancelled) { setLoadedMap(null); setMapError(error instanceof Error ? error.message : "讀取活動地圖失敗。"); } })
      .finally(() => { if (!cancelled) setMapLoading(false); });
    return () => { cancelled = true; };
  }, [day, event, eventId, hall, mapScopeKey, mapRetry]);

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
    const map = mapRef.current;
    if (!map) return;

    const preventMapTextSelection = (event: Event) => event.preventDefault();
    map.addEventListener("selectstart", preventMapTextSelection);
    return () => map.removeEventListener("selectstart", preventMapTextSelection);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("button, input, select, aside, [data-map-tools]")) return;
      event.preventDefault();
      interruptPosition();
      const rect = map.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const inset = getFloorInset();
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rect.height : 1;
      const delta = { x: event.deltaX * multiplier, y: event.deltaY * multiplier };
      const mobileScroll = window.matchMedia("(max-width: 760px)").matches && !event.ctrlKey;
      setMapView((current) => mapViewFromWheel(current, delta, point, mapMinZoom, mobileScroll ? "pan" : "zoom", inset));
    };

    map.addEventListener("wheel", handleWheel, { passive: false });
    return () => map.removeEventListener("wheel", handleWheel);
  }, [getFloorInset, interruptPosition, mapMinZoom, setMapView]);

  useEffect(() => {
    // Hold the URL untouched while the catalog snapshot is still downloading, so
    // a shared circle link is never rewritten away before it can be resolved.
    if (!urlReady || catalogStatus === "loading") return;
    if (!shouldWriteEventUrl({ urlReady, catalogStatus, restoringFromPopstate: suppressUrlWrite.current })) {
      suppressUrlWrite.current = false;
      return;
    }
    const selected = circleRecordsById.get(selectedRecordId ?? "");
    const url = serializeEventUrlState(event, {
      eventId: event.id, day, area: hall, venueSpaceId: venueAssignmentForArea(event, hall).venueSpaceId,
      query, genre, favoriteOnly, advancedSearch, planningDisplay,
      selection: { day, circleId: selected?.circle.id ?? null, boothCode: selected?.code ?? null },
    }, window.location.href);
    const method = historyMethod(historyIntent.current, false);
    if (method === "none") return;
    window.history[method](null, "", url);
    historyIntent.current = "replace";
  }, [advancedSearch, catalogStatus, circleRecordsById, day, event, favoriteOnly, genre, hall, planningDisplay, query, selectedRecordId, urlReady]);

  const workspace = useMemo(() => projectEventWorkspace({
    event: event,
    records: circleRecords,
    recordsById: circleRecordsById,
    recordsByCircleId: circleRecordsByCircleId,
    planning,
    day,
    area: hall,
    genre,
    query,
    favoriteOnly,
    advancedSearch,
    planningDisplay,
    navigationMode,
    selectedRecordId,
  }), [advancedSearch, circleRecords, circleRecordsByCircleId, circleRecordsById, day, event, favoriteOnly, genre, hall, navigationMode, planning, planningDisplay, query, selectedRecordId]);
  const {
    favorites, favoriteIds, favoriteGroupLabels, dayPlan, plansById, dayRecordsByCircleId,
    selected, selectedFavorite, selectedPlan, selectedMovedDestination, nextRecord, navigationTargetRecord,
    visitedCount, sharedRecords, filtered, workTopicSuggestions, matchReasonsByRecordId, genreCounts, markersByCode, slots,
    activeFilterDescriptors,
  } = workspace;

  useEffect(() => {
    const code = pendingRestoreCode.current;
    if (!code || !publishedMap) return;
    pendingRestoreCode.current = null;
    const frame = window.requestAnimationFrame(() => { if (!restoreInterrupted.current) focusCode(code); });
    return () => window.cancelAnimationFrame(frame);
  }, [day, focusCode, publishedMap, selectedRecordId]);

  const selectRecord = useCallback((record: CircleViewRecord, panel: MobilePanel = "details", addHistory = true) => {
    if (addHistory) historyIntent.current = "push";
    selectionSource.current = document.activeElement;
    setDesktopDetailsOpen(true);
    setSelectedRecordId(record.recordId);
    setMobilePanel(panel);
    setMobileSheetLevel("half");
    const destination = venueAssignmentForArea(event, record.hall);
    if (record.day !== day) setDay(record.day);
    if (destination.venueSpaceId !== venueAssignmentForArea(event, hall).venueSpaceId) setHall(record.hall);
    const destinationScope = eventUsesScopedMaps(event) ? `${String(record.day)}\u0000${destination.venueSpaceId}` : eventId;
    focusCode(record.code, destinationScope);
  }, [day, event, eventId, focusCode, hall, setDay, setHall, setDesktopDetailsOpen, setSelectedRecordId, setMobilePanel, setMobileSheetLevel]);

  useEffect(() => {
    const key = `${day}|${hall}|${genre}|${favoriteOnly}|${query.trim()}|${filtered[0]?.recordId ?? ""}`;
    if (!query.trim() || filtered.length !== 1 || lastAutoSelection.current === key) return;
    lastAutoSelection.current = key;
    selectRecord(filtered[0], "details", false);
  }, [day, favoriteOnly, filtered, genre, hall, query, selectRecord]);

  const changeArea = (next: Hall) => {
    historyIntent.current = "push";
    cancelPosition();
    pendingSelection.current = null;
    pendingRestoreCode.current = null;
    setHall(next);
    setSelectedRecordId(null);
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
  };
  const resetAreaFilter = () => {
    if (venueAssignmentForArea(event, hall).venueSpaceId !== venueAssignmentForArea(event, urlDefaults.area).venueSpaceId) changeArea(urlDefaults.area);
    else setHall(urlDefaults.area);
  };
  const clearResultFilters = () => { historyIntent.current = "push"; setGenre(urlDefaults.genre); setFavoriteOnly(false); resetAreaFilter(); setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); setPlanningDisplay(DEFAULT_PLANNING_DISPLAY_FILTERS); };
  const clearFilters = () => { clearResultFilters(); setQuery(""); };
  const resetAdvancedSearch = () => { historyIntent.current = "push"; setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); };
  const resetMap = () => {
    interruptPosition();
    if (desktop) setDesktopDetailsOpen(false);
    viewport.reset();
  };
  const closeDetails = () => {
    if (!desktop) { historyIntent.current = "push"; setSelectedRecordId(null); }
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
    cancelPosition();
    if (desktop) requestAnimationFrame(() => {
      const source = selectionSource.current;
      if ((source instanceof HTMLElement || source instanceof SVGElement) && source.isConnected && source.getClientRects().length) source.focus({ preventScroll: true });
      else (mapRef.current?.querySelector<SVGElement>('svg [data-slot-code][tabindex="0"]') ?? desktopTabRef.current)?.focus({ preventScroll: true });
    });
  };
  const stepZoom = (delta: number) => {
    interruptPosition();
    const viewport = mapRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const point = { x: viewport.width / 2, y: viewport.height / 2 };
    setMapView((current) => {
      const buttonStep = current.zoom >= 2 ? .25 : .1;
      const nextZoom = clampMapZoom(+(current.zoom + Math.sign(delta) * buttonStep).toFixed(2), mapMinZoom);
      if (nextZoom === current.zoom) return current;
      return { zoom: nextZoom, offset: zoomOffsetAroundPoint(current.offset, current.zoom, nextZoom, point, getFloorInset()) };
    });
  };
  const toggleNavigationMode = () => {
    const enabled = !navigationMode;
    setNavigationMode(enabled);
    if (!enabled) return;
    setDesktopPanel("plan");
    setMobilePanel(navigationTargetRecord ? "details" : "plan");
    setMobileSheetLevel("half");
    if (navigationTargetRecord && venueAssignmentForArea(event, navigationTargetRecord.hall).venueSpaceId === venueAssignmentForArea(event, hall).venueSpaceId) selectRecord(navigationTargetRecord, "details", false);
  };
  const selectMobilePanel = (panel: MobilePanel) => {
    if (mobilePanel === panel && mobileSheetLevel !== "peek") {
      setMobileSheetLevel("peek");
      return;
    }
    setMobilePanel(panel);
    setMobileSheetLevel("half");
  };
  const mobileSheetSnapPoints = () => {
    const viewportHeight = window.innerHeight;
    return [
      { level: "peek" as const, height: 92 },
      { level: "half" as const, height: Math.min(viewportHeight * .44, 420) },
      { level: "full" as const, height: Math.min(viewportHeight * .82, 760) },
    ];
  };
  const handleMobileSheetPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    mobileSheetWasDragged.current = false;
    const startHeight = mobileSheetSnapPoints().find((point) => point.level === mobileSheetLevel)?.height ?? 92;
    mobileSheetGesture.current = { pointerId: event.pointerId, startY: event.clientY, startHeight };
    setMobileSheetDragging(true);
  };
  const handleMobileSheetPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = mobileSheetGesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(current.startY - event.clientY) > 4) mobileSheetWasDragged.current = true;
    const maximum = Math.min(window.innerHeight * .84, 780);
    setMobileSheetDragHeight(Math.max(92, Math.min(maximum, current.startHeight + current.startY - event.clientY)));
  };
  const handleMobileSheetPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = mobileSheetGesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const height = mobileSheetDragHeight ?? current.startHeight;
    const nearest = mobileSheetSnapPoints().reduce((best, point) => Math.abs(point.height - height) < Math.abs(best.height - height) ? point : best);
    mobileSheetGesture.current = null;
    setMobileSheetLevel(nearest.level);
    setMobileSheetDragHeight(null);
    setMobileSheetDragging(false);
  };
  const toggleMobileSheetLevel = () => {
    if (mobileSheetWasDragged.current) {
      mobileSheetWasDragged.current = false;
      return;
    }
    setMobileSheetLevel((current) => current === "peek" ? "half" : current === "half" ? "full" : "half");
  };
  const toggleFavoriteSafely = (record: CircleViewRecord) => {
    const existing = favorites.find((item) => item.circleId === record.circle.id);
    updatePlanning((current) => toggleFavorite(current, eventId, record.circle.id));
    setFavoriteUndo(existing ? { favorite: existing, circleName: record.name } : null);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button, input, select, aside, [data-map-tools]")) return;
    interruptPosition();
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    setMapGestureActive(true);
    const active = [...pointers.current.values()];
    const currentView = mapViewRef.current;
    const inset = getFloorInset();
    if (active.length === 1) gesture.current = { kind: "drag", pointerId: event.pointerId, x: active[0].x, y: active[0].y, ox: currentView.offset.x, oy: currentView.offset.y };
    if (active.length === 2) {
      const center = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
      gesture.current = { kind: "pinch", distance: Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y), zoom: currentView.zoom, mapX: (center.x - inset.x - currentView.offset.x) / currentView.zoom, mapY: (center.y - inset.y - currentView.offset.y) / currentView.zoom, center, inset };
    }
  };
  const applyMapGesture = () => {
    const active = [...pointers.current.values()];
    if (active.length >= 2 && gesture.current?.kind === "pinch") {
      const center = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
      const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y);
      const view = calculatePinchMapView(gesture.current, distance, center, mapMinZoom);
      gesture.current.boundaryCenter = view.boundaryCenter;
      setMapView({ zoom: view.zoom, offset: view.offset });
      return view.offset;
    } else if (gesture.current?.kind === "drag") {
      const point = pointers.current.get(gesture.current.pointerId);
      if (point) {
        const nextOffset = { x: gesture.current.ox + point.x - gesture.current.x, y: gesture.current.oy + point.y - gesture.current.y };
        setMapView((current) => ({ ...current, offset: nextOffset }));
        return nextOffset;
      }
    }
    return null;
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (mapGestureFrame.current !== null) return;
    mapGestureFrame.current = requestAnimationFrame(() => {
      mapGestureFrame.current = null;
      applyMapGesture();
    });
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    let finalOffset: { x: number; y: number } | null = null;
    if (mapGestureFrame.current !== null) {
      cancelAnimationFrame(mapGestureFrame.current);
      mapGestureFrame.current = null;
      finalOffset = applyMapGesture();
    }
    pointers.current.delete(event.pointerId);
    const remaining = [...pointers.current.entries()][0];
    const currentView = mapViewRef.current;
    const endOffset = finalOffset ?? currentView.offset;
    gesture.current = remaining ? { kind: "drag", pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, ox: endOffset.x, oy: endOffset.y } : null;
    if (!remaining) setMapGestureActive(false);
  };
  const itineraryProps = {
    day,
    entries: dayPlan,
    recordsById: dayRecordsByCircleId,
    onSelect: selectRecord,
    onMove: (circleId: string, direction: -1 | 1) => updatePlanning((current) => moveVisitPlanEntry(current, eventId, day, circleId, direction)),
    onMoveTo: (circleId: string, targetIndex: number) => updatePlanning((current) => moveVisitPlanEntryToIndex(current, eventId, day, circleId, targetIndex)),
    onVisit: (entry: (typeof dayPlan)[number]) => updatePlanning((current) => markVisited(current, eventId, day, entry.circleId, entry.status !== "visited")),
    onRemove: (circleId: string) => updatePlanning((current) => removeFromVisitPlan(current, eventId, day, circleId)),
    onUpdatePurchase: (circleId: string, purchaseMemo: string, budget: number | null) => updatePlanning((current) => updateVisitPlanPurchase(current, eventId, day, circleId, purchaseMemo, budget)),
  };
  const fullItineraryPanel = <DayItinerary {...itineraryProps} variant="full" />;
  const planningControls = <PlanningDisplayControls value={planningDisplay} groups={planning.favoriteGroups} onApply={(next) => { historyIntent.current = "push"; setPlanningDisplay(next); }} />;
  const planningPanel = <div className={styles.planningPanel}>{planningControls}{fullItineraryPanel}</div>;
  const resultSetKey = `${day}|${hall}|${genre}|${favoriteOnly}|${advancedSearch.creatorType}|${advancedSearch.workTopics.join(",")}|${advancedSearch.workTopicMode}|${advancedSearch.excludedWorkTopics.join(",")}|${advancedSearch.workType}|${advancedSearch.adultContent}|${planningDisplay.favoriteGroupId}|${planningDisplay.visitStatus}|${planningDisplay.sort}|${planningDisplay.density}|${planningDisplay.mediaCount}|${query}`;
  const activeResultFilters: ActiveResultFilter[] = activeFilterDescriptors.map((filter) => ({
    ...filter,
    onClear: () => {
      historyIntent.current = "push";
      if (filter.kind === "area") resetAreaFilter();
      if (filter.kind === "genre") setGenre(event.genres[0]);
      if (filter.kind === "favorite") setFavoriteOnly(false);
      if (filter.kind === "creator") setAdvancedSearch((current) => ({ ...current, creatorType: "ALL" }));
      if (filter.kind === "work") setAdvancedSearch((current) => ({ ...current, workTopics: current.workTopics.filter((topic) => topic !== filter.value) }));
      if (filter.kind === "work-exclude") setAdvancedSearch((current) => ({ ...current, excludedWorkTopics: current.excludedWorkTopics.filter((topic) => topic !== filter.value) }));
      if (filter.kind === "work-type") setAdvancedSearch((current) => ({ ...current, workType: "ALL" }));
      if (filter.kind === "adult") setAdvancedSearch((current) => ({ ...current, adultContent: "ALL" }));
      if (filter.kind === "favorite-group") setPlanningDisplay((current) => ({ ...current, favoriteGroupId: "ALL" }));
      if (filter.kind === "visit") setPlanningDisplay((current) => ({ ...current, visitStatus: "ALL" }));
    },
  }));
  const resultsPanel = <SearchResults key={resultSetKey} records={filtered} catalogStatus={catalogStatus} catalogError={catalogError} selectedId={selectedRecordId} favoriteIds={favoriteIds} favoriteGroupLabels={favoriteGroupLabels} plans={plansById} density={planningDisplay.density} mediaCount={planningDisplay.mediaCount} query={query} activeFilters={activeResultFilters} matchReasons={matchReasonsByRecordId} advancedSearchActive={advancedCircleSearchCount(advancedSearch) > 0} onSelect={selectRecord} onToggleFavorite={toggleFavoriteSafely} onResetAdvancedSearch={resetAdvancedSearch} onClearFilters={clearResultFilters} onClearQuery={() => { historyIntent.current = "push"; setQuery(""); }} />;
  const detailActions = {
    onSelectShared: selectRecord,
    onToggleFavorite: () => selected && toggleFavoriteSafely(selected),
    onTogglePlan: () => selected && updatePlanning((current) => selectedPlan ? removeFromVisitPlan(current, eventId, day, selected.circle.id) : addToVisitPlan(current, eventId, day, selected.circle.id)),
    onSetNext: () => selected && updatePlanning((current) => setNextStop(current, eventId, day, selected.circle.id)),
    onUpdateFavorite: (groupId: string | null, memo: string) => selected && updatePlanning((current) => updateFavorite(current, eventId, selected.circle.id, groupId, memo)),
    onCreateGroup: (name: string) => updatePlanning((current) => createFavoriteGroup(current, name)),
  };
  const detailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} movedDestination={selectedMovedDestination} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} compact onClose={closeDetails} onOpenFull={() => setShowFullDetail(true)} {...detailActions} />;
  const fullDetailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} movedDestination={selectedMovedDestination} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} onClose={() => setShowFullDetail(false)} {...detailActions} />;
  const clearFiltersClassName = `${styles.clearFilters} ${genre !== event.genres[0] ? styles.clearFiltersActive : ""}`;
  const mobileFiltersPanel = <section className={styles.mobileFilters} aria-label="攤位篩選">
    <header><div><b>篩選攤位</b></div><button className={clearFiltersClassName} onClick={clearFilters}>全部清除</button></header>
    <fieldset><legend>社團主題</legend><div className="genres">{genres.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className="dot" style={categoryDotStyle(genres, value)} />{value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset>
    <label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個社團</small></span></label>
    <AdvancedCircleSearchControls value={advancedSearch} workSuggestions={workTopicSuggestions} onApply={(next) => { historyIntent.current = "push"; setAdvancedSearch(next); }} />
  </section>;
  const mobileDockStyle = mobileSheetDragHeight === null ? undefined : { "--mobile-sheet-height": `${mobileSheetDragHeight}px` } as CSSProperties;
  const mobileSheetActionLabel = mobileSheetLevel === "peek" ? "展開工作面板" : mobileSheetLevel === "half" ? "完整展開工作面板" : "縮小工作面板";
  const activeMobileTabId = `mobile-workspace-tab-${mobilePanel}`;
  const handleMobilePanelFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    setMobileSheetLevel("full");
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "center" })));
  };

  const venueAssignment = venueAssignmentForArea(event, hall);
  const venueAreas = event.areas.filter((area) => venueAssignment.areaIds.includes(area.id));
  const changeDay = (next: EventDay) => {
    historyIntent.current = "push";
    cancelPosition();
    pendingSelection.current = null;
    pendingRestoreCode.current = null;
    setDay(next);
    setSelectedRecordId(null);
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
  };
  const navigationButton = <button className={styles.navigationToggle} aria-pressed={navigationMode} onClick={toggleNavigationMode}><UiIcon name="locate" />{navigationMode ? "退出導航模式" : "開始導航"}</button>;
  const hintedCode = focusedCode ?? selected?.code ?? null;
  const renderMapTools = (measurement = false) => <>
    <div className={styles.locationControls}>
      <div className={styles.dateTabs} role="tablist" aria-label="活動日期">{event.days.map((eventDay, index) => <button key={eventDay.id} role="tab" tabIndex={day === eventDay.id ? 0 : -1} aria-selected={day === eventDay.id} onClick={() => changeDay(eventDay.id)} onKeyDown={(keyEvent) => {
        const target = keyEvent.key === "ArrowRight" ? (index + 1) % event.days.length : keyEvent.key === "ArrowLeft" ? (index + event.days.length - 1) % event.days.length : keyEvent.key === "Home" ? 0 : keyEvent.key === "End" ? event.days.length - 1 : -1;
        if (target < 0) return;
        keyEvent.preventDefault(); changeDay(event.days[target].id);
        (keyEvent.currentTarget.parentElement?.children[target] as HTMLButtonElement)?.focus();
      }}><b>{eventDay.label}</b><span>{eventDay.dateLabel}</span></button>)}</div>
      <label className={styles.dateSelect}>日期<select value={day} onChange={(change) => changeDay(event.days.find((item) => String(item.id) === change.target.value)!.id)}>{event.days.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.dateLabel}</option>)}</select></label>
      {event.venueAssignments.length > 1 ? <label>場館空間<select value={venueAssignment.venueSpaceId} onChange={(change) => changeArea(event.venueAssignments.find((item) => item.venueSpaceId === change.target.value)!.areaIds[0])}>{event.venueAssignments.map((item) => <option key={item.venueSpaceId} value={item.venueSpaceId}>{item.venueName} · {item.venueSpaceName}</option>)}</select></label> : <span className={styles.venueName}>{event.venue}</span>}
      {showAreaSwitcher && (venueAreas.length > 1 ? <label>展區<select value={hall} onChange={(change) => changeArea(change.target.value)}>{venueAreas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</select></label> : <span className={styles.venueName}>{venueAreas[0]?.label}</span>)}

    </div>
    {navigationMode && <div className={styles.navigationBanner} role="status"><span><UiIcon name="locate" /></span><div><b>導航模式 · 地圖只顯示 DAY {day} 行程</b><small>已走訪 {visitedCount} 站 · 剩餘 {Math.max(0, dayPlan.length - visitedCount)} 站{navigationTargetRecord ? ` · 目前目標 ${navigationTargetRecord.code}` : ""}</small></div></div>}
        {nextRecord && !navigationMode && <div className="route"><span><UiIcon name="external" /></span><button className={styles.routeMain} onClick={() => selectRecord(nextRecord)}><small>下一站</small><b>{nextRecord.code} · {nextRecord.name}</b></button><button onClick={() => updatePlanning((current) => removeFromVisitPlan(current, eventId, day, nextRecord.circle.id))} aria-label="從行程移除下一站">從行程移除</button></div>}
    <div className={styles.codeHint} aria-live={measurement ? undefined : "polite"}>{hintedCode ? "已選取 " + hintedCode : "選取攤位查看社團"}</div>
  </>;

  return <main className={`app-shell ${styles.shell}`} data-text-scale={textScale} data-mobile-sheet-level={mobileSheetLevel} data-mobile-sheet-dragging={mobileSheetDragging || undefined}>
    <header className="topbar"><div className="brand"><span aria-hidden="true">場</span><div><b>場刊 Map</b><small>同人展逛攤地圖</small></div></div><div className="event"><i>活動</i><div><h1 title={event.name}>{event.name}</h1><small>{event.dateRangeLabel} · {event.venue}</small></div></div><label className="search"><span aria-hidden="true"><UiIcon name="search" /></span><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); if (desktop) { setDesktopPanel("explore"); setNavigationMode(false); } setMobilePanel("results"); setMobileSheetLevel("half"); }} placeholder="搜尋社團、攤位或作品" aria-label="搜尋社團、攤位或作品" /><kbd>⌘ K</kbd></label><div className={styles.topbarActions}><div className={styles.textScale} role="group" aria-label="網頁字體大小"><span>字級</span>{(["standard", "large", "extra"] as const).map((value, index) => <button key={value} aria-pressed={textScale === value} aria-label={index === 0 ? "標準字級" : index === 1 ? "較大字級" : "最大字級"} onClick={() => changeTextScale(value)}>{index === 0 ? "小" : index === 1 ? "中" : "大"}</button>)}</div><PlanningTools eventId={eventId} />{planningStorageError && <span className={styles.storageError} role="status">儲存異常，請開啟資料管理</span>}<ReaderHelp dataLastUpdatedLabel={event.dataLastUpdatedLabel} /></div></header>
    <section className={`toolbar ${styles.mobileToolbar}`} aria-label={showAreaSwitcher ? "日期與展區篩選" : "日期篩選"}><div className="days">{event.days.map((eventDay) => <button key={eventDay.id} className={day === eventDay.id ? "active" : ""} onClick={() => changeDay(eventDay.id)}><b>{eventDay.label}</b><span>{eventDay.dateLabel}</span></button>)}</div>{showAreaSwitcher && <div className="mobile-halls">{event.areas.map((area) => <button key={area.id} className={hall === area.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setHall(area.id); }}>{area.label}</button>)}</div>}<div className="open-hours" role="status"><span />{planningStorageError ? "儲存異常，請開啟資料管理" : planningReady ? "資料僅儲存於瀏覽器" : "正在讀取瀏覽器資料"}</div><button className={`${styles.navigationToggle} ${navigationMode ? styles.navigationToggleActive : ""}`} aria-pressed={navigationMode} onClick={toggleNavigationMode}><UiIcon name="locate" />{navigationMode ? "退出導航模式" : "導航模式"}</button></section>
    <div className={`workspace ${styles.workspace}`}>
      <aside className={`filters ${styles.leftRail}`}>
        <div className={styles.desktopTabs} role="tablist" aria-label="工作區">{(["explore", "plan"] as const).map((panel, index) => <button key={panel} ref={desktopPanel === panel ? desktopTabRef : undefined} id={"desktop-tab-" + panel} role="tab" aria-controls={"desktop-panel-" + panel} aria-selected={desktopPanel === panel} tabIndex={desktopPanel === panel ? 0 : -1} onClick={() => setDesktopPanel(panel)} onKeyDown={(keyEvent) => {
          const next = keyEvent.key === "Home" ? "explore" : keyEvent.key === "End" ? "plan" : ["ArrowLeft", "ArrowRight"].includes(keyEvent.key) ? index === 0 ? "plan" : "explore" : null;
          if (!next) return;
          keyEvent.preventDefault(); setDesktopPanel(next); document.getElementById("desktop-tab-" + next)?.focus();
        }}>{panel === "explore" ? "探索" : "行程 " + dayPlan.length}</button>)}</div>
        <div id="desktop-panel-explore" className={styles.explorePanel} role="tabpanel" aria-labelledby="desktop-tab-explore" hidden={desktopPanel !== "explore"}><div className={styles.filterStack}><div className="filter-title"><b>篩選攤位</b><button className={clearFiltersClassName} onClick={clearFilters}>全部清除</button></div><fieldset><legend>社團主題</legend><div className="genres">{genres.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className="dot" style={categoryDotStyle(genres, value)} />{value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset><label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個社團</small></span></label><AdvancedCircleSearchControls value={advancedSearch} workSuggestions={workTopicSuggestions} onApply={(next) => { historyIntent.current = "push"; setAdvancedSearch(next); }} /></div>{resultsPanel}</div>
        <div ref={planPanelRef} id="desktop-panel-plan" className={styles.planPanel} role="tabpanel" aria-labelledby="desktop-tab-plan" hidden={desktopPanel !== "plan"}>{navigationButton}{planningPanel}</div>
      </aside>
      <section className="map-region" aria-label="攤位地圖">
        <div className="map-title"><div><small>社團攤位配置圖</small><b>{event.venue} <em>{event.areas.find((area) => area.id === hall)?.label}</em></b></div></div>
        <div className={styles.mobileMapStatus}>{navigationMode && <div className={styles.navigationBanner} role="status"><span><UiIcon name="locate" /></span><div><b>導航模式 · 地圖只顯示 DAY {day} 行程</b><small>已走訪 {visitedCount} 站 · 剩餘 {Math.max(0, dayPlan.length - visitedCount)} 站{navigationTargetRecord ? ` · 目前目標 ${navigationTargetRecord.code}` : ""}</small></div><button onClick={toggleNavigationMode}>退出</button></div>}
        {nextRecord && !navigationMode && <div className="route"><span><UiIcon name="external" /></span><button className={styles.routeMain} onClick={() => selectRecord(nextRecord)}><small>下一站</small><b>{nextRecord.code} · {nextRecord.name}</b></button><button onClick={() => updatePlanning((current) => removeFromVisitPlan(current, eventId, day, nextRecord.circle.id))} aria-label="從行程移除下一站"><UiIcon name="close" /></button></div>}</div>
        <div ref={mapRef} className={`map ${styles.mapCanvas}`} data-details-open={desktop && desktopDetailsOpen && Boolean(selected) || undefined} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}>
          {desktop && <><div ref={toolsRef} className={styles.mapTools} data-map-tools>{renderMapTools()}</div><div ref={fitToolsRef} className={`${styles.mapTools} ${styles.fitTools}`} inert aria-hidden="true" data-map-tools>{renderMapTools(true)}</div></>}
          {publishedMap ? <div ref={floorRef} className={`floor ${styles.vectorFloor} ${mapGestureActive ? styles.mapGestureActive : ""}`} style={{ width: `${floorWidth}px`, height: `${floorHeight}px`, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}><AccessibleEventMapRenderer eventName={event.name} layout={publishedMap.layout} slots={slots} showMedia={shouldShowMapMedia(zoom)} labelPresentation={desktop ? { screenScale: floorHeight / publishedMap.layout.height * zoom, targetPx: 12 * (textScale === "extra" ? 1.24 : textScale === "large" ? 1.12 : 1), paddingPx: 2 } : undefined} onFocusCode={setFocusedCode} onSelect={(code) => { const marker = markersByCode.get(code); if (marker) selectRecord(marker.records[0]); }} /></div> : <div className={styles.mapState}><b>{mapLoading ? "正在讀取活動地圖…" : "活動地圖讀取失敗"}</b><span className={mapError ? styles.mapError : ""}>{mapError || "請稍候"}</span>{!mapLoading && <button onClick={() => setMapRetry((value) => value + 1)}>重新讀取地圖</button>}</div>}
          <div ref={controlsRef} className="controls" data-navigation={desktop && navigationMode || undefined} aria-label="地圖縮放控制"><button type="button" onClick={() => stepZoom(.1)} aria-label="放大地圖"><UiIcon name="plus" /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => stepZoom(-.1)} aria-label="縮小地圖"><UiIcon name="minus" /></button><button type="button" onClick={resetMap} aria-label={desktop ? "查看全場" : "重設地圖位置"}><UiIcon name="locate" /></button>{desktop && navigationMode && <button className={styles.exitNavigation} onClick={toggleNavigationMode}>退出導航模式</button>}</div><div className="compass"><small>N</small><UiIcon name="north" /></div>
          {desktop && selected && desktopDetailsOpen && <aside ref={detailsRef} className={styles.rightRail} aria-label="已選社團詳情" onKeyDownCapture={(keyEvent) => { if (keyEvent.key === "Escape" && !showFullDetail) { keyEvent.stopPropagation(); closeDetails(); } }}><span className={styles.selectionAnnouncement} role="status">{selected.code} · {selected.name} 詳情已更新</span><div className={styles.detailSlot}>{detailsPanel}</div></aside>}
        </div>
      </section>
      <aside className={styles.mobileDock} style={mobileDockStyle} data-mobile-sheet-level={mobileSheetLevel} data-dragging={mobileSheetDragging || undefined} aria-label="行動版工作面板"><button type="button" className={styles.mobileSheetHandle} aria-label={mobileSheetActionLabel} onClick={toggleMobileSheetLevel} onPointerDown={handleMobileSheetPointerDown} onPointerMove={handleMobileSheetPointerMove} onPointerUp={handleMobileSheetPointerEnd} onPointerCancel={handleMobileSheetPointerEnd}><span aria-hidden="true" /></button><div className={styles.mobileTabs} role="tablist" aria-label="行動版工作區"><button id="mobile-workspace-tab-filters" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "filters"} onClick={() => selectMobilePanel("filters")}>篩選</button><button id="mobile-workspace-tab-results" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "results"} onClick={() => selectMobilePanel("results")}>結果 <span>{filtered.length}</span></button><button id="mobile-workspace-tab-details" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "details"} onClick={() => selectMobilePanel("details")} disabled={!selected}>詳細資訊</button><button id="mobile-workspace-tab-plan" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "plan"} onClick={() => selectMobilePanel("plan")}>行程 <span>{dayPlan.length}</span></button></div><div id="mobile-workspace-panel" className={styles.mobilePanel} role="tabpanel" aria-labelledby={activeMobileTabId} aria-hidden={mobileSheetLevel === "peek"} onFocusCapture={handleMobilePanelFocus}>{mobilePanel === "filters" ? mobileFiltersPanel : mobilePanel === "results" ? resultsPanel : mobilePanel === "details" ? detailsPanel : planningPanel}</div></aside>
    </div>
    {favoriteUndo && <div className={styles.undoToast} role="status"><span>已取消收藏「{favoriteUndo.circleName}」</span><button onClick={() => { updatePlanning((current) => restoreFavorite(current, favoriteUndo.favorite)); setFavoriteUndo(null); }}>復原收藏</button><button onClick={() => setFavoriteUndo(null)} aria-label="關閉收藏復原提示"><UiIcon name="close" /></button></div>}
    {showFullDetail && selected && createPortal(<div className={styles.fullDetailBackdrop} style={{ "--ui-font-scale": textScale === "extra" ? 1.24 : textScale === "large" ? 1.12 : 1 } as CSSProperties} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setShowFullDetail(false); }}><div ref={fullDetailRef} className={styles.fullDetailDialog} role="dialog" aria-modal="true" aria-label={`${selected.name} 完整詳細資訊`} tabIndex={-1}>{fullDetailsPanel}</div></div>, document.body)}
  </main>;
}
