"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent } from "react";
import AccessibleEventMapRenderer from "./accessible-event-map-renderer";
import { loadStaticEventMap } from "./static-event-map-client";
import { FF47_EVENT_ID, type PublishedEventMap } from "./event-map";
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
import { calculateMapFitZoom, calculatePinchMapView, centerMapOffset, clampMapZoom, mapViewFromWheel, shouldShowMapMedia, zoomOffsetAroundPoint, type MapPinchOrigin, type MapView } from "./map-viewport";
import { eventUsesAreaSwitcher, FF47_EVENT, type FF47Area, type FF47Day } from "./event-catalog";
import { historyMethod, parseEventUrlState, serializeEventUrlState, shouldWriteEventUrl, type PendingCircleSelection } from "./event-url-state";
import { projectEventWorkspace } from "./event-workspace-projection";
import PlanningTools from "./planning-tools";
import styles from "./event-map-app.module.css";

type Hall = FF47Area;
type MobilePanel = "filters" | "results" | "details" | "plan";
type MobileSheetLevel = "peek" | "half" | "full";
type TextScale = "standard" | "large" | "extra";

const TEXT_SCALE_STORAGE_KEY = "ff47-event-map-text-scale";
const GENRES: readonly string[] = FF47_EVENT.genres;
type MapGesture =
  | { kind: "drag"; pointerId: number; x: number; y: number; ox: number; oy: number }
  | ({ kind: "pinch" } & MapPinchOrigin);

