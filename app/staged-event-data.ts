import { isCircleCatalogPayload } from "./circle-records";
import { eventUsesScopedMaps, parseEventDefinition } from "./event-catalog";
import { isPublishedEventMap } from "./event-map";
import { validateMapTemplateLayout } from "./map-template-registry";
import { parseEventMapManifest } from "./event-map-manifest";

type ScopedMapArtifacts = { manifest: unknown; maps: ReadonlyMap<string, unknown> };

export function validateStagedEventArtifacts(eventValue: unknown, referenceValue: unknown, catalogValue: unknown, mapValue: unknown | ScopedMapArtifacts, eventId: string) {
  const event = parseEventDefinition(eventValue, referenceValue);
  if (event.id !== eventId) throw new Error(`Staged event identity mismatch: expected ${eventId}, got ${event.id}.`);
  if (catalogValue && typeof catalogValue === "object" && Array.isArray((catalogValue as { placements?: unknown }).placements)) {
    const placementIds = (catalogValue as { placements: Array<{ id?: unknown }> }).placements.map((placement) => placement?.id);
    if (new Set(placementIds).size !== placementIds.length) throw new Error("Staged catalog contains duplicate placement ids.");
  }
  if (!isCircleCatalogPayload(catalogValue) || catalogValue.eventId !== eventId) {
    throw new Error("Staged circle catalog is not a valid non-empty official-only v3 payload.");
  }
  const retiredFields = ["booths", "templates", "officialSupplementKeys", "sourceRow"];
  if (retiredFields.some((key) => Object.hasOwn(catalogValue, key))) throw new Error("Staged catalog still contains a retired workbook-era field.");
  const validateMap = (value: unknown, scope: string) => {
    if (!isPublishedEventMap(value) || value.eventId !== eventId) throw new Error(`Staged map ${scope} is not a valid published event map.`);
    if (value.layout.template !== event.mapTemplate) {
      throw new Error(`Staged map template ${value.layout.template} does not match event template ${event.mapTemplate}.`);
    }
    const validation = validateMapTemplateLayout(event.mapTemplate, value.layout);
    if (!validation.ok) throw new Error(`Staged map ${scope} failed ${event.mapTemplate} validation: ${validation.errors.join("; ")}`);
    return value;
  };
  const scoped = mapValue && typeof mapValue === "object" && "manifest" in mapValue && "maps" in mapValue
    && (mapValue as ScopedMapArtifacts).maps instanceof Map
    ? mapValue as ScopedMapArtifacts
    : null;
  /* One hall on one day has nothing to scope. One hall across several days may
   * be re-laid out overnight, so it *may* ship a manifest -- but every event
   * published before scoped maps existed still ships a single map.json and has
   * to keep loading, so there the manifest is optional and its absence means
   * the one layout covers every day. More than one hall keeps the original
   * rule, and with it the original fail-closed guarantee: manifest or nothing. */
  if (!scoped) {
    if (event.venueAssignments.length > 1) throw new Error("Multi-space staged event requires scoped map artifacts.");
    const map = validateMap(mapValue, "map.json");
    return { event, catalog: catalogValue, map };
  }
  if (!eventUsesScopedMaps(event)) throw new Error("A single-day single-space staged event must publish one map.json.");
  const manifest = parseEventMapManifest(scoped.manifest, eventId);
  const expected = new Set(event.days.flatMap((day) => event.venueAssignments.map((assignment) => `${String(day.id)}\0${assignment.venueSpaceId}`)));
  const actual = new Set(manifest.maps.map((entry) => `${entry.periodKey}\0${entry.venueSpaceId}`));
  if (expected.size !== actual.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error("Map manifest must cover every event day and venue-space exactly once.");
  }
  const maps = manifest.maps.map((entry) => validateMap(scoped.maps.get(entry.path), entry.path));
  return { event, catalog: catalogValue, map: maps[0], maps, manifest };
}
