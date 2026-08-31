import type { OrganizerEventDraft } from "./organizer-event";
import type { EventDefinition } from "./event-catalog";

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
    allowedBoothCodes: boothCodes, requiredBoothCodes: boothCodes, targetPath: null,
  };
}

export function resolvePublishedAuthoringScope(input: {
  event: EventDefinition;
  placements: readonly { day: string | number; area: string; boothCode: string; status?: string }[];
  existingBoothCodes?: readonly string[];
}, requestedPeriodKey: string, requestedVenueSpaceId: string): PublishedAuthoringScope | null {
  const period = input.event.days.find(({ id }) => String(id) === requestedPeriodKey);
  const assignment = input.event.venueAssignments.find(({ venueSpaceId }) => venueSpaceId === requestedVenueSpaceId);
  if (!period || !assignment) return null;
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
    requiredBoothCodes,
    targetPath: input.event.venueAssignments.length === 1
      ? "map.json"
      : `maps/${String(period.id)}/${assignment.venueSpaceId}.json`,
  };
}
