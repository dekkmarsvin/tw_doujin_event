"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PublishedEventMap } from "./event-map";
import { availableMapRect, calculateMapFitZoom, centerMapOffset, fitMapInRect, offsetMapPointInRect, resizeMapView, type MapRect, type MapView } from "./map-viewport";

type ElementRef = RefObject<HTMLElement | null>;
type ViewportElements = {
  map: ElementRef;
  floor: ElementRef;
  tools: ElementRef;
  fitTools: ElementRef;
  controls: ElementRef;
  details: ElementRef;
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
  const geometry = useRef<{ width: number; height: number; inset: { x: number; y: number }; fit: MapView } | null>(null);
  const pending = useRef<{ code: string; scope: string } | null>(null);
  const [request, setRequest] = useState(0);
  const fittedKey = `${artifactKey}|${publishedMap?.revision ?? "pending"}`;
  const floorHeight = 950;
  const floorWidth = publishedMap ? floorHeight * publishedMap.layout.width / publishedMap.layout.height : 1344;
  const { map, floor, tools, fitTools, controls, details } = elements;
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

  const measure = useCallback((forFit: boolean) => {
    const viewport = map.current?.getBoundingClientRect();
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
    const local = (element: HTMLElement | null): MapRect | undefined => {
      if (!element || !element.getClientRects().length) return undefined;
      const rect = element.getBoundingClientRect();
      return { x: rect.left - viewport.left, y: rect.top - viewport.top, width: rect.width, height: rect.height };
    };
    const rect = desktop ? availableMapRect(viewport, {
      top: local(forFit ? fitTools.current : tools.current),
      bottom: local(controls.current),
      detail: !forFit && detailsOpen ? local(details.current) : undefined,
    }) : { x: 0, y: 0, width: viewport.width, height: viewport.height };
    return { viewport, rect };
  }, [controls, desktop, details, detailsOpen, fitTools, map, tools]);

  const getFit = useCallback(() => {
    if (!publishedMap) return null;
    const bounds = measure(true);
    if (!bounds) return null;
    const size = { width: floorWidth, height: floorHeight };
    const inset = getInset();
    const zoom = calculateMapFitZoom(bounds.viewport, size);
    const fit = desktop ? fitMapInRect(bounds.rect, size, inset) : { zoom, offset: centerMapOffset(bounds.viewport, size, zoom, inset) };
    return fit ? { width: bounds.viewport.width, height: bounds.viewport.height, inset, fit } : null;
  }, [desktop, floorWidth, getInset, measure, publishedMap]);

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
      const resized = !previous || next.width !== previous.width || next.height !== previous.height || Math.abs(next.fit.zoom - previous.fit.zoom) > .00001;
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
      const slot = publishedMap.layout.rows.flatMap((row) => row.slots).find((item) => item.code === target.code);
      pending.current = null;
      if (!slot) return;
      const scale = floorHeight / publishedMap.layout.height;
      setView((current) => ({ ...current, offset: offsetMapPointInRect({ x: (slot.rect.x + slot.rect.width / 2) * scale, y: (slot.rect.y + slot.rect.height / 2) * scale }, bounds.rect, current.zoom, getInset()) }));
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    for (const ref of [map, tools, fitTools, controls, details]) if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [controls, details, fittedKey, fitTools, getFit, getInset, map, measure, publishedMap, request, scope, setView, tools]);

  return { view, viewRef, setView, minimum, floorWidth, floorHeight, getInset, position, cancelPosition, reset };
}
