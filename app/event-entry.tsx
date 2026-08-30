import { useCallback, useEffect, useState } from "react";
import EventChooser from "./event-chooser";
import EventMapApp from "./event-map-app";
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
  const [resolved, setResolved] = useState<ResolvedUrlEvent>(resolve);

  useEffect(() => {
    const onPopState = () => {
      setResolved((current) => {
        const next = resolve();
        // Within one event the app owns the URL, and re-resolving to the same
        // event must not remount it and throw away where the reader was.
        const sameEvent = current.kind === "event" && next.kind === "event" && current.event.id === next.event.id;
        return sameEvent ? current : next;
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectEvent = useCallback((event: EventDefinition) => {
    const url = new URL(window.location.href);
    url.searchParams.set("event", event.id);
    // A push, not a replace: the chooser is where back should return to.
    window.history.pushState({}, "", url);
    setResolved({ kind: "event", event });
  }, []);

  if (resolved.kind === "event") return <EventMapApp key={resolved.event.id} event={resolved.event} />;
  return <EventChooser
    events={PUBLISHED_EVENTS}
    unresolved={resolved.kind === "unpublished" ? resolved.requested : null}
    onSelect={selectEvent}
  />;
}
