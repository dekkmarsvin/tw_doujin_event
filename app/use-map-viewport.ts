"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PublishedEventMap } from "./event-map";
import { availableMapRect, mobileAvailableMapRect, fitMapInRect, MOBILE_SUMMARY_PEEK_HEIGHT, offsetMapPointInRect, resizeMapView, type MapRect, type MapView } from "./map-viewport";

type ElementRef = RefObject<HTMLElement | null>;
type ViewportElements = {
  map: ElementRef;
  floor: ElementRef;
  tools: ElementRef;
  fitTools: ElementRef;
  controls: ElementRef;
  details: ElementRef;
  mobileDock: ElementRef;
  mobileNav: ElementRef;
};

/** Owns DOM geometry and one-shot positioning; renderer only receives scale. */
export function useMapViewport({ elements, publishedMap, scope, artifactKey, desktop, detailsOpen }: {
  elements: ViewportElements;
  publishedMap: PublishedEventMap | null;
  scope: string;
  artifactKey: string | null;
  desktop: boolean;
  detailsOpen: boolean;
}) {
  const [view, setViewState] = useState<MapView>({ zoom: .8, offset: { x: 0, y: 0 } });
  const [minimum, setMinimum] = useState(0);
  const viewRef = useRef(view);
  const fittedScope = useRef<string | null>(null);
  const geometry = useRef<{ width: number; height: number; fitWidth: number; windowWidth: number; inset: { x: number; y: number }; fit: MapView } | null>(null);
  // A booth is looked up by code once the map for its scope is on screen; a
  // facility is already a layout point on the current map.
  const pending = useRef<{ scope: string } & ({ code: string } | { point: { x: number; y: number } }) | null>(null);
  const [request, setRequest] = useState(0);
  const fittedKey = `${artifactKey}|${publishedMap?.revision ?? "pending"}`;
  const floorHeight = 950;
  const floorWidth = publishedMap ? floorHeight * publishedMap.layout.width / publishedMap.layout.height : 1344;
  const { map, floor, tools, fitTools, controls, details, mobileDock, mobileNav } = elements;
  const getInset = useCallback(() => ({ x: floor.current?.offsetLeft ?? 0, y: floor.current?.offsetTop ?? 0 }), [floor]);
  const setView = useCallback((next: MapView | ((current: MapView) => MapView)) => {
    const resolved = typeof next === "function" ? next(viewRef.current) : next;
    viewRef.current = resolved;
    setViewState(resolved);
  }, []);
  const cancelPosition = useCallback(() => { pending.current = null; }, []);
  const position = useCallback((code: string, requestedScope = scope) => {
    pending.current = { code, scope: requestedScope };
    setRequest((current) => current + 1);
  }, [scope]);
  const positionPoint = useCallback((point: { x: number; y: number }) => {
    pending.current = { point, scope };
    setRequest((current) => current + 1);
  }, [scope]);

  const measure = useCallback((forFit: boolean) => {
    const viewport = map.current?.getBoundingClientRect();
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
    const local = (element: HTMLElement | null): MapRect | undefined => {
      if (!element || !element.getClientRects().length) return undefined;
      const rect = element.getBoundingClientRect();
      return { x: rect.left - viewport.left, y: rect.top - viewport.top, width: rect.width, height: rect.height };
    };
    // Fixed mobile controls keep the same horizontal reservation even when a
    // full workspace hides them. Sheet height must never change the fit floor.
    const mobileControls = !desktop && controls.current ? getComputedStyle(controls.current) : null;
    const fitControlLeft = viewport.width - (Number.parseFloat(mobileControls?.right ?? "") || 12) - (Number.parseFloat(mobileControls?.width ?? "") || 64);
    // A narrow desktop temporarily lends the search column to the map.
    // Fit still uses the search-visible width, so selecting/closing a circle
    // cannot change zoom or count as a window resize.
    const reserve = forFit && desktop ? Number.parseFloat(getComputedStyle(map.current!).getPropertyValue("--fit-width-reserve")) || 0 : 0;
    const size = { width: viewport.width - reserve, height: viewport.height };
    const rect = desktop ? availableMapRect(size, {
      top: local(forFit ? fitTools.current : tools.current),
      bottom: local(controls.current),
      detail: !forFit && detailsOpen ? local(details.current) : undefined,
    }) : mobileAvailableMapRect(viewport, {
      top: local(tools.current),
      bottom: forFit ? { x: 0, y: viewport.height - (mobileNav.current?.getBoundingClientRect().height ?? 64) - MOBILE_SUMMARY_PEEK_HEIGHT, width: viewport.width, height: 0 } : local(mobileDock.current),
      controls: forFit ? { x: fitControlLeft, y: 0, width: 0, height: 0 } : local(controls.current),
    });
    return { viewport, fitWidth: size.width, rect };
  }, [controls, desktop, details, detailsOpen, fitTools, map, mobileDock, mobileNav, tools]);

  const getFit = useCallback(() => {
    if (!publishedMap) return null;
    const bounds = measure(true);
    if (!bounds) return null;
    const size = { width: floorWidth, height: floorHeight };
    const inset = getInset();
    const fit = fitMapInRect(bounds.rect, size, inset);
    return fit ? { width: bounds.viewport.width, height: bounds.viewport.height, fitWidth: bounds.fitWidth, windowWidth: window.innerWidth, inset, fit } : null;
  }, [floorWidth, getInset, measure, publishedMap]);

  const reset = useCallback(() => {
    cancelPosition();
    const next = getFit();
    if (!next) return;
    geometry.current = next;
    fittedScope.current = fittedKey;
    setMinimum(next.fit.zoom);
    setView(next.fit);
  }, [cancelPosition, fittedKey, getFit, setView]);

  useLayoutEffect(() => {
    if (!publishedMap) return;
    let frame: number | null = null;
    const update = () => {
      const next = getFit();
      if (!next) return;
      const previous = geometry.current;
      const first = fittedScope.current !== fittedKey;
      // Ignore the borrowed search-column width when detecting a resize, but
      // retain the actual viewport below to preserve its center on real resizes.
      // Across the breakpoint, different window sizes can have equal fit widths.
      const resized = !previous || next.windowWidth !== previous.windowWidth || next.fitWidth !== previous.fitWidth || next.height !== previous.height || Math.abs(next.fit.zoom - previous.fit.zoom) > .00001;
      geometry.current = next;
      setMinimum(next.fit.zoom);
      if (first || resized) {
        const current = viewRef.current;
        const atFit = previous && Math.abs(current.zoom - previous.fit.zoom) < .006;
        setView(first || atFit || !previous ? next.fit : resizeMapView(current, previous, next, next.fit.zoom, next.inset, previous.inset));
        fittedScope.current = fittedKey;
      }
      const target = pending.current;
      if (!target || target.scope !== scope) return;
      const bounds = measure(false);
      if (!bounds || bounds.rect.width <= 0 || bounds.rect.height <= 0) return;
      const slot = "code" in target ? publishedMap.layout.rows.flatMap((row) => row.slots).find((item) => item.code === target.code) : undefined;
      const point = "point" in target ? target.point : slot && { x: slot.rect.x + slot.rect.width / 2, y: slot.rect.y + slot.rect.height / 2 };
      pending.current = null;
      if (!point) return;
      const scale = floorHeight / publishedMap.layout.height;
      setView((current) => ({ ...current, offset: offsetMapPointInRect({ x: point.x * scale, y: point.y * scale }, bounds.rect, current.zoom, getInset()) }));
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    for (const ref of [map, tools, fitTools, controls, details, mobileDock, mobileNav]) if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [controls, details, fittedKey, fitTools, getFit, getInset, map, measure, mobileDock, mobileNav, publishedMap, request, scope, setView, tools]);

  return { view, viewRef, setView, minimum, floorWidth, floorHeight, getInset, position, positionPoint, cancelPosition, reset };
}
