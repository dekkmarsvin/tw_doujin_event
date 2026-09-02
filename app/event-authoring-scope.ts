import type { OrganizerEventDraft } from "./organizer-event";
import { eventUsesScopedMaps, type EventDefinition } from "./event-catalog";
import { eventMapArtifactPath } from "./event-map-manifest";

type ImportedPlacement = { dayId: string; venueSpaceId: string; boothCode: string };

export type CandidateAuthoringScope = {
  kind: "candidate";
  candidateId: string;
  eventId: string | null;
  periodKey: string;
  venueSpaceId: string;
  mapTemplate: string;
  allowedBoothCodes: string[];
  requiredBoothCodes: string[];
  /** Whether this scope expects booths that no circle occupies. See
   * `MapContributionScope` for why the answer differs by scope kind. */
  allowsUnallocatedBooths: boolean;
  /** Candidate assets have no anonymous filesystem address. */
  targetPath: null;
};

export type PublishedAuthoringScope = Omit<CandidateAuthoringScope, "kind" | "candidateId" | "targetPath"> & {
  kind: "published";
  eventId: string;
  targetPath: string;
};

export type EventAuthoringScope = CandidateAuthoringScope | PublishedAuthoringScope;

/** The resolver is the single seam between D1 candidates and static published
 * events. Candidate maps cannot accidentally acquire a public target path. */
export function resolveCandidateAuthoringScope(input: {
  candidateId: string;
  draft: OrganizerEventDraft;
  importedRows: readonly ImportedPlacement[];
}, requestedPeriodKey: string, requestedVenueSpaceId: string): CandidateAuthoringScope | null {
  const period = input.draft.event.days.find(({ id }) => id === requestedPeriodKey);
  const assignment = input.draft.venue.assignments.find(({ venueSpaceId }) => venueSpaceId === requestedVenueSpaceId);
  if (!period || !assignment) return null;
  const boothCodes = [...new Set(input.importedRows
    .filter((row) => row.dayId === period.id && row.venueSpaceId === assignment.venueSpaceId)
    .map((row) => row.boothCode))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return {
    kind: "candidate", candidateId: input.candidateId, eventId: input.draft.event.id,
    periodKey: period.id, venueSpaceId: assignment.venueSpaceId, mapTemplate: assignment.mapTemplate,
    allowedBoothCodes: boothCodes, requiredBoothCodes: boothCodes,
    // The first map of an event is traced from the official plan, and a plan
    // shows every booth on the floor -- including the ones nobody bought, which
    // no import row can name. There is no reviewed snapshot to vouch for them
    // yet, so this is the one scope that has to take the tracer's word for it.
    allowsUnallocatedBooths: true,
    targetPath: null,
  };
}

/** An event day id is only required to be a non-empty string or a number, so it
 * can hold characters no file path may carry. A scope whose artifact has no
 * representable path is a scope that cannot be resolved -- the same answer as an
 * unknown day -- rather than a throw out of a request handler. */
function artifactPathOrNull(periodKey: string, venueSpaceId: string) {
  try {
    return eventMapArtifactPath(periodKey, venueSpaceId);
  } catch {
    return null;
  }
}

export function resolvePublishedAuthoringScope(input: {
  event: EventDefinition;
  placements: readonly { day: string | number; area: string; boothCode: string; status?: string }[];
  existingBoothCodes?: readonly string[];
}, requestedPeriodKey: string, requestedVenueSpaceId: string): PublishedAuthoringScope | null {
  const period = input.event.days.find(({ id }) => String(id) === requestedPeriodKey);
  const assignment = input.event.venueAssignments.find(({ venueSpaceId }) => venueSpaceId === requestedVenueSpaceId);
  if (!period || !assignment) return null;
  const targetPath = eventUsesScopedMaps(input.event)
    ? artifactPathOrNull(String(period.id), assignment.venueSpaceId)
    : "map.json";
  if (!targetPath) return null;
  const areaIds = new Set(assignment.areaIds);
  const active = input.placements.filter((placement) => placement.status !== "cancelled" && areaIds.has(placement.area));
  const allowedBoothCodes = [...new Set([...active.map(({ boothCode }) => boothCode), ...(input.existingBoothCodes ?? [])])]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const requiredBoothCodes = [...new Set(active
    .filter(({ day }) => String(day) === String(period.id))
    .map(({ boothCode }) => boothCode))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return {
    kind: "published",
    eventId: input.event.id,
    periodKey: String(period.id),
    venueSpaceId: assignment.venueSpaceId,
    mapTemplate: input.event.mapTemplate,
    allowedBoothCodes,
    // A published event already has a reviewed snapshot, and `existingBoothCodes`
    // carries its empty booths forward, so a code outside both that and the
    // placements is a typo rather than an unsold booth.
    allowsUnallocatedBooths: false,
    requiredBoothCodes,
    /* The artifact is per day *and* per hall, so two days in one hall need two
     * paths. An event that keeps one layout for every day still publishes the
     * flat map.json the reader falls back to. */
    targetPath,
  };
}