export default function EventMapApp() {
  const showAreaSwitcher = eventUsesAreaSwitcher(FF47_EVENT);
  const { catalog, status: catalogStatus, error: catalogError } = useCircleCatalog(FF47_EVENT_ID);
  const { records: circleRecords, recordsById: circleRecordsById, recordsByCircleId: circleRecordsByCircleId } = catalog;
  const catalogReady = catalogStatus === "ready";
  const [day, setDay] = useState<FF47Day>(FF47_EVENT.days[0].id);
  const [hall, setHall] = useState<Hall>(FF47_EVENT.areas[0].id);
  const [genre, setGenre] = useState<string>(FF47_EVENT.genres[0]);
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
  const [mapView, setMapViewState] = useState<MapView>({ zoom: .8, offset: { x: 0, y: 0 } });
  const [mapMinZoom, setMapMinZoom] = useState(0);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const [publishedMap, setPublishedMap] = useState<PublishedEventMap | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [textScale, setTextScale] = useState<TextScale>("standard");
  const [favoriteUndo, setFavoriteUndo] = useState<{ favorite: FavoriteRecord; circleName: string } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const { document: planning, ready: planningReady, update: updatePlanning, storageError: planningStorageError } = usePlanning(FF47_EVENT_ID, catalogStatus !== "loading");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const floorRef = useRef<HTMLDivElement | null>(null);
  const fullDetailRef = useRef<HTMLDivElement | null>(null);
  const aboutRef = useRef<HTMLDivElement | null>(null);
  const aboutButtonRef = useRef<HTMLButtonElement | null>(null);
  const gesture = useRef<MapGesture | null>(null);
  const mapGestureFrame = useRef<number | null>(null);
  const mobileSheetGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const mobileSheetWasDragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const mapViewRef = useRef(mapView);
  const historyIntent = useRef<"replace" | "push">("replace");
  const suppressUrlWrite = useRef(false);
  const lastAutoSelection = useRef("");
  const pendingRestoreCode = useRef<string | null>(null);
  const pendingSelection = useRef<PendingCircleSelection<FF47Day> | null>(null);
  const previousFitZoom = useRef(0);
  const mapWasFitted = useRef(false);
  const floorHeight = 950;
  const floorWidth = publishedMap ? floorHeight * publishedMap.layout.width / publishedMap.layout.height : 1344;
  const { zoom, offset } = mapView;
  const getFloorInset = useCallback(() => ({ x: floorRef.current?.offsetLeft ?? 0, y: floorRef.current?.offsetTop ?? 0 }), []);
  const setMapView = useCallback((next: MapView | ((current: MapView) => MapView)) => {
    const resolved = typeof next === "function" ? next(mapViewRef.current) : next;
    mapViewRef.current = resolved;
    setMapViewState(resolved);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY);
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
    if (!showAbout) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !aboutRef.current?.contains(event.target)) setShowAbout(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShowAbout(false);
      requestAnimationFrame(() => aboutButtonRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAbout]);

  useEffect(() => {
    const restore = (fromHistory = false) => {
      const { state } = parseEventUrlState(FF47_EVENT, window.location.href);
      // The catalog snapshot may still be in flight. Filters restore now; the
      // shared circle/booth selection is resolved once records are available.
      pendingSelection.current = state.selection;
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
  }, []);

  // Apply a shareable circle/booth link as soon as the catalog can resolve it,
  // whether it arrives before or after the snapshot download completes.
  useEffect(() => {
    const pending = pendingSelection.current;
    if (!pending || !catalogReady) return;
    pendingSelection.current = null;
    const selected = resolveCircleSelection(
      circleRecords, circleRecordsById, pending.day, pending.circleId, pending.boothCode,
      (circleId) => resolveCircleIdAliases(circleId, FF47_EVENT_ID),
    );
    setSelectedRecordId(selected?.recordId ?? null);
    setMobilePanel(selected ? "details" : "results");
    setMobileSheetLevel(selected ? "half" : "peek");
    pendingRestoreCode.current = selected?.code ?? null;
  }, [catalogReady, circleRecords, circleRecordsById]);

  useEffect(() => {
    const viewportElement = mapRef.current;
    if (!publishedMap || !viewportElement) return;
    const fitMap = () => {
      const viewport = viewportElement.getBoundingClientRect();
      const inset = getFloorInset();
      const nextMinimum = calculateMapFitZoom(viewport, { width: floorWidth, height: floorHeight });
      const previousMinimum = previousFitZoom.current;
      previousFitZoom.current = nextMinimum;
      setMapMinZoom(nextMinimum);
      setMapView((current) => {
        const wasAtFit = previousMinimum > 0 && Math.abs(current.zoom - previousMinimum) < .006;
        if (!mapWasFitted.current || current.zoom < nextMinimum || wasAtFit) {
          mapWasFitted.current = true;
          return { zoom: nextMinimum, offset: centerMapOffset(viewport, { width: floorWidth, height: floorHeight }, nextMinimum, inset) };
        }
        return current;
      });
    };
    fitMap();
    const observer = new ResizeObserver(fitMap);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [floorWidth, getFloorInset, publishedMap, setMapView]);

  useEffect(() => {
    let cancelled = false;
    void loadStaticEventMap(FF47_EVENT_ID)
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
      event.preventDefault();
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
  }, [getFloorInset, mapMinZoom, setMapView]);

  useEffect(() => {
    // Hold the URL untouched while the catalog snapshot is still downloading, so
    // a shared circle link is never rewritten away before it can be resolved.
    if (!urlReady || catalogStatus === "loading") return;
    if (!shouldWriteEventUrl({ urlReady, catalogStatus, restoringFromPopstate: suppressUrlWrite.current })) {
      suppressUrlWrite.current = false;
      return;
    }
    const selected = circleRecordsById.get(selectedRecordId ?? "");
    const url = serializeEventUrlState(FF47_EVENT, {
      eventId: FF47_EVENT.id, day, area: hall, query, genre, favoriteOnly, advancedSearch, planningDisplay,
      selection: { day, circleId: selected?.circle.id ?? null, boothCode: selected?.code ?? null },
    }, window.location.href);
    const method = historyMethod(historyIntent.current, false);
    if (method === "none") return;
    window.history[method](null, "", url);
    historyIntent.current = "replace";
  }, [advancedSearch, catalogStatus, circleRecordsById, day, favoriteOnly, genre, hall, planningDisplay, query, selectedRecordId, urlReady]);

  const workspace = useMemo(() => projectEventWorkspace({
    event: FF47_EVENT,
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
  }), [advancedSearch, circleRecords, circleRecordsByCircleId, circleRecordsById, day, favoriteOnly, genre, hall, navigationMode, planning, planningDisplay, query, selectedRecordId]);
  const {
    favorites, favoriteIds, favoriteGroupLabels, dayPlan, plansById, dayRecordsByCircleId,
    selected, selectedFavorite, selectedPlan, nextRecord, navigationTargetRecord,
    visitedCount, sharedRecords, filtered, workTopicSuggestions, genreCounts, markersByCode, slots,
    activeFilterDescriptors,
  } = workspace;

  const focusCode = useCallback((code: string) => {
    if (!publishedMap || !mapRef.current) return;
    const slot = publishedMap.layout.rows.flatMap((row) => row.slots).find((item) => item.code === code);
    if (!slot) return;
    const floorHeight = 950;
    const floorScale = floorHeight / publishedMap.layout.height;
    const centerX = (slot.rect.x + slot.rect.width / 2) * floorScale;
    const centerY = (slot.rect.y + slot.rect.height / 2) * floorScale;
    const viewport = mapRef.current.getBoundingClientRect();
    const inset = getFloorInset();
    setMapView((current) => {
      const targetZoom = clampMapZoom(current.zoom, mapMinZoom);
      return { zoom: targetZoom, offset: { x: viewport.width / 2 - inset.x - centerX * targetZoom, y: viewport.height / 2 - inset.y - centerY * targetZoom } };
    });
  }, [getFloorInset, mapMinZoom, publishedMap, setMapView]);

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
    setMobileSheetLevel("half");
    focusCode(record.code);
  }, [focusCode]);

  useEffect(() => {
    const key = `${day}|${hall}|${genre}|${favoriteOnly}|${query.trim()}|${filtered[0]?.recordId ?? ""}`;
    if (!query.trim() || filtered.length !== 1 || lastAutoSelection.current === key) return;
    lastAutoSelection.current = key;
    selectRecord(filtered[0], "details", false);
  }, [day, favoriteOnly, filtered, genre, hall, query, selectRecord]);

  const clearResultFilters = () => { historyIntent.current = "push"; setGenre(FF47_EVENT.genres[0]); setFavoriteOnly(false); setHall(FF47_EVENT.areas[0].id); setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); setPlanningDisplay(DEFAULT_PLANNING_DISPLAY_FILTERS); };
  const clearFilters = () => { clearResultFilters(); setQuery(""); };
  const resetAdvancedSearch = () => { historyIntent.current = "push"; setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); };
  const resetMap = () => {
    const viewport = mapRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const nextZoom = calculateMapFitZoom(viewport, { width: floorWidth, height: floorHeight });
    previousFitZoom.current = nextZoom;
    mapWasFitted.current = true;
    setMapMinZoom(nextZoom);
    setMapView({ zoom: nextZoom, offset: centerMapOffset(viewport, { width: floorWidth, height: floorHeight }, nextZoom, getFloorInset()) });
  };
  const stepZoom = (delta: number) => {
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
    setHall(FF47_EVENT.areas[0].id);
    setMobilePanel(navigationTargetRecord ? "details" : "plan");
    setMobileSheetLevel("half");
    if (navigationTargetRecord) selectRecord(navigationTargetRecord, "details", false);
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
    updatePlanning((current) => toggleFavorite(current, FF47_EVENT_ID, record.circle.id));
    setFavoriteUndo(existing ? { favorite: existing, circleName: record.name } : null);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
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
    onMove: (circleId: string, direction: -1 | 1) => updatePlanning((current) => moveVisitPlanEntry(current, FF47_EVENT_ID, day, circleId, direction)),
    onMoveTo: (circleId: string, targetIndex: number) => updatePlanning((current) => moveVisitPlanEntryToIndex(current, FF47_EVENT_ID, day, circleId, targetIndex)),
    onVisit: (entry: (typeof dayPlan)[number]) => updatePlanning((current) => markVisited(current, FF47_EVENT_ID, day, entry.circleId, entry.status !== "visited")),
    onRemove: (circleId: string) => updatePlanning((current) => removeFromVisitPlan(current, FF47_EVENT_ID, day, circleId)),
    onUpdatePurchase: (circleId: string, purchaseMemo: string, budget: number | null) => updatePlanning((current) => updateVisitPlanPurchase(current, FF47_EVENT_ID, day, circleId, purchaseMemo, budget)),
  };
  const compactItineraryPanel = <DayItinerary {...itineraryProps} variant="compact" />;
  const fullItineraryPanel = <DayItinerary {...itineraryProps} variant="full" />;
  const planningControls = <PlanningDisplayControls value={planningDisplay} groups={planning.favoriteGroups} onApply={(next) => { historyIntent.current = "push"; setPlanningDisplay(next); }} />;
  const planningPanel = <div className={styles.planningPanel}>{planningControls}{fullItineraryPanel}</div>;
  const resultSetKey = `${day}|${hall}|${genre}|${favoriteOnly}|${advancedSearch.creatorType}|${advancedSearch.workQuery}|${advancedSearch.workType}|${advancedSearch.adultContent}|${planningDisplay.favoriteGroupId}|${planningDisplay.visitStatus}|${planningDisplay.sort}|${planningDisplay.density}|${planningDisplay.mediaCount}|${query}`;
  const activeResultFilters: ActiveResultFilter[] = activeFilterDescriptors.map((filter) => ({
    ...filter,
    onClear: () => {
      historyIntent.current = "push";
      if (filter.id === "area") setHall(FF47_EVENT.areas[0].id);
      if (filter.id === "genre") setGenre(FF47_EVENT.genres[0]);
      if (filter.id === "favorite") setFavoriteOnly(false);
      if (filter.id === "creator") setAdvancedSearch((current) => ({ ...current, creatorType: "ALL" }));
      if (filter.id === "work") setAdvancedSearch((current) => ({ ...current, workQuery: "" }));
      if (filter.id === "work-type") setAdvancedSearch((current) => ({ ...current, workType: "ALL" }));
      if (filter.id === "adult") setAdvancedSearch((current) => ({ ...current, adultContent: "ALL" }));
      if (filter.id === "favorite-group") setPlanningDisplay((current) => ({ ...current, favoriteGroupId: "ALL" }));
      if (filter.id === "visit") setPlanningDisplay((current) => ({ ...current, visitStatus: "ALL" }));
    },
  }));
  const resultsPanel = <SearchResults key={resultSetKey} records={filtered} catalogStatus={catalogStatus} catalogError={catalogError} selectedId={selectedRecordId} favoriteIds={favoriteIds} favoriteGroupLabels={favoriteGroupLabels} plans={plansById} density={planningDisplay.density} mediaCount={planningDisplay.mediaCount} query={query} activeFilters={activeResultFilters} advancedSearchActive={advancedCircleSearchCount(advancedSearch) > 0} onSelect={selectRecord} onToggleFavorite={toggleFavoriteSafely} onResetAdvancedSearch={resetAdvancedSearch} onClearFilters={clearResultFilters} onClearQuery={() => { historyIntent.current = "push"; setQuery(""); }} />;
  const detailActions = {
    onSelectShared: selectRecord,
    onToggleFavorite: () => selected && toggleFavoriteSafely(selected),
    onTogglePlan: () => selected && updatePlanning((current) => selectedPlan ? removeFromVisitPlan(current, FF47_EVENT_ID, day, selected.circle.id) : addToVisitPlan(current, FF47_EVENT_ID, day, selected.circle.id)),
    onSetNext: () => selected && updatePlanning((current) => setNextStop(current, FF47_EVENT_ID, day, selected.circle.id)),
    onUpdateFavorite: (groupId: string | null, memo: string) => selected && updatePlanning((current) => updateFavorite(current, FF47_EVENT_ID, selected.circle.id, groupId, memo)),
    onCreateGroup: (name: string) => updatePlanning((current) => createFavoriteGroup(current, name)),
  };
  const detailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} compact onClose={() => { historyIntent.current = "push"; setSelectedRecordId(null); setShowFullDetail(false); }} onOpenFull={() => setShowFullDetail(true)} {...detailActions} />;
  const fullDetailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} onClose={() => setShowFullDetail(false)} {...detailActions} />;
  const clearFiltersClassName = `${styles.clearFilters} ${genre !== FF47_EVENT.genres[0] ? styles.clearFiltersActive : ""}`;
  const mobileFiltersPanel = <section className={styles.mobileFilters} aria-label="攤位篩選">
    <header><div><small>FILTERS</small><b>篩選攤位</b></div><button className={clearFiltersClassName} onClick={clearFilters}>全部清除</button></header>
    <fieldset><legend>創作類別</legend><div className="genres">{GENRES.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className={`dot dot-${value}`} />{value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset>
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

  return <main className="app-shell" data-text-scale={textScale} data-mobile-sheet-level={mobileSheetLevel} data-mobile-sheet-dragging={mobileSheetDragging || undefined}>
    <header className="topbar"><div className="brand"><span aria-hidden="true">場</span><div><b>場刊 Map</b><small>同人展逛攤地圖</small></div></div><div className="event"><i>活動</i><div><b>{FF47_EVENT.name}</b><small>{FF47_EVENT.dateRangeLabel} · {FF47_EVENT.venue}</small></div></div><label className="search"><span aria-hidden="true"><UiIcon name="search" /></span><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setMobilePanel("results"); setMobileSheetLevel("half"); }} placeholder="搜尋社團、攤位或作品" aria-label="搜尋社團、攤位或作品" /><kbd>⌘ K</kbd></label><div className={styles.topbarActions}><div className={styles.textScale} role="group" aria-label="網頁字體大小"><span>字級</span>{(["standard", "large", "extra"] as const).map((value, index) => <button key={value} aria-pressed={textScale === value} aria-label={index === 0 ? "標準字級" : index === 1 ? "較大字級" : "最大字級"} onClick={() => changeTextScale(value)}>{index === 0 ? "小" : index === 1 ? "中" : "大"}</button>)}</div><PlanningTools /><div ref={aboutRef} className={styles.aboutMenu}><button ref={aboutButtonRef} type="button" className={styles.aboutTrigger} aria-haspopup="dialog" aria-expanded={showAbout} aria-controls="about-this-site" onClick={() => setShowAbout((current) => !current)}>關於</button>{showAbout && <section id="about-this-site" className={styles.aboutPanel} role="dialog" aria-labelledby="about-title"><header><h2 id="about-title">關於本頁</h2><button type="button" onClick={() => { setShowAbout(false); aboutButtonRef.current?.focus(); }} aria-label="關閉關於說明"><UiIcon name="close" /></button></header><p>本頁是非官方同人展逛攤工具，不代表 Fancy Frontier 主辦單位。資料整理自公開資料，實際活動資訊請以主辦單位與社團最新公告為準。</p><dl><div><dt>資料最後更新</dt><dd>{FF47_EVENT.dataLastUpdatedLabel}</dd></div><div><dt>聯絡</dt><dd>Discord ID <strong>dekkorakki</strong></dd></div></dl></section>}</div></div></header>
    <section className="toolbar" aria-label={showAreaSwitcher ? "日期與場館篩選" : "日期篩選"}><div className="days">{FF47_EVENT.days.map((eventDay) => <button key={eventDay.id} className={day === eventDay.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setDay(eventDay.id); setSelectedRecordId(null); }}><b>{eventDay.label}</b><span>{eventDay.dateLabel}</span></button>)}</div>{showAreaSwitcher && <div className="mobile-halls">{FF47_EVENT.areas.map((area) => <button key={area.id} className={hall === area.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setHall(area.id); }}>{area.label}</button>)}</div>}<div className="open-hours" role="status"><span />{planningStorageError ? "儲存異常，請開啟資料管理" : planningReady ? "資料僅儲存於瀏覽器" : "正在讀取瀏覽器資料"}</div><button className={`${styles.navigationToggle} ${navigationMode ? styles.navigationToggleActive : ""}`} aria-pressed={navigationMode} onClick={toggleNavigationMode}><UiIcon name="locate" />{navigationMode ? "退出導航模式" : "導航模式"}</button></section>
    <div className={`workspace ${styles.workspace} ${navigationMode ? styles.navigationWorkspace : ""}`}>
      <aside className={`filters ${styles.leftRail}`}>
        {navigationMode ? planningPanel : <><div className={styles.filterStack}><div className="filter-title"><b>篩選攤位</b><button className={clearFiltersClassName} onClick={clearFilters}>全部清除</button></div>{showAreaSwitcher && <fieldset><legend>場館／區域</legend><div className="segments">{FF47_EVENT.areas.map((area) => <button key={area.id} className={hall === area.id ? "active" : ""} onClick={() => { historyIntent.current = "push"; setHall(area.id); }}>{area.shortLabel}</button>)}</div></fieldset>}<fieldset><legend>創作類別</legend><div className="genres">{GENRES.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className={`dot dot-${value}`} />{value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset><label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個社團</small></span></label></div><AdvancedCircleSearchControls value={advancedSearch} workSuggestions={workTopicSuggestions} onApply={(next) => { historyIntent.current = "push"; setAdvancedSearch(next); }} />{resultsPanel}</>}
      </aside>
      <section className="map-region" aria-label="攤位地圖">
        <div className="map-title"><div><small>社團攤位配置圖</small><h1>{FF47_EVENT.venue} <em>{FF47_EVENT.areas.find((area) => area.id === hall)?.label}</em></h1></div></div>
        {navigationMode && <div className={styles.navigationBanner} role="status"><span><UiIcon name="locate" /></span><div><b>導航模式 · 地圖只顯示 DAY {day} 行程</b><small>已走訪 {visitedCount} 站 · 剩餘 {Math.max(0, dayPlan.length - visitedCount)} 站{navigationTargetRecord ? ` · 目前目標 ${navigationTargetRecord.code}` : ""}</small></div><button onClick={toggleNavigationMode}>退出</button></div>}
        {nextRecord && !navigationMode && <div className="route"><span><UiIcon name="external" /></span><button className={styles.routeMain} onClick={() => selectRecord(nextRecord)}><small>下一站</small><b>{nextRecord.code} · {nextRecord.name}</b></button><button onClick={() => updatePlanning((current) => removeFromVisitPlan(current, FF47_EVENT_ID, day, nextRecord.circle.id))} aria-label="從行程移除下一站"><UiIcon name="close" /></button></div>}
        <div ref={mapRef} className="map" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}>
          {publishedMap ? <div ref={floorRef} className={`floor ${styles.vectorFloor} ${mapGestureActive ? styles.mapGestureActive : ""}`} style={{ width: `${floorWidth}px`, height: `${floorHeight}px`, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}><AccessibleEventMapRenderer eventName={FF47_EVENT.name} layout={publishedMap.layout} slots={slots} showMedia={shouldShowMapMedia(zoom)} onSelect={(code) => { const marker = markersByCode.get(code); if (marker) selectRecord(marker.records[0]); }} /></div> : <div className={styles.mapState}><b>{mapLoading ? "正在讀取活動地圖…" : "活動地圖讀取失敗"}</b><span className={mapError ? styles.mapError : ""}>{mapError || "請稍候"}</span></div>}
          <div className="controls" aria-label="地圖縮放控制"><button type="button" onClick={() => stepZoom(.1)} aria-label="放大地圖"><UiIcon name="plus" /></button><span aria-live="polite">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => stepZoom(-.1)} aria-label="縮小地圖"><UiIcon name="minus" /></button><button type="button" onClick={resetMap} aria-label="重設地圖位置"><UiIcon name="locate" /></button></div><div className="compass"><small>N</small><UiIcon name="north" /></div>
        </div>
      </section>
      <aside className={`${styles.rightRail} ${navigationMode ? styles.navigationRightRail : ""}`}><div className={styles.detailSlot}>{detailsPanel}</div>{!navigationMode && <div className={styles.planSlot}>{compactItineraryPanel}</div>}</aside>
      <aside className={styles.mobileDock} style={mobileDockStyle} data-mobile-sheet-level={mobileSheetLevel} data-dragging={mobileSheetDragging || undefined} aria-label="行動版工作面板"><button type="button" className={styles.mobileSheetHandle} aria-label={mobileSheetActionLabel} onClick={toggleMobileSheetLevel} onPointerDown={handleMobileSheetPointerDown} onPointerMove={handleMobileSheetPointerMove} onPointerUp={handleMobileSheetPointerEnd} onPointerCancel={handleMobileSheetPointerEnd}><span aria-hidden="true" /></button><div className={styles.mobileTabs} role="tablist" aria-label="行動版工作區"><button id="mobile-workspace-tab-filters" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "filters"} onClick={() => selectMobilePanel("filters")}>篩選</button><button id="mobile-workspace-tab-results" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "results"} onClick={() => selectMobilePanel("results")}>結果 <span>{filtered.length}</span></button><button id="mobile-workspace-tab-details" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "details"} onClick={() => selectMobilePanel("details")} disabled={!selected}>詳細資訊</button><button id="mobile-workspace-tab-plan" role="tab" aria-controls="mobile-workspace-panel" aria-selected={mobilePanel === "plan"} onClick={() => selectMobilePanel("plan")}>行程 <span>{dayPlan.length}</span></button></div><div id="mobile-workspace-panel" className={styles.mobilePanel} role="tabpanel" aria-labelledby={activeMobileTabId} aria-hidden={mobileSheetLevel === "peek"} onFocusCapture={handleMobilePanelFocus}>{mobilePanel === "filters" ? mobileFiltersPanel : mobilePanel === "results" ? resultsPanel : mobilePanel === "details" ? detailsPanel : planningPanel}</div></aside>
    </div>
    {favoriteUndo && <div className={styles.undoToast} role="status"><span>已取消收藏「{favoriteUndo.circleName}」</span><button onClick={() => { updatePlanning((current) => restoreFavorite(current, favoriteUndo.favorite)); setFavoriteUndo(null); }}>復原收藏</button><button onClick={() => setFavoriteUndo(null)} aria-label="關閉收藏復原提示"><UiIcon name="close" /></button></div>}
    {showFullDetail && selected && <div className={styles.fullDetailBackdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setShowFullDetail(false); }}><div ref={fullDetailRef} className={styles.fullDetailDialog} role="dialog" aria-modal="true" aria-label={`${selected.name} 完整詳細資訊`} tabIndex={-1}>{fullDetailsPanel}</div></div>}
  </main>;
}
