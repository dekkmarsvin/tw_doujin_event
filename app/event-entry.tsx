import CatalogBrowseApp from "./catalog-browse-app";
import { readerView } from "./catalog-browse-url";
import { READER_NAVIGATION_EVENT } from "./reader-navigation";
import { ReaderPlanningProvider } from "./reader-planning";
import { useCircleCatalog } from "./use-circle-catalog";
import { useCallback, useEffect, useState } from "react";
import EventChooser from "./event-chooser";
import EventMapApp from "./event-map-app";
import { applyReaderMetadata, pageMetadata } from "./seo";
import { PUBLISHED_EVENTS, type EventDefinition } from "./event-catalog";
import { resolveUrlEvent, type ResolvedUrlEvent } from "./event-url-state";

const resolve = (): ResolvedUrlEvent => resolveUrlEvent(
  PUBLISHED_EVENTS,
  typeof window === "undefined" ? "https://event.invalid/" : window.location.href,
);

/**
 * Decides which event the reader is looking at, before the map exists.
 *
 * The URL stays the authority: choosing an event writes `?event=<id>` and the
 * resolution runs again, so back and forward move between the chooser and an
 * event the same way they move within one. `EventMapApp` is keyed by event id
 * because it seeds its state from the event it was given.
 */
export default function EventEntry() {
  const [view, setView] = useState(() => readerView(new URL(typeof window === "undefined" ? "https://event.invalid/" : window.location.href)));
  const [resolved, setResolved] = useState<ResolvedUrlEvent>(resolve);

  useEffect(() => {
    // EventMapApp owns valid event/selection metadata after catalog resolution.
    if (resolved.kind !== "event") applyReaderMetadata(pageMetadata(), resolved.kind === "unpublished");
  }, [resolved]);

  useEffect(() => {
    const onPopState = () => {
      setView(readerView(new URL(window.location.href)));
      setResolved((current) => {
        const next = resolve();
        // Within one event the app owns the URL, and re-resolving to the same
        // event must not remount it and throw away where the reader was.
        const sameEvent = current.kind === "event" && next.kind === "event" && current.event.id === next.event.id;
        return sameEvent ? current : next;
      });
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener(READER_NAVIGATION_EVENT, onPopState);
    return () => { window.removeEventListener("popstate", onPopState); window.removeEventListener(READER_NAVIGATION_EVENT, onPopState); };
  }, []);

  const selectEvent = useCallback((event: EventDefinition) => {
    const url = new URL(window.location.href);
    url.searchParams.set("event", event.id);
    // A push, not a replace: the chooser is where back should return to.
    window.history.pushState({}, "", url);
    setView(readerView(url));
    setResolved({ kind: "event", event });
  }, []);

  const chooseEvent = useCallback(() => {
    // Return to a clean chooser even when arriving through an external deep link.
    window.history.pushState({}, "", window.location.pathname);
    setResolved({ kind: "choose" });
  }, []);

  if (resolved.kind === "event") return <EventReader key={resolved.event.id} view={view} event={resolved.event} onChooseEvent={PUBLISHED_EVENTS.length > 1 ? chooseEvent : undefined} />;
  return <EventChooser
    events={PUBLISHED_EVENTS}
    unresolved={resolved.kind === "unpublished" ? resolved.requested : null}
    onSelect={selectEvent}
  />;
}

function EventReader({ event, view, onChooseEvent }: { event: EventDefinition; view: "map" | "browse"; onChooseEvent?: () => void }) {
  const catalog = useCircleCatalog(event.id);
  return <ReaderPlanningProvider eventId={event.id} settled={catalog.status !== "loading"}>
    {view === "browse" ? <CatalogBrowseApp event={event} onChooseEvent={onChooseEvent} /> : <EventMapApp event={event} onChooseEvent={onChooseEvent} />}
  </ReaderPlanningProvider>;
}
