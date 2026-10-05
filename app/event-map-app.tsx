"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent } from "react";
import { createPortal } from "react-dom";
import { useMapViewport } from "./use-map-viewport";
import AccessibleEventMapRenderer from "./accessible-event-map-renderer";
import { loadStaticEventMapResource } from "./static-event-map-client";
import type { PublishedEventMap } from "./event-map";
import { placementStatusLabel, resolveCircleIdAliases, type CircleViewRecord } from "./circle-records";
import { useCircleCatalog } from "./use-circle-catalog";
import { CircleDetails, DayItinerary, SearchResults, type ActiveResultFilter } from "./event-workspace-panels";
import { applyReaderMetadata, pageMetadata } from "./seo";
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
} from "./planning-store";
import { ReaderPlanningBoundary, useReaderPlanning } from "./reader-planning";
import ReaderViewTabs, { arrivedOnPlan, forgetArrivalPanel, navigateReader, ordinaryLinkClick } from "./reader-navigation";
import { switchReaderViewUrl } from "./catalog-browse-url";
import tabStyles from "./reader-mobile-tabs.module.css";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import { resolveCircleSelection } from "./map-view-state";
import { calculatePinchMapView, clampMapZoom, mapViewFromWheel, MOBILE_SUMMARY_PEEK_HEIGHT, shouldShowMapMedia, zoomOffsetAroundPoint, type MapPinchOrigin } from "./map-viewport";
import {
  eventUsesScopedMaps, venueAssignmentForArea,
  venueAssignmentForVenueSpace, type EventDayDefinition, type EventDefinition,
} from "./event-catalog";
import { defaultEventUrlState, historyMethod, parseEventUrlState, serializeEventUrlState, shouldWriteEventUrl, type PendingCircleSelection } from "./event-url-state";
import { projectEventWorkspace } from "./event-workspace-projection";
import PlanningTools from "./planning-tools";
import { OfflinePrepDialog } from "./offline-prep-dialog";
import { ShareItineraryDialog } from "./planning-share-panel";
import ReaderHelp from "./reader-help";
import { dayDateLabel, eventCalendar, eventDayCalendarDate } from "./event-calendar";
import { PUBLIC_HEADER_MESSAGES, publicLoginHref } from "./public-header";
import { LanguageSwitcher } from "./i18n/language-switcher";
import { localizedHref, type Locale } from "./i18n/locale";
import { useDocumentLanguage, useLocale, useMessages } from "./i18n/locale-context";
import { EVENT_MAP_MESSAGES } from "./event-map-app.messages";
import { allCircleCategoriesLabel } from "./circle-categories";
import { mapFacilityDirectory, type MapFacilityEntry } from "./map-facility-directory";
import MapFacilityPanel from "./map-facility-panel";
import styles from "./event-map-app.module.css";

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
type MapPoint = { x: number; y: number };

/** A press that travels further than this is a drag, not a tap. */
const MAP_TAP_SLOP = 3;
/** A second tap this soon and this close to the first zooms in. */
const MAP_DOUBLE_TAP_MS = 350;
const MAP_DOUBLE_TAP_DISTANCE = 24;

/**
 * Renders one event. The caller remounts on a different event (`key={event.id}`)
 * rather than resetting state field by field: every `useState` below seeds from
 * this event's defaults, and a stale day or area from the previous event would
 * be indistinguishable from a deliberate choice.
 */
/** A day's date as the interface language writes it; Chinese keeps the published label. */
function dayDate(event: EventDefinition, eventDay: EventDefinition["days"][number], locale: Locale) {
  if (locale === "zh-Hant") return eventDay.dateLabel;
  const iso = eventDayCalendarDate(event, eventDay.id);
  return iso ? dayDateLabel(iso, locale) : eventDay.dateLabel;
}

