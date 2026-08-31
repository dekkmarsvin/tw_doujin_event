export const EVENT_MAP_MANIFEST_SCHEMA = "event-map-manifest/1" as const;

export type EventMapManifestEntry = {
  periodKey: string;
  venueSpaceId: string;
  path: string;
};

export type EventMapManifest = {
  schema: typeof EVENT_MAP_MANIFEST_SCHEMA;
  eventId: string;
  maps: EventMapManifestEntry[];
};

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function eventMapArtifactPath(periodKey: string, venueSpaceId: string) {
  if (!SAFE_SEGMENT.test(periodKey) || !SAFE_SEGMENT.test(venueSpaceId)) {
    throw new Error("Map scope contains an unsafe path segment.");
  }
  return `maps/${periodKey}/${venueSpaceId}.json`;
}

export function parseEventMapManifest(value: unknown, expectedEventId?: string): EventMapManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Map manifest must be an object.");
  const candidate = value as Partial<EventMapManifest>;
  if (candidate.schema !== EVENT_MAP_MANIFEST_SCHEMA || typeof candidate.eventId !== "string" || !candidate.eventId) {
    throw new Error("Map manifest schema or eventId is invalid.");
  }
  if (expectedEventId && candidate.eventId !== expectedEventId) throw new Error("Map manifest eventId does not match the event.");
  if (!Array.isArray(candidate.maps) || candidate.maps.length === 0) throw new Error("Map manifest must list at least one map.");
  const seen = new Set<string>();
  const maps = candidate.maps.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Map manifest entry is invalid.");
    const map = entry as Partial<EventMapManifestEntry>;
    if (typeof map.periodKey !== "string" || typeof map.venueSpaceId !== "string" || typeof map.path !== "string") {
      throw new Error("Map manifest scope is invalid.");
    }
    const expectedPath = eventMapArtifactPath(map.periodKey, map.venueSpaceId);
    if (map.path !== expectedPath) throw new Error(`Map manifest path must be ${expectedPath}.`);
    const key = `${map.periodKey}\0${map.venueSpaceId}`;
    if (seen.has(key)) throw new Error("Map manifest contains a duplicate scope.");
    seen.add(key);
    return { periodKey: map.periodKey, venueSpaceId: map.venueSpaceId, path: map.path };
  });
  return { schema: EVENT_MAP_MANIFEST_SCHEMA, eventId: candidate.eventId, maps };
}
