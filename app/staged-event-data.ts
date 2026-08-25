import { isCircleCatalogPayload } from "./circle-records";
import { parseEventDefinition } from "./event-catalog";
import { isPublishedEventMap } from "./event-map";
import { validateMapTemplateLayout } from "./map-template-registry";

export function validateStagedEventArtifacts(eventValue: unknown, referenceValue: unknown, catalogValue: unknown, mapValue: unknown, eventId: string) {
  const event = parseEventDefinition(eventValue, referenceValue);
  if (event.id !== eventId) throw new Error(`Staged event identity mismatch: expected ${eventId}, got ${event.id}.`);
  if (event.venueAssignments.length > 1) {
    throw new Error("Per-space published map artifacts are required before staging a multi-space event.");
  }
  if (catalogValue && typeof catalogValue === "object" && Array.isArray((catalogValue as { placements?: unknown }).placements)) {
    const placementIds = (catalogValue as { placements: Array<{ id?: unknown }> }).placements.map((placement) => placement?.id);
    if (new Set(placementIds).size !== placementIds.length) throw new Error("Staged catalog contains duplicate placement ids.");
  }
  if (!isCircleCatalogPayload(catalogValue) || catalogValue.eventId !== eventId) {
    throw new Error("Staged circle catalog is not a valid non-empty official-only v3 payload.");
  }
  const retiredFields = ["booths", "templates", "officialSupplementKeys", "sourceRow"];
  if (retiredFields.some((key) => Object.hasOwn(catalogValue, key))) throw new Error("Staged catalog still contains a retired workbook-era field.");
  if (!isPublishedEventMap(mapValue) || mapValue.eventId !== eventId) throw new Error("Staged map is not a valid published event map.");
  if (mapValue.layout.template !== event.mapTemplate) {
    throw new Error(`Staged map template ${mapValue.layout.template} does not match event template ${event.mapTemplate}.`);
  }
  const mapValidation = validateMapTemplateLayout(event.mapTemplate, mapValue.layout);
  if (!mapValidation.ok) throw new Error(`Staged map failed ${event.mapTemplate} validation: ${mapValidation.errors.join("; ")}`);
  return { event, catalog: catalogValue, map: mapValue };
}