export default function EventMapApp(props: { event: EventDefinition; onChooseEvent?: () => void }) {
  const catalog = useCircleCatalog(props.event.id);
  return <ReaderPlanningBoundary eventId={props.event.id} settled={catalog.status !== "loading"}><EventMapWorkspace {...props} /></ReaderPlanningBoundary>;
}
function EventMapWorkspace({ event, onChooseEvent }: { event: EventDefinition; onChooseEvent?: () => void }) {
  const eventId = event.id;
  const { locale } = useLocale();
  const t = useMessages(EVENT_MAP_MESSAGES);
  const header = useMessages(PUBLIC_HEADER_MESSAGES);
  useDocumentLanguage();
  const genres: readonly string[] = event.genres;
  const urlDefaults = defaultEventUrlState(event);
  const { catalog, status: catalogStatus, error: catalogError } = useCircleCatalog(eventId);
  const { records: circleRecords, recordsById: circleRecordsById, recordsByCircleId: circleRecordsByCircleId } = catalog;
  const catalogReady = catalogStatus === "ready";
  const [day, setDay] = useState<EventDay>(urlDefaults.day);
  const [venueSpaceId, setVenueSpaceId] = useState<string>(urlDefaults.venueSpaceId);
  const [genre, setGenre] = useState<string>(event.genres[0]);
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [advancedSearch, setAdvancedSearch] = useState<AdvancedCircleSearch>(DEFAULT_ADVANCED_CIRCLE_SEARCH);
  const [planningDisplay, setPlanningDisplay] = useState<PlanningDisplayFilters>(DEFAULT_PLANNING_DISPLAY_FILTERS);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  // The browse view's 行程 tab lands here with the plan open; 探索 lands on the map at rest.
  const [openedOnPlan] = useState(arrivedOnPlan);
  const keepLandingPanel = useRef(openedOnPlan);
  const [mobileWorkspace, setMobileWorkspace] = useState<"explore" | "plan">(openedOnPlan ? "plan" : "explore");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(openedOnPlan ? "plan" : "results");
  const [mobileSheetLevel, setMobileSheetLevel] = useState<MobileSheetLevel>(openedOnPlan ? "half" : "peek");
  const [mobileSheetDragHeight, setMobileSheetDragHeight] = useState<number | null>(null);
  const [mobileSheetDragging, setMobileSheetDragging] = useState(false);
  const [navigationMode, setNavigationMode] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [desktopPanel, setDesktopPanel] = useState<"explore" | "plan">(openedOnPlan ? "plan" : "explore");
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(false);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const [facilityListOpen, setFacilityListOpen] = useState(false);
  // Outlined until the next map operation. It carries the scope it was located
  // in, so a marker id that recurs on another day's map is not outlined there.
  const [locatedFacility, setLocatedFacility] = useState<{ scope: string; key: string } | null>(null);
  // A multi-space event serves one map per day × venue-space, so a map is only
  // the current map while its scope still matches the chosen day and hall. The
  // loaded scope travels with the map and the render reads the pair: switching
  // scope falls back to the loading state instead of leaving the previous
  // floor on screen, which would otherwise pair the old geometry with the new
  // day's booth data and place — or let a reader select — booths at the wrong
  // coordinates until the fetch lands.
  const [loadedMap, setLoadedMap] = useState<{ scopeKey: string; artifactKey: string; map: PublishedEventMap } | null>(null);
  const venueAssignment = useMemo(() => venueAssignmentForVenueSpace(event, venueSpaceId), [event, venueSpaceId]);
  const mapScopeKey = eventUsesScopedMaps(event)
    ? `${String(day)}\0${venueAssignment.venueSpaceId}`
    : eventId;
  const publishedMap = loadedMap?.scopeKey === mapScopeKey ? loadedMap.map : null;
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [offlinePrepOpen, setOfflinePrepOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [textScale, setTextScale] = useState<TextScale>("standard");
  const [planNotice, setPlanNotice] = useState<{ recordId: string; text: string } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const { document: planning, update: updatePlanning, storageError: planningStorageError, favoriteUndo, setFavoriteUndo } = useReaderPlanning();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const floorRef = useRef<HTMLDivElement | null>(null);
  const fullDetailRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<MapGesture | null>(null);
  const mapGestureFrame = useRef<number | null>(null);
  const mobileSheetGesture = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const mobileSheetWasDragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tapStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ x: number; y: number; time: number } | null>(null);
  const facilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const facilityPanelId = useId();
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const fitToolsRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const mobileDockRef = useRef<HTMLElement | null>(null);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);
  const mobileResultsRef = useRef<HTMLDivElement | null>(null);
  const mobileResultScroll = useRef<{ element: HTMLElement; top: number }[]>([]);
  const mobileSummaryRef = useRef<HTMLButtonElement | null>(null);
  const toolsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const rememberMobileResultScroll = useCallback(() => {
    if (!mobileResultsRef.current?.getClientRects().length) return;
    mobileResultScroll.current = [...mobileResultsRef.current.querySelectorAll<HTMLElement>("*")].filter((element) => element.scrollHeight > element.clientHeight && element.clientHeight > 0).map((element) => ({ element, top: element.scrollTop }));
  }, []);
  const detailsRef = useRef<HTMLElement | null>(null);
  const leftRailRef = useRef<HTMLElement | null>(null);
  const desktopTabRef = useRef<HTMLButtonElement | null>(null);
  const planPanelRef = useRef<HTMLDivElement | null>(null);
  const selectionSource = useRef<Element | null>(null);
  const restoreInterrupted = useRef(false);
  const historyIntent = useRef<"replace" | "push">("replace");
  const suppressUrlWrite = useRef(false);
  const lastAutoSelection = useRef("");
  const autoSelectSearch = useRef(false);
  const pendingRestoreCode = useRef<string | null>(null);
  const pendingSelection = useRef<PendingCircleSelection<EventDay> | null>(null);
  const viewport = useMapViewport({
    elements: { map: mapRef, floor: floorRef, tools: toolsRef, fitTools: fitToolsRef, controls: controlsRef, details: detailsRef, mobileDock: mobileDockRef, mobileNav: mobileNavRef },
    publishedMap, scope: mapScopeKey, artifactKey: publishedMap ? loadedMap!.artifactKey : null, desktop, detailsOpen: desktopDetailsOpen,
  });
  const { view: mapView, viewRef: mapViewRef, setView: setMapView, minimum: mapMinZoom, floorHeight, floorWidth, getInset: getFloorInset, position: focusCode, positionPoint, cancelPosition } = viewport;
  const { zoom, offset } = mapView;
  const interruptPosition = useCallback(() => { restoreInterrupted.current = true; cancelPosition(); setLocatedFacility(null); }, [cancelPosition, setLocatedFacility]);
  const facilityDirectory = useMemo(() => publishedMap ? mapFacilityDirectory(publishedMap.layout) : null, [publishedMap]);
  const fontScale = textScale === "extra" ? 1.24 : textScale === "large" ? 1.12 : 1;
  const previousDesktop = useRef<boolean | null>(null);
  useEffect(() => {
    const moveHiddenFocus = () => {
      const rail = leftRailRef.current;
      if (rail?.contains(document.activeElement) && !rail.getClientRects().length) {
        detailsRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      }
    };
    moveHiddenFocus();
    const narrow = window.matchMedia("(min-width:761px) and (max-width:1050px)");
    narrow.addEventListener("change", moveHiddenFocus);
    return () => narrow.removeEventListener("change", moveHiddenFocus);
  }, [desktopDetailsOpen, selectedRecordId]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px)");
    const update = () => {
      if (previousDesktop.current === media.matches) return;
      setDesktop(media.matches);
      mobileSheetGesture.current = null;
      setMobileSheetDragging(false);
      setMobileSheetDragHeight(null);
      if (media.matches) setDesktopDetailsOpen(Boolean(selectedRecordId));
      else if (previousDesktop.current !== null) {
        setMobileWorkspace(desktopPanel);
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
      autoSelectSearch.current = false;
      const { state } = parseEventUrlState(event, window.location.href);
      // The catalog snapshot may still be in flight. Filters restore now; the
      // shared circle/booth selection is resolved once records are available.
      pendingSelection.current = state.selection;
      if (fromHistory) restoreInterrupted.current = false;
      cancelPosition();
      setLocatedFacility(null);
      setFacilityListOpen(false);
      setRestoreVersion((current) => current + 1);
      if (fromHistory) suppressUrlWrite.current = true;
      setDay(state.day);
      setVenueSpaceId(state.venueSpaceId);
      setQuery(state.query);
      setGenre(state.genre);
      setFavoriteOnly(state.favoriteOnly);
      setAdvancedSearch(state.advancedSearch);
      setPlanningDisplay(state.planningDisplay);
      setShowFullDetail(false);
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
    // Arriving from the browse view's 行程 tab there is no selection to show;
    // that first resolution leaves the plan open instead of resetting it.
    if (selected || !keepLandingPanel.current) {
      setMobilePanel(selected ? "details" : "results");
      setMobileSheetLevel(selected ? "half" : "peek");
    }
    keepLandingPanel.current = false;
    setDesktopDetailsOpen(Boolean(selected));
    pendingRestoreCode.current = !restoreInterrupted.current ? selected?.code ?? null : null;
  }, [catalogReady, circleRecords, circleRecordsById, eventId, restoreVersion]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) { setMapLoading(true); setMapError(""); }
    });
    const scope = eventUsesScopedMaps(event)
      ? { periodKey: String(day), venueSpaceId: venueAssignment.venueSpaceId }
      : undefined;
    const scopeKey = mapScopeKey;
    void loadStaticEventMapResource(eventId, scope)
      .then((resource) => { if (!cancelled) setLoadedMap({ scopeKey, ...resource }); })
      // Loader errors are internal English ("Failed to fetch", manifest checks);
      // the reader's only action is to retry, so say that and keep the cause in the console.
      .catch((error) => { if (!cancelled) { console.error(error); setLoadedMap(null); setMapError("retry"); } })
      .finally(() => { if (!cancelled) setMapLoading(false); });
    return () => { cancelled = true; };
  }, [day, event, eventId, venueAssignment, mapScopeKey, mapRetry]);

  // Opening on the plan is a one-time landing; a reload of this entry starts at rest.
  useEffect(() => { if (openedOnPlan) forgetArrivalPanel(); }, [openedOnPlan]);

  useEffect(() => {
    if (!planNotice) return;
    const timeout = window.setTimeout(() => setPlanNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [planNotice]);

  // The tools menu is a bare <details>, so it needs the two exits every menu
  // owes a reader. Closing on an outside press must not steal that press: the
  // map keeps the pan or the tap that happened to dismiss the menu.
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      const menu = toolsMenuRef.current;
      if (!menu?.open || (event.target instanceof Node && menu.contains(event.target))) return;
      menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = toolsMenuRef.current;
      if (event.key !== "Escape" || !menu?.open || !menu.contains(document.activeElement)) return;
      event.stopPropagation();
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, []);

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
      if ((event.target as Element).closest("button, input, select, aside, [data-map-tools], [data-map-overlay]")) return;
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
      eventId: event.id, day, venueSpaceId: venueAssignment.venueSpaceId,
      query, genre, favoriteOnly, advancedSearch, planningDisplay,
      selection: { day, circleId: selected?.circle.id ?? null, boothCode: selected?.code ?? null },
    }, window.location.href);
    const method = historyMethod(historyIntent.current, false);
    if (method === "none") return;
    window.history[method]({ ...window.history.state }, "", url);
    historyIntent.current = "replace";
  }, [advancedSearch, catalogStatus, circleRecordsById, day, event, favoriteOnly, genre, planningDisplay, query, selectedRecordId, urlReady, venueAssignment]);

  const workspace = useMemo(() => projectEventWorkspace({
    event: event,
    records: circleRecords,
    recordsById: circleRecordsById,
    recordsByCircleId: circleRecordsByCircleId,
    planning,
    day,
    venueSpaceId: venueAssignment.venueSpaceId,
    genre,
    query,
    favoriteOnly,
    advancedSearch,
    planningDisplay,
    navigationMode,
    selectedRecordId,
    locale,
  }), [advancedSearch, circleRecords, circleRecordsByCircleId, circleRecordsById, day, event, favoriteOnly, genre, locale, navigationMode, planning, planningDisplay, query, selectedRecordId, venueAssignment]);
  const {
    favorites, favoriteIds, favoriteGroupLabels, dayPlan, plansById, dayRecordsByCircleId,
    selected, selectedFavorite, selectedPlan, selectedMovedDestination, nextRecord, navigationTargetRecord,
    visitedCount, sharedRecords, filtered, resultCircleCount, workTopicSuggestions, matchReasonsByRecordId, genreCounts, markersByCode, slots,
    activeFilterDescriptors,
  } = workspace;
  // The same title and description as the circle's static page: both are
  // built from the circle's reviewed placements.
  const selectedPlacements = selected ? circleRecordsByCircleId.get(selected.circle.id) : undefined;
  useEffect(() => {
    applyReaderMetadata(pageMetadata(event, selected?.circle, selectedPlacements?.map((record) => record.placement), locale));
  }, [event, selected?.circle, selectedPlacements]);
  // A circle on two adjacent booths resolves to its first active record. When the
  // reader already has one of them open, navigating keeps that booth rather than
  // moving the selection and the URL to the sibling.
  const navigationTarget = selected && navigationTargetRecord
    && selected.circle.id === navigationTargetRecord.circle.id
    && selected.day === navigationTargetRecord.day
    && selected.placement.status === "active" ? selected : navigationTargetRecord;

  useEffect(() => {
    const code = pendingRestoreCode.current;
    if (!code || !publishedMap) return;
    pendingRestoreCode.current = null;
    const frame = window.requestAnimationFrame(() => { if (!restoreInterrupted.current) focusCode(code); });
    return () => window.cancelAnimationFrame(frame);
  }, [day, focusCode, publishedMap, selectedRecordId]);

  const selectRecord = useCallback((record: CircleViewRecord, panel: MobilePanel = "details", addHistory = true) => {
    if (addHistory) historyIntent.current = "push";
    setLocatedFacility(null);
    selectionSource.current = document.activeElement;
    rememberMobileResultScroll();
    setDesktopDetailsOpen(true);
    setSelectedRecordId(record.recordId);
    setMobilePanel(panel);
    setMobileSheetLevel("half");
    const destination = venueAssignmentForArea(event, record.hall);
    if (record.day !== day) setDay(record.day);
    if (destination.venueSpaceId !== venueAssignment.venueSpaceId) {
      setVenueSpaceId(destination.venueSpaceId);
    }
    const destinationScope = eventUsesScopedMaps(event) ? `${String(record.day)}\u0000${destination.venueSpaceId}` : eventId;
    focusCode(record.code, destinationScope);
  }, [day, event, eventId, focusCode, rememberMobileResultScroll, setDay, setDesktopDetailsOpen, setLocatedFacility, setSelectedRecordId, setMobilePanel, setMobileSheetLevel, venueAssignment]);

  useEffect(() => {
    const key = `${day}|${venueSpaceId}|${genre}|${favoriteOnly}|${query.trim()}|${filtered[0]?.recordId ?? ""}`;
    if (!autoSelectSearch.current || !query.trim() || filtered.length !== 1 || lastAutoSelection.current === key) return;
    lastAutoSelection.current = key;
    selectRecord(filtered[0], "details", false);
  }, [day, favoriteOnly, filtered, genre, venueSpaceId, query, selectRecord]);

  const changeVenueSpace = (nextVenueSpaceId: string) => {
    historyIntent.current = "push";
    cancelPosition();
    setLocatedFacility(null);
    setFacilityListOpen(false);
    pendingSelection.current = null;
    pendingRestoreCode.current = null;
    setVenueSpaceId(nextVenueSpaceId);
    setSelectedRecordId(null);
    if (mobilePanel === "details") { setMobilePanel(mobileWorkspace === "plan" ? "plan" : "results"); setMobileSheetLevel("peek"); }
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
  };
  const clearResultFilters = () => { historyIntent.current = "push"; setGenre(urlDefaults.genre); setFavoriteOnly(false); setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); setPlanningDisplay(DEFAULT_PLANNING_DISPLAY_FILTERS); };
  const clearFilters = () => { clearResultFilters(); setQuery(""); };
  const resetAdvancedSearch = () => { historyIntent.current = "push"; setAdvancedSearch(DEFAULT_ADVANCED_CIRCLE_SEARCH); };
  const resetMap = () => {
    interruptPosition();
    if (desktop) setDesktopDetailsOpen(false);
    else setMobileSheetLevel("peek");
    viewport.reset();
  };
  const closeDetails = () => {
    if (selected) historyIntent.current = "push";
    autoSelectSearch.current = false;
    pendingSelection.current = null;
    pendingRestoreCode.current = null;
    interruptPosition();
    setSelectedRecordId(null);
    setFocusedCode(null);
    if (!desktop) { setMobilePanel(mobileWorkspace === "plan" ? "plan" : "results"); collapseMobilePanel(); }
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
    if (desktop) requestAnimationFrame(() => {
      const source = selectionSource.current;
      if ((source instanceof HTMLElement || source instanceof SVGElement) && source.isConnected && source.getClientRects().length) source.focus({ preventScroll: true });
      else (selected && mapRef.current?.querySelector<SVGElement>(`[data-slot-code="${CSS.escape(selected.code)}"]`) || desktopTabRef.current)?.focus({ preventScroll: true });
      // Restoring a keyboard location must not announce a cancelled selection.
      // The next deliberate SVG focus move can show its code again.
      setFocusedCode(null);
    });
  };
  const collapseMobilePanel = () => {
    setMobileSheetLevel("peek");
    requestAnimationFrame(() => mobileNavRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus({ preventScroll: true }));
  };
  /** One button step, around the map's centre or a map-local point. */
  const stepZoom = (delta: number, around?: MapPoint) => {
    interruptPosition();
    const viewport = mapRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const point = around ?? { x: viewport.width / 2, y: viewport.height / 2 };
    setMapView((current) => {
      const buttonStep = current.zoom >= 2 ? .25 : .1;
      const nextZoom = clampMapZoom(+(current.zoom + Math.sign(delta) * buttonStep).toFixed(2), mapMinZoom);
      if (nextZoom === current.zoom) return current;
      return { zoom: nextZoom, offset: zoomOffsetAroundPoint(current.offset, current.zoom, nextZoom, point, getFloorInset()) };
    });
  };
  // On a phone the list needs the map's height, so opening it collapses the
  // sheet the way 查看全場 does.
  const toggleFacilityList = () => {
    if (!facilityListOpen && !desktop) setMobileSheetLevel("peek");
    setFacilityListOpen(!facilityListOpen);
  };
  const closeFacilityList = useCallback((returnFocus: boolean) => {
    setFacilityListOpen(false);
    if (returnFocus) facilityTriggerRef.current?.focus({ preventScroll: true });
  }, [setFacilityListOpen]);
  // Moving to a facility keeps the zoom, like moving to a booth, and leaves the
  // booth selection and the URL alone: a facility is somewhere to look, not a
  // circle to share.
  const locateFacility = useCallback((entry: MapFacilityEntry) => {
    restoreInterrupted.current = true;
    closeFacilityList(true);
    setLocatedFacility({ scope: mapScopeKey, key: entry.key });
    positionPoint(entry.point);
  }, [closeFacilityList, mapScopeKey, positionPoint, setLocatedFacility]);
  useEffect(() => {
    if (!desktop && mobileSheetLevel === "full") queueMicrotask(() => setFacilityListOpen(false));
  }, [desktop, mobileSheetLevel]);
  const toggleNavigationMode = () => {
    const enabled = !navigationMode;
    setNavigationMode(enabled);
    if (!enabled) return;
    setDesktopPanel("plan");
    setMobileWorkspace("plan");
    setMobilePanel(navigationTarget ? "details" : "plan");
    setMobileSheetLevel("half");
    if (navigationTarget && venueAssignmentForArea(event, navigationTarget.hall).venueSpaceId === venueAssignment.venueSpaceId) selectRecord(navigationTarget, "details", false);
  };
  const selectMobilePanel = (panel: "results" | "plan") => {
    setMobileWorkspace(panel === "plan" ? "plan" : "explore");
    setDesktopPanel(panel === "plan" ? "plan" : "explore");
    if (mobilePanel === panel && mobileSheetLevel !== "peek") {
      setMobileSheetLevel("peek");
      return;
    }
    setMobilePanel(panel);
    setMobileSheetLevel("half");
  };
  const mobileSheetSnapPoints = () => {
    const dock = mobileDockRef.current;
    const nav = mobileNavRef.current?.getBoundingClientRect().height ?? 64;
    const half = dock?.querySelector<HTMLElement>("[data-half-measure]")?.getBoundingClientRect().height ?? Math.min(window.innerHeight * .44, 420);
    const full = Math.min(window.innerHeight * .82, 760);
    return [
      { level: "peek" as const, height: nav + (mobilePanel === "details" && selected ? MOBILE_SUMMARY_PEEK_HEIGHT : 14) },
      { level: "half" as const, height: half },
      { level: "full" as const, height: full },
    ];
  };
  const handleMobileSheetPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    mobileSheetWasDragged.current = false;
    const startHeight = mobileDockRef.current?.getBoundingClientRect().height ?? 92;
    mobileSheetGesture.current = { pointerId: event.pointerId, startY: event.clientY, startHeight };
    setMobileSheetDragging(true);
  };
  const handleMobileSheetPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = mobileSheetGesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(current.startY - event.clientY) > 4) mobileSheetWasDragged.current = true;
    const points = mobileSheetSnapPoints();
    setMobileSheetDragHeight(Math.max(points[0].height, Math.min(points[points.length - 1].height, current.startHeight + current.startY - event.clientY)));
  };
  const handleMobileSheetPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = mobileSheetGesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const points = mobileSheetSnapPoints();
    const height = event.type === "pointercancel" ? current.startHeight : current.startHeight + current.startY - event.clientY;
    const nearest = points.reduce((best, point) => Math.abs(point.height - height) < Math.abs(best.height - height) ? point : best);
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
    if ((event.target as Element).closest("button, input, select, aside, [data-map-tools], [data-map-overlay]")) return;
    interruptPosition();
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    setMapGestureActive(true);
    const active = [...pointers.current.values()];
    const currentView = mapViewRef.current;
    const inset = getFloorInset();
    tapStart.current = active.length === 1 ? { pointerId: event.pointerId, ...active[0] } : null;
    if (active.length > 1) lastTap.current = null;
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
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointers.current.set(event.pointerId, point);
    const tap = tapStart.current;
    if (tap?.pointerId === event.pointerId && Math.hypot(point.x - tap.x, point.y - tap.y) > MAP_TAP_SLOP) tapStart.current = null;
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
    // Two taps on the empty map zoom in one step around the second tap. Booths,
    // buttons and panels never reach here, so a double tap still selects a booth.
    const tap = tapStart.current;
    tapStart.current = null;
    if (event.type === "pointerup" && tap?.pointerId === event.pointerId) {
      const now = event.timeStamp;
      const previous = lastTap.current;
      if (previous && now - previous.time <= MAP_DOUBLE_TAP_MS && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= MAP_DOUBLE_TAP_DISTANCE) {
        lastTap.current = null;
        stepZoom(1, tap);
      } else lastTap.current = { x: tap.x, y: tap.y, time: now };
    }
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
    onShare: () => setShareOpen(true),
  };
  const fullItineraryPanel = <DayItinerary {...itineraryProps} variant="full" />;
  const planningControls = <PlanningDisplayControls value={planningDisplay} groups={planning.favoriteGroups} onApply={(next) => { historyIntent.current = "push"; setPlanningDisplay(next); }} />;
  const planningPanel = <div className={styles.planningPanel}>{planningControls}{fullItineraryPanel}</div>;
  const resultSetKey = `${day}|${venueSpaceId}|${genre}|${favoriteOnly}|${advancedSearch.creatorType}|${advancedSearch.workTopics.join(",")}|${advancedSearch.workTopicMode}|${advancedSearch.excludedWorkTopics.join(",")}|${advancedSearch.workType}|${advancedSearch.adultContent}|${planningDisplay.favoriteGroupId}|${planningDisplay.visitStatus}|${planningDisplay.sort}|${planningDisplay.density}|${planningDisplay.mediaCount}|${query}`;
  const activeResultFilters: ActiveResultFilter[] = activeFilterDescriptors.map((filter) => ({
    ...filter,
    onClear: () => {
      historyIntent.current = "push";
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
  const resultsPanel = <SearchResults key={resultSetKey} records={filtered} circleCount={resultCircleCount} catalogStatus={catalogStatus} catalogError={catalogError} selectedId={selectedRecordId} favoriteIds={favoriteIds} favoriteGroupLabels={favoriteGroupLabels} plans={plansById} density={planningDisplay.density} mediaCount={planningDisplay.mediaCount} query={query} activeFilters={activeResultFilters} matchReasons={matchReasonsByRecordId} advancedSearchActive={advancedCircleSearchCount(advancedSearch) > 0} onSelect={selectRecord} onToggleFavorite={toggleFavoriteSafely} onResetAdvancedSearch={resetAdvancedSearch} onClearFilters={clearResultFilters} onClearQuery={() => { historyIntent.current = "push"; setQuery(""); }} />;
  const detailActions = {
    onSelectShared: selectRecord,
    onToggleFavorite: () => selected && toggleFavoriteSafely(selected),
    onTogglePlan: () => selected && updatePlanning((current) => selectedPlan ? removeFromVisitPlan(current, eventId, day, selected.circle.id) : addToVisitPlan(current, eventId, day, selected.circle.id)),
    onSetNext: () => selected && updatePlanning((current) => setNextStop(current, eventId, day, selected.circle.id)),
    onUpdateFavorite: (groupId: string | null, memo: string) => selected && updatePlanning((current) => updateFavorite(current, eventId, selected.circle.id, groupId, memo)),
    onCreateGroup: (name: string) => updatePlanning((current) => createFavoriteGroup(current, name)),
  };
  const mobileSummaryIntro = selected ? [selected.circle.work, selected.circle.saleInfo || selected.note].filter(Boolean).join(" · ") : "";
  // Saying "已加入行程" while the write failed would be a lie, so a storage error
  // silences the notice and leaves the error banner to speak.
  const mobileSummaryNotice = selected && planNotice?.recordId === selected.recordId && !planningStorageError ? planNotice.text : "";
  const detailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} movedDestination={selectedMovedDestination} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} compact floating={desktop} onClose={closeDetails} onOpenFull={() => setShowFullDetail(true)} {...detailActions} />;
  const fullDetailsPanel = <CircleDetails record={selected} sharedRecords={sharedRecords} movedDestination={selectedMovedDestination} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} onClose={() => setShowFullDetail(false)} {...detailActions} />;
  const clearFiltersClassName = `${styles.clearFilters} ${genre !== event.genres[0] ? styles.clearFiltersActive : ""}`;
  const mobileFiltersPanel = <section className={styles.mobileFilters} aria-label={t("filtersRegion")}>
    <header><div><b>{t("filtersTitle")}</b></div><button className={clearFiltersClassName} onClick={clearFilters}>{t("clearAll")}</button></header>
    <fieldset><legend>{t("genreLegend")}</legend><div className="genres">{genres.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className="dot" style={categoryDotStyle(genres, value)} />{value === genres[0] ? allCircleCategoriesLabel(locale) : value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset>
    <label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>{t("favoriteOnly")}</b><small>{t("favoriteCount", { count: favorites.length })}</small></span></label>
    <AdvancedCircleSearchControls value={advancedSearch} workSuggestions={workTopicSuggestions} onApply={(next) => { historyIntent.current = "push"; setAdvancedSearch(next); }} />
  </section>;
  const mobileShellStyle = {
    "--mobile-peek-summary": `${MOBILE_SUMMARY_PEEK_HEIGHT}px`,
    ...(mobileSheetDragHeight === null ? {} : { "--mobile-sheet-height": `${mobileSheetDragHeight}px` }),
  } as CSSProperties;
  const mobileSheetActionLabel = mobileSheetLevel === "peek" ? t("sheetExpand") : mobileSheetLevel === "half" ? t("sheetExpandFull") : t("sheetCollapse");
  const mobileSummary = mobilePanel === "details" && Boolean(selected);
  const backToResults = () => {
    setMobileWorkspace("explore"); setDesktopPanel("explore"); setMobilePanel("results"); setMobileSheetLevel("half");
    requestAnimationFrame(() => {
      for (const saved of mobileResultScroll.current) if (saved.element.isConnected) saved.element.scrollTop = saved.top;
      const source = selectionSource.current;
      if (mobileSummary && source instanceof HTMLElement && mobileResultsRef.current?.contains(source)) source.focus({ preventScroll: true });
      else mobileResultsRef.current?.focus({ preventScroll: true });
    });
  };
  const handleMobilePanelFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    setMobileSheetLevel("full");
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "center" })));
  };

  const changeDay = (next: EventDay) => {
    historyIntent.current = "push";
    cancelPosition();
    setLocatedFacility(null);
    setFacilityListOpen(false);
    pendingSelection.current = null;
    pendingRestoreCode.current = null;
    setDay(next);
    setSelectedRecordId(null);
    if (mobilePanel === "details") { setMobilePanel(mobileWorkspace === "plan" ? "plan" : "results"); setMobileSheetLevel("peek"); }
    setDesktopDetailsOpen(false);
    setShowFullDetail(false);
  };
  const navigationButton = <button className={styles.navigationToggle} aria-pressed={navigationMode} onClick={toggleNavigationMode}><UiIcon name="locate" />{navigationMode ? t("navigationExit") : t("navigationStart")}</button>;
  const hintedCode = focusedCode ?? selected?.code ?? null;
  const selectedSlot = !desktop && selected && publishedMap?.layout.rows.flatMap((row) => row.slots).find((slot) => slot.code === selected.code);
  // At the whole-venue zoom a booth is a couple of pixels across, so the marker
  // stays at the booth and the label is free to slide away from the zoom
  // controls instead of being painted under them.
  const selectedMapPoint = selectedSlot && publishedMap ? {
    left: getFloorInset().x + offset.x + (selectedSlot.rect.x + selectedSlot.rect.width / 2) * floorHeight / publishedMap.layout.height * zoom,
    top: getFloorInset().y + offset.y + (selectedSlot.rect.y + selectedSlot.rect.height) * floorHeight / publishedMap.layout.height * zoom,
  } : null;
  const selectedMapPointStyle = selectedMapPoint ? { "--map-selection-left": `${selectedMapPoint.left}px`, top: `${selectedMapPoint.top}px` } as CSSProperties : undefined;
  const renderMapTools = (measurement = false) => <>
    <div className={styles.locationControls}>
      <div className={styles.dateTabs} role="tablist" aria-label={t("eventDays")}>{event.days.map((eventDay, index) => <button key={eventDay.id} role="tab" tabIndex={day === eventDay.id ? 0 : -1} aria-selected={day === eventDay.id} onClick={() => changeDay(eventDay.id)} onKeyDown={(keyEvent) => {
        const target = keyEvent.key === "ArrowRight" ? (index + 1) % event.days.length : keyEvent.key === "ArrowLeft" ? (index + event.days.length - 1) % event.days.length : keyEvent.key === "Home" ? 0 : keyEvent.key === "End" ? event.days.length - 1 : -1;
        if (target < 0) return;
        keyEvent.preventDefault(); changeDay(event.days[target].id);
        (keyEvent.currentTarget.parentElement?.children[target] as HTMLButtonElement)?.focus();
      }}><b>{eventDay.label}</b><span>{dayDate(event, eventDay, locale)}</span></button>)}</div>
      <label className={styles.dateSelect}>{t("date")}<span className={styles.mobileDateLabel} aria-hidden="true">{event.days.find((item) => item.id === day)?.label}{event.days.length > 1 && <UiIcon name="chevron-down" className={styles.mobileDateChevron} />}<small>{(() => { const current = event.days.find((item) => item.id === day); return current ? dayDate(event, current, locale) : null; })()}</small></span><select aria-label={t("eventDays")} value={day} onChange={(change) => changeDay(event.days.find((item) => String(item.id) === change.target.value)!.id)}>{event.days.map((item) => <option key={item.id} value={item.id}>{item.label} · {dayDate(event, item, locale)}</option>)}</select></label>
      {event.venueAssignments.length > 1 ? <label>{t("venue")}<select value={venueAssignment.venueSpaceId} onChange={(change) => changeVenueSpace(change.target.value)}>{event.venueAssignments.map((item) => <option key={item.venueSpaceId} value={item.venueSpaceId}>{item.venueName} · {item.venueSpaceName}</option>)}</select></label> : <span className={styles.venueName}>{event.venue}</span>}

    </div>
    {navigationMode && <div className={styles.navigationBanner} role="status"><span><UiIcon name="locate" /></span><div><b>{t("navigationTitle", { day: String(day) })}</b><small>{t("navigationProgress", { visited: visitedCount, left: Math.max(0, dayPlan.length - visitedCount) })}{navigationTarget ? t("navigationTarget", { code: navigationTarget.code }) : ""}</small></div>{!desktop && <button onClick={toggleNavigationMode}>{t("exit")}</button>}</div>}
        {nextRecord && !navigationMode && <div className="route"><span><UiIcon name="external" /></span><button className={styles.routeMain} onClick={() => selectRecord(nextRecord)}><small>{t("nextStop")}</small><b>{nextRecord.code} · {nextRecord.name}</b></button><button onClick={() => updatePlanning((current) => removeFromVisitPlan(current, eventId, day, nextRecord.circle.id))} aria-label={t("removeNextStop")}>{t("removeFromPlan")}</button></div>}
    <div className={styles.codeHint} aria-live={measurement ? undefined : "polite"}>{hintedCode ? t("selectedCode", { code: hintedCode }) : t("selectHint")}</div>
  </>;

  // Every public page ends its header with the same "登入" (#439, #488).
  const readerLogin = <a className={`site-header-login reader-login ${styles.readerLogin}`} href={localizedHref(publicLoginHref({ eventId }), locale)}>{header("login")}</a>;
  const readerTools = <><div className={styles.textScale} role="group" aria-label={t("textScaleGroup")}><span>{t("textScale")}</span>{(["standard", "large", "extra"] as const).map((value, index) => <button key={value} aria-pressed={textScale === value} aria-label={index === 0 ? t("textScaleStandard") : index === 1 ? t("textScaleLarge") : t("textScaleExtra")} onClick={() => changeTextScale(value)}>{index === 0 ? t("textScaleStandardShort") : index === 1 ? t("textScaleLargeShort") : t("textScaleExtraShort")}</button>)}</div><LanguageSwitcher /><PlanningTools eventId={eventId} />{planningStorageError && <span className={styles.storageError} role="status">{t("storageError")}</span>}<ReaderHelp eventId={eventId} dataLastUpdatedLabel={event.dataLastUpdatedLabel} onCheckOffline={() => setOfflinePrepOpen(true)} /></>;

  // The map as the reader sees it, without a selection: what the switch and the
  // phone's 逛品書 tab carry over into the browse view.
  const readerUrl = serializeEventUrlState(event, {
    eventId, day, venueSpaceId, genre, query, favoriteOnly, advancedSearch, planningDisplay,
    selection: { day, circleId: null, boothCode: null },
  }, typeof window === "undefined" ? "https://event.invalid/" : window.location.href);
  const browseUrl = switchReaderViewUrl(event, readerUrl);
  const eventInfo = <div className={styles.eventInfo}><h1>{event.name}</h1>{desktop && <div className={styles.eventMeta}><span>{eventCalendar(event, locale).label}</span><span>{event.venue}</span></div>}</div>;
  const eventIdentity = onChooseEvent ? <a className={styles.eventLink} href="/" onClick={(click) => {
    if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
    click.preventDefault();
    onChooseEvent();
  }}>{eventInfo}<span className={styles.eventSwitch}>{t("switchEvent")}<UiIcon name="chevron-right" /></span></a> : eventInfo;

  return <main className={`app-shell ${styles.shell}`} style={mobileShellStyle} data-mobile-summary={mobileSummary || undefined} data-text-scale={textScale} data-mobile-sheet-level={mobileSheetLevel} data-mobile-sheet-dragging={mobileSheetDragging || undefined}>
    <header className="topbar">
      <div className="brand"><span aria-hidden="true">場</span><div><b>場刊 Map</b>{desktop && <small>{header("tagline")}</small>}</div></div>
      <div className="event">{eventIdentity}</div>
      <label className="search"><span aria-hidden="true"><UiIcon name="search" /></span><input ref={searchRef} value={query} onChange={(event) => { autoSelectSearch.current = true; if (desktop && !leftRailRef.current?.getClientRects().length) setDesktopDetailsOpen(false); setQuery(event.target.value); setDesktopPanel("explore"); setNavigationMode(false); setMobileWorkspace("explore"); setMobilePanel("results"); setMobileSheetLevel("half"); }} placeholder={t("search")} aria-label={t("search")} />{!desktop && query && <button className={styles.searchClear} onClick={() => { setQuery(""); setNavigationMode(false); setMobileWorkspace("explore"); setMobilePanel("results"); setMobileSheetLevel("half"); searchRef.current?.focus(); }} aria-label={t("clearSearch")}><UiIcon name="close" /></button>}<kbd>⌘ K</kbd></label>
      <ReaderViewTabs className={styles.viewSwitch} event={event} view="map" url={readerUrl} />
      {desktop ? <div className={styles.topbarActions}>{readerTools}{readerLogin}</div> : <><details ref={toolsMenuRef} className={styles.mobileToolsMenu}><summary>{t("tools")}</summary><div>{readerTools}</div></details>{readerLogin}</>}
    </header>
    <div className={`workspace ${styles.workspace}`} data-details-open={desktop && desktopDetailsOpen && Boolean(selected) || undefined}>
      <aside ref={leftRailRef} className={`filters ${styles.leftRail}`}>
        <div className={styles.desktopTabs} role="tablist" aria-label={t("workspaceTabs")}>{(["explore", "plan"] as const).map((panel, index) => <button key={panel} ref={desktopPanel === panel ? desktopTabRef : undefined} id={"desktop-tab-" + panel} role="tab" aria-controls={"desktop-panel-" + panel} aria-selected={desktopPanel === panel} tabIndex={desktopPanel === panel ? 0 : -1} onClick={() => setDesktopPanel(panel)} onKeyDown={(keyEvent) => {
          const next = keyEvent.key === "Home" ? "explore" : keyEvent.key === "End" ? "plan" : ["ArrowLeft", "ArrowRight"].includes(keyEvent.key) ? index === 0 ? "plan" : "explore" : null;
          if (!next) return;
          keyEvent.preventDefault(); setDesktopPanel(next); document.getElementById("desktop-tab-" + next)?.focus();
        }}>{panel === "explore" ? t("explore") : t("planTab", { count: dayPlan.length })}</button>)}</div>
        <div id="desktop-panel-explore" className={styles.explorePanel} role="tabpanel" aria-labelledby="desktop-tab-explore" hidden={desktopPanel !== "explore"}><div className={styles.filterStack}><div className="filter-title"><b>{t("filtersTitle")}</b><button className={clearFiltersClassName} onClick={clearFilters}>{t("clearAll")}</button></div><fieldset><legend>{t("genreLegend")}</legend><div className="genres">{genres.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => { historyIntent.current = "push"; setGenre(value); }}><i className="dot" style={categoryDotStyle(genres, value)} />{value === genres[0] ? allCircleCategoriesLabel(locale) : value}<small>{genreCounts.get(value) ?? 0}</small></button>)}</div></fieldset><label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(event) => { historyIntent.current = "push"; setFavoriteOnly(event.target.checked); }} /><i><UiIcon name="heart" /></i><span><b>{t("favoriteOnly")}</b><small>{t("favoriteCount", { count: favorites.length })}</small></span></label><AdvancedCircleSearchControls value={advancedSearch} workSuggestions={workTopicSuggestions} onApply={(next) => { historyIntent.current = "push"; setAdvancedSearch(next); }} /></div>{resultsPanel}</div>
        <div ref={planPanelRef} id="desktop-panel-plan" className={styles.planPanel} role="tabpanel" aria-labelledby="desktop-tab-plan" hidden={desktopPanel !== "plan"}>{navigationButton}{planningPanel}</div>
      </aside>
      <section className="map-region" aria-label={t("mapRegion")}>
        <div ref={mapRef} className={`map ${styles.mapCanvas}`} data-details-open={desktop && desktopDetailsOpen && Boolean(selected) || undefined} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}>
          <div ref={toolsRef} className={styles.mapTools} data-map-tools>{renderMapTools()}</div>{desktop && <div ref={fitToolsRef} className={`${styles.mapTools} ${styles.fitTools}`} inert aria-hidden="true" data-map-tools>{renderMapTools(true)}</div>}
          {publishedMap ? <div ref={floorRef} className={`floor ${styles.vectorFloor} ${mapGestureActive ? styles.mapGestureActive : ""}`} style={{ width: `${floorWidth}px`, height: `${floorHeight}px`, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}><AccessibleEventMapRenderer eventName={event.name} layout={publishedMap.layout} slots={slots} showMedia={shouldShowMapMedia(zoom)} showAreaRegions={!shouldShowMapMedia(zoom)} areaLabels={Object.fromEntries(event.areas.map((area) => [area.id, area.label]))} labelPresentation={desktop ? { screenScale: floorHeight / publishedMap.layout.height * zoom, targetPx: 12 * fontScale, paddingPx: 2 } : undefined} markerPresentation={{ screenScale: floorHeight / publishedMap.layout.height * zoom, fontScale }} locatedMarker={locatedFacility?.scope === mapScopeKey ? locatedFacility.key : null} onFocusCode={setFocusedCode} onSelect={(code) => { const marker = markersByCode.get(code); if (marker) selectRecord(marker.records[0]); }} /></div> : <div className={styles.mapState}><b>{mapLoading ? t("mapLoading") : t("mapFailed")}</b><span className={mapError ? styles.mapError : ""}>{mapError ? t("mapRetryHint") : t("mapWait")}</span>{!mapLoading && <button onClick={() => setMapRetry((value) => value + 1)}>{t("mapRetry")}</button>}</div>}
          {selectedMapPoint && selected && <><span className={styles.mobileMapMarker} style={selectedMapPoint} aria-hidden="true" /><div className={styles.mobileMapSelection} style={selectedMapPointStyle}><b>{selected.code}</b><span>{selected.name}</span></div></>}
          <div ref={controlsRef} className="controls" data-navigation={desktop && navigationMode || undefined} aria-label={t("zoomControls")}><button type="button" onClick={() => stepZoom(.1)} aria-label={t("zoomIn")}><UiIcon name="plus" /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => stepZoom(-.1)} aria-label={t("zoomOut")}><UiIcon name="minus" /></button><button type="button" className={styles.fitButton} onClick={resetMap} aria-label={t("fitAll")}><UiIcon name="locate" />{!desktop && <span className={styles.fitLabel}>{t("fitAll")}</span>}</button>{facilityDirectory?.entries.length ? <button ref={facilityTriggerRef} type="button" className={styles.facilityTrigger} aria-expanded={facilityListOpen} aria-controls={facilityListOpen ? facilityPanelId : undefined} onClick={toggleFacilityList}>{desktop && <UiIcon name="map-pin" />}{t("facilities")}</button> : null}{desktop && navigationMode && <button className={styles.exitNavigation} onClick={toggleNavigationMode}>{t("navigationExit")}</button>}</div>{facilityListOpen && facilityDirectory?.entries.length ? <MapFacilityPanel id={facilityPanelId} entries={facilityDirectory.entries} legend={facilityDirectory.legend} triggerRef={facilityTriggerRef} onClose={closeFacilityList} onLocate={locateFacility} /> : null}<div className="compass"><small>N</small><UiIcon name="north" /></div>
          {desktop && selected && desktopDetailsOpen && <aside ref={detailsRef} className={styles.rightRail} aria-label={t("detailsRail")} onKeyDownCapture={(keyEvent) => { if (keyEvent.key === "Escape" && !showFullDetail) { keyEvent.stopPropagation(); closeDetails(); } }}><span className={styles.selectionAnnouncement} role="status">{t("detailsUpdated", { code: selected.code, name: selected.name })}</span><button type="button" className={styles.returnToSearch} onClick={closeDetails}>{desktopPanel === "plan" ? t("backToPlan") : t("backToSearch")}</button><div className={styles.detailSlot}>{detailsPanel}</div></aside>}
        </div>
      </section>
      <aside ref={mobileDockRef} className={styles.mobileDock} data-summary={mobileSummary || undefined} data-mobile-sheet-level={mobileSheetLevel} data-dragging={mobileSheetDragging || undefined} aria-label={t("mobileDock")} onKeyDownCapture={(keyEvent) => { if (keyEvent.key === "Escape" && !showFullDetail) { keyEvent.stopPropagation(); if (mobileSummary) closeDetails(); else collapseMobilePanel(); } }}>
        <div className={styles.mobileHalfMeasure} data-half-measure aria-hidden="true" />
          <button type="button" className={styles.mobileSheetHandle} aria-label={mobileSheetActionLabel} aria-expanded={mobileSheetLevel !== "peek"} onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              setMobileSheetLevel((current) => event.key === "ArrowUp" ? current === "peek" ? "half" : "full" : current === "full" ? "half" : "peek");
            }
          }} onClick={toggleMobileSheetLevel} onPointerDown={handleMobileSheetPointerDown} onPointerMove={handleMobileSheetPointerMove} onPointerUp={handleMobileSheetPointerEnd} onPointerCancel={handleMobileSheetPointerEnd}><span aria-hidden="true" /></button>
        {mobileSummary && selected && <button ref={mobileSummaryRef} className={styles.mobilePeekSummary} hidden={mobileSheetLevel !== "peek"} onClick={() => setMobileSheetLevel("half")}><span>{selected.code} · {selected.name}</span></button>}
        <div className={styles.mobileSheetBody} hidden={mobileSheetLevel === "peek"}>
          <div className={styles.mobilePanelHeader}>
            {mobileSummary || mobilePanel === "filters" ? <button onClick={backToResults}><UiIcon name="chevron-left" />{t("backToResults")}</button> : <b>{mobilePanel === "plan" ? t("todayPlan") : t("exploreCount", { count: filtered.length })}</b>}
            {mobileSummary ? <button onClick={closeDetails}>{t("deselect")}<UiIcon name="close" /></button> : <button onClick={collapseMobilePanel}>{t("collapse")}<UiIcon name="arrow-down" /></button>}
          </div>
          {mobileSummary && selected && mobileSheetLevel !== "full" && <section className={styles.mobileSummary} aria-label={t("summaryRegion")}>
            <div className={styles.mobileSummaryTitle}><strong>{selected.code}</strong><h2>{selected.name}</h2></div>
            <p className={styles.mobileSummaryNotice} role="status">{mobileSummaryNotice}</p>
            <p hidden={Boolean(mobileSummaryNotice)}>{selected.placement.status !== "active" ? t("boothChanged") : mobileSummaryIntro ? <>{selected.sources.some((source) => source.contentType === "circle") && t("writtenByCircle")}{mobileSummaryIntro}</> : t("noIntro")}</p>
            <div className={styles.mobileSummaryActions}>
              <button aria-pressed={Boolean(selectedPlan)} onClick={() => { detailActions.onTogglePlan(); setPlanNotice({ recordId: selected.recordId, text: selectedPlan ? t("planRemoved") : t("planAdded") }); }}>{selectedPlan ? t("removePlan") : t("addPlan")}</button>
              <button aria-pressed={Boolean(selectedFavorite)} onClick={detailActions.onToggleFavorite}>{selectedFavorite ? t("favorited") : t("favorite")}</button>
              <button onClick={() => { setMobileSheetLevel("full"); requestAnimationFrame(() => mobileDockRef.current?.querySelector<HTMLButtonElement>(`button.${styles.mobileSheetHandle}`)?.focus({ preventScroll: true })); }}>{selected.placement.status === "active" ? t("fullInfo") : t("statusFullInfo", { status: placementStatusLabel(selected.placement.status, locale) })}</button>
            </div>
          </section>}
          {mobileSummary && mobileSheetLevel === "full" && <div className={styles.mobilePanel} onFocusCapture={handleMobilePanelFocus}><CircleDetails record={selected} sharedRecords={sharedRecords} movedDestination={selectedMovedDestination} favorite={selectedFavorite} plan={selectedPlan} groups={planning.favoriteGroups} embedded onClose={closeDetails} {...detailActions} /></div>}
          <div ref={mobileResultsRef} className={styles.mobilePanel} hidden={mobilePanel !== "results" && !(mobilePanel === "details" && !selected)} tabIndex={-1} aria-label={t("exploreResults")} onFocusCapture={handleMobilePanelFocus}><button className={styles.mobileFilterButton} onClick={() => { rememberMobileResultScroll(); setMobilePanel("filters"); }}>{activeResultFilters.length > 0 ? t("filterCount", { count: activeResultFilters.length }) : t("filtersTitle")}</button>{resultsPanel}</div>
          <div className={styles.mobilePanel} hidden={mobilePanel !== "filters"} onFocusCapture={handleMobilePanelFocus}>{mobileFiltersPanel}</div>
          <div key={day} className={styles.mobilePanel} hidden={mobilePanel !== "plan"} onFocusCapture={handleMobilePanelFocus}>{navigationButton}{planningPanel}</div>
        </div>
        <div ref={mobileNavRef} className={styles.mobileTabs} role="group" aria-label={t("mobileWorkspace")}>
          <button className={tabStyles.tab} aria-pressed={mobileWorkspace === "explore"} aria-expanded={!mobileSummary && mobilePanel !== "plan" && mobileSheetLevel !== "peek"} onClick={() => selectMobilePanel("results")}><UiIcon name="search" /><span>{t("explore")}</span></button>
          <button className={tabStyles.tab} aria-pressed={mobileWorkspace === "plan"} aria-expanded={mobilePanel === "plan" && mobileSheetLevel !== "peek"} onClick={() => selectMobilePanel("plan")}><UiIcon name="check-square" /><span>{t("plan")}{dayPlan.length > 0 && <small>{dayPlan.length}</small>}</span></button>
          <a className={tabStyles.tab} href={browseUrl.toString()} onClick={(pressed) => {
            if (!ordinaryLinkClick(pressed)) return;
            pressed.preventDefault();
            navigateReader(browseUrl);
          }}><UiIcon name="book" /><span>{t("browse")}</span></a>
        </div>
      </aside>
    </div>
    {favoriteUndo && <div className={styles.undoToast} role="status"><span>{t("unfavorited", { name: favoriteUndo.circleName })}</span><button onClick={() => { updatePlanning((current) => restoreFavorite(current, favoriteUndo.favorite)); setFavoriteUndo(null); }}>{t("restoreFavorite")}</button><button onClick={() => setFavoriteUndo(null)} aria-label={t("closeUndo")}><UiIcon name="close" /></button></div>}
    {/* Keyed on the scope: a day or venue change (e.g. browser Back) starts a fresh check, and an earlier day's result cannot land on it. */}
    {offlinePrepOpen && <OfflinePrepDialog key={`${eventId} ${String(day)} ${venueAssignment.venueSpaceId}`} event={event} day={day} venueSpaceId={venueAssignment.venueSpaceId} onClose={() => setOfflinePrepOpen(false)} />}
    {shareOpen && <ShareItineraryDialog eventId={eventId} document={planning} onClose={() => setShareOpen(false)} />}
    {showFullDetail && selected && createPortal(<div className={styles.fullDetailBackdrop} style={{ "--ui-font-scale": textScale === "extra" ? 1.24 : textScale === "large" ? 1.12 : 1 } as CSSProperties} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setShowFullDetail(false); } }}><div ref={fullDetailRef} className={styles.fullDetailDialog} role="dialog" aria-modal="true" aria-label={t("fullDetail", { name: selected.name })} tabIndex={-1}>{fullDetailsPanel}</div></div>, document.body)}
  </main>;
}
