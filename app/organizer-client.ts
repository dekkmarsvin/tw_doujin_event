import type { MapAuthoringState } from "./map-authoring-state";
import type { OrganizerApplication, OrganizerApplicationInput } from "./organizer-applications";
import { PortalError, reportSessionResponse } from "./circle-editor-client";
import type { OrganizerReferenceCatalog } from "./organizer-reference-catalog";
import type {
  OrganizerCandidateStatus,
  OrganizerEventDraft,
  OrganizerRole,
  OrganizerValidationIssue,
} from "./organizer-event";
import type { OrganizerImportMapping, OrganizerNormalizedImportRow } from "./organizer-import";
import type { OrganizerAmendmentSettings, OrganizerAmendmentSettingsImpact } from "./organizer-amendment-settings";
import type { EventMapLayout } from "./event-map";
import type { EventImage } from "./event-image";
import type {
  OrganizerGuidedTask,
  OrganizerWorkspaceReadiness,
  OrganizerWorkspaceSection,
} from "./organizer-workspace";
import type {
  OrganizerVenueCatalog,
  OrganizerVenueCatalogSpace,
  OrganizerVenueSpaceAreaMode,
} from "./organizer-venue-catalog";

async function organizerCall<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      // A FormData body carries its own multipart boundary, which only the
      // browser can spell. Declaring JSON over it would make the body unreadable.
      ...(method !== "GET" && method !== "HEAD" && !(init?.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  reportSessionResponse(response.status);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new PortalError(typeof body.error === "string" ? body.error : "操作失敗，請稍後再試。", response.status, body);
  }
  return body as T;
}

export function listEventApplications() {
  return organizerCall<{ applications: OrganizerApplication[]; canApply: boolean }>("/api/organizer/applications");
}

export function submitEventApplication(id: string, application: OrganizerApplicationInput) {
  return organizerCall<{ application: OrganizerApplication }>("/api/organizer/applications", { method: "POST", body: JSON.stringify({ id, application }) });
}

export function reviewEventApplication(id: string, decision: "approved" | "rejected", reason: string) {
  return organizerCall<{ application: OrganizerApplication }>(`/api/admin/organizer/applications/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ decision, reason }) });
}

export type OrganizerEventSummary = {
  id: string;
  operation?: "CREATE" | "AMEND";
  tentativeName: string;
  eventId: string | null;
  status: OrganizerCandidateStatus;
  version: number;
  updatedAt: number;
  updatedByRole: string;
  role: OrganizerRole | "admin";
  workspaceMode: "guided" | "binder";
};

export type OrganizerEventDetail = {
  recoveryAvailable?: boolean;
  publicationAvailable?: boolean;
  event: OrganizerEventSummary & { eventIdLocked: boolean };
  draft: OrganizerEventDraft;
  venueCatalog: OrganizerVenueCatalog;
  referenceCatalog?: OrganizerReferenceCatalog;
  missingVenueReferences?: Array<{ kind: "venue" | "venue-space"; id: string; name: string; sourceUrl: string | null }>;
  missingVenueAddresses?: Array<{ id: string; name: string }>;
  revisions: Array<{ version: number; eventId: string | null; createdByRole: string; createdAt: number }>;
  import: null | {
    source: {
      fileName: string; worksheet: string | null; sha256: string; sourceDescription: string;
      mapping: OrganizerImportMapping; createdByRole: string; createdAt: number;
    };
    rows: OrganizerNormalizedImportRow[];
  };
  publication: null | {
    id: string;
    status: string;
    step: string;
    error: string | null;
    failureCode: string | null;
    retryable: boolean;
    started: boolean;
    candidateVersion: number;
    updatedAt: number;
  };
  workspace: {
    mode: "guided" | "binder";
    onboardingCompletedAt: number | null;
    resume: { guidedTask: OrganizerGuidedTask; section: OrganizerWorkspaceSection };
    readiness: OrganizerWorkspaceReadiness;
  };
};

export function listOrganizerEvents() {
  return organizerCall<{ events: OrganizerEventSummary[] }>("/api/organizer/events");
}

export function readOrganizerEvent(candidateId: string) {
  return organizerCall<OrganizerEventDetail>(`/api/organizer/events/${encodeURIComponent(candidateId)}`);
}

export type OrganizerAmendmentDestination = { dayId: string; code: string; areaId: string };
export type OrganizerAmendmentChange = (
  | { kind: "withdrawn"; sources: string[] }
  | { kind: "released"; sources: string[]; circleName: string }
  | { kind: "moved"; moves: Array<{ source: string; to: OrganizerAmendmentDestination }> }
  | { kind: "added"; placements: OrganizerAmendmentDestination[]; circleName: string }
) & { reference?: string };
export type OrganizerAmendmentPlacement = OrganizerAmendmentDestination & { source: string; circleId: string; name: string };
export type OrganizerAmendmentImpact = { kind: OrganizerAmendmentChange["kind"]; before: OrganizerAmendmentPlacement[]; after: OrganizerAmendmentPlacement[] };
export type { OrganizerAmendmentSettings, OrganizerAmendmentSettingsImpact };
export type OrganizerAmendmentDetail = {
  version: number;
  changes: OrganizerAmendmentChange[];
  impact: OrganizerAmendmentImpact[];
  settings: OrganizerAmendmentSettings | null;
  settingsImpact: OrganizerAmendmentSettingsImpact[];
  baseline: {
    sourceCandidateId: string; sourceVersion: number; publishedAt: number;
    event: {
      id: string; name: string; aliases?: string[];
      image?: { url: string; width: number; height: number };
      days: Array<{ id: string; label: string; dateLabel: string }>;
      areas: Array<{ id: string; label?: string; name?: string }>;
    };
    official: { days: Array<{ day: string | number; booths: Array<{ codes: string[]; name: string; areaId?: string }> }> };
  };
};
export function startOrganizerAmendment(candidateId: string, expectedVersion: number) {
  return organizerCall<{ ok: true; candidateId: string; version: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/amendments`, {
    method: "POST", body: JSON.stringify({ expectedVersion }),
  });
}
export function readOrganizerAmendment(candidateId: string) {
  return organizerCall<OrganizerAmendmentDetail>(`/api/organizer/events/${encodeURIComponent(candidateId)}/amendment`);
}
/** Whole-state: the settings sent replace the saved declaration, and values
 * equal to the published event are dropped by the server. */
export function saveOrganizerAmendment(candidateId: string, expectedVersion: number, changes: OrganizerAmendmentChange[],
  settings?: OrganizerAmendmentSettings) {
  return organizerCall<{ ok: true; version: number; impact: OrganizerAmendmentImpact[];
    settings: OrganizerAmendmentSettings | null; settingsImpact: OrganizerAmendmentSettingsImpact[] }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/amendment`, {
    method: "PUT", body: JSON.stringify({ expectedVersion, changes, ...(settings ? { settings } : {}) }),
  });
}

export function saveOrganizerEvent(candidateId: string, expectedVersion: number, draft: OrganizerEventDraft) {
  return organizerCall<{ ok: true; candidateId: string; version: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion, draft }),
  });
}

export function listOrganizerVenues(candidateId: string) {
  return organizerCall<OrganizerVenueCatalog>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/venues`,
  );
}

export function createOrganizerReferenceEntry(candidateId: string, input: {
  expectedVersion: number; kind: "organizer" | "category-catalog" | "venue" | "venue-space"; name: string; sourceUrl: string; referenceId?: string;
  organizerId?: string; categories?: Array<{ label: string; description: string }>; address?: string;
} | { expectedVersion: number; kind: "venue-address"; referenceId: string; address: string }) {
  return organizerCall<{ created: { id: string; organizerId: string | null; revision: string | null }; catalog: OrganizerReferenceCatalog }>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/references`, { method: "POST", body: JSON.stringify(input) });
}

export function createOrganizerVenue(candidateId: string, input: {
  name: string;
  sourceUrl: string | null;
  address: string;
  initialSpace: { name: string; sourceUrl: string | null; defaultAreaMode: OrganizerVenueSpaceAreaMode };
}) {
  return organizerCall<{
    venue: { id: string; name: string; sourceUrl: string | null };
    space: OrganizerVenueCatalogSpace;
  }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/venues`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createOrganizerVenueSpace(candidateId: string, venueId: string, input: {
  name: string;
  sourceUrl: string | null;
  defaultAreaMode: OrganizerVenueSpaceAreaMode;
}) {
  return organizerCall<{ space: OrganizerVenueCatalogSpace }>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/venues/${encodeURIComponent(venueId)}/spaces`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function saveOrganizerWorkspacePreference(candidateId: string, input: {
  guidedTask: OrganizerGuidedTask;
  lastSection: OrganizerWorkspaceSection;
}) {
  return organizerCall<{ ok: true; guidedTask: OrganizerGuidedTask; lastSection: OrganizerWorkspaceSection }>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/workspace`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function completeOrganizerOnboarding(candidateId: string, expectedVersion: number) {
  return organizerCall<{ ok: true; mode: "binder"; onboardingCompletedAt: number }>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/workspace/complete-onboarding`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
}

export function putOrganizerImport(candidateId: string, input: {
  expectedVersion: number;
  source: { fileName: string; worksheet: string | null; sha256: string; sourceDescription: string; mapping: OrganizerImportMapping };
  rows: readonly OrganizerNormalizedImportRow[];
}) {
  return organizerCall<{ ok: true; candidateId: string; version: number; importedRows: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/imports`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export type OrganizerMapSummary = {
  id: string; periodKey: string; venueSpaceId: string; status: string; mapRevision: number; updatedAt: number;
  boothCodes?: string[] | null;
};

export type OrganizerMapLocation = { candidateId: string; mapId: string; code: string; nonce: number };

export type OrganizerMapDetail = OrganizerMapSummary & { layout: EventMapLayout; authoring?: MapAuthoringState };

export type OrganizerReaderPreview = {
  schema: "organizer-reader-preview/1";
  event: OrganizerEventDraft["event"];
  venueAssignments: OrganizerEventDraft["venue"]["assignments"];
  officialSource: OrganizerEventDraft["officialSource"];
  references?: Array<{ schema: string; id: string; name?: string; venueId?: string;
    categories?: Array<{ label: string; description?: string }> }>;
  placements: Array<{
    sourceRow: number; dayId: string; venueSpaceId: string; areaId: string;
    boothCode: string; circleName: string; identityGroup: string | null;
  }>;
  maps: Array<{ periodKey: string; venueSpaceId: string; revision: number; layout: EventMapLayout }>;
};

export function listOrganizerMaps(candidateId: string, coverage = false) {
  return organizerCall<{ maps: OrganizerMapSummary[] }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps${coverage ? "?coverage=1" : ""}`);
}

export function readOrganizerMap(candidateId: string, draftId: string) {
  return organizerCall<{ map: OrganizerMapDetail }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps/${encodeURIComponent(draftId)}`);
}

export function createOrganizerMap(candidateId: string, input: {
  expectedVersion: number; periodKey: string; venueSpaceId: string; layout: EventMapLayout; authoring?: MapAuthoringState;
}) {
  return organizerCall<{ ok: true; draftId: string; version: number; mapRevision: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export function saveOrganizerMap(candidateId: string, draftId: string, input: {
  expectedVersion: number; expectedMapRevision: number; layout: EventMapLayout; authoring?: MapAuthoringState;
}) {
  return organizerCall<{ ok: true; version: number; mapRevision: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps/${encodeURIComponent(draftId)}`, {
    method: "PATCH", body: JSON.stringify(input),
  });
}

/** Staged, not saved: the result goes into the draft (or a correction's
 * declaration), and the organizer saves it like any other field. */
export function uploadOrganizerEventImage(candidateId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return organizerCall<{ ok: true; image: EventImage }>(
    `/api/organizer/events/${encodeURIComponent(candidateId)}/image`, { method: "PUT", body: form },
  );
}

/** Where the organizer sees a picture: the private upload while it waits for
 * approval, which the page falls back from to the public address once published. */
export function organizerEventImagePreviewPath(candidateId: string, image: Pick<EventImage, "sha256" | "contentType">) {
  const query = new URLSearchParams({ sha256: image.sha256, contentType: image.contentType });
  return `/api/organizer/events/${encodeURIComponent(candidateId)}/image?${query}`;
}

function organizerMapBackgroundPath(candidateId: string, draftId: string) {
  return `/api/organizer/events/${encodeURIComponent(candidateId)}/maps/${encodeURIComponent(draftId)}/background`;
}

export function uploadOrganizerMapBackground(candidateId: string, draftId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return organizerCall<{ ok: true; width: number; height: number }>(
    organizerMapBackgroundPath(candidateId, draftId), { method: "PUT", body: form },
  );
}

/** The stored plan, or nothing when this map was never traced from one. Absence
 * is an ordinary answer here rather than a failure, so it comes back as null
 * instead of a thrown error. */
export async function readOrganizerMapBackground(candidateId: string, draftId: string) {
  const response = await fetch(organizerMapBackgroundPath(candidateId, draftId), { credentials: "same-origin" });
  reportSessionResponse(response.status);
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new PortalError(typeof body.error === "string" ? body.error : "無法讀取配置圖。", response.status, body);
  }
  return response.blob();
}

export function validateOrganizerEvent(candidateId: string) {
  return organizerCall<{ ok: boolean; version: number; issues: OrganizerValidationIssue[] }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/validate`, {
    method: "POST",
    body: "{}",
  });
}

export function previewOrganizerEvent(candidateId: string) {
  return organizerCall<{ version: number; issues: OrganizerValidationIssue[]; preview: OrganizerReaderPreview }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/preview`, {
    method: "POST",
    body: "{}",
  });
}

export function submitOrganizerEvent(candidateId: string, expectedVersion: number) {
  return organizerCall<{ ok: true; status: "submitted" }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export type OrganizerInvitationDelivery = "sent" | "failed" | "unknown";
type CollaboratorResponse = { ok: true; result: "invited" | "resent" | "revoked";
  invitationSent?: boolean; invitationDelivery?: OrganizerInvitationDelivery };

export function manageOrganizerEditor(candidateId: string, email: string, action: "invite" | "resend" | "revoke") {
  return organizerCall<CollaboratorResponse>(`/api/organizer/events/${encodeURIComponent(candidateId)}/collaborators`, {
    method: "POST",
    body: JSON.stringify({ email, action }),
  });
}

export function manageOrganizerOwner(candidateId: string, email: string, action: "invite" | "resend" | "revoke") {
  return organizerCall<CollaboratorResponse>(`/api/organizer/events/${encodeURIComponent(candidateId)}/collaborators`, {
    method: "POST",
    body: JSON.stringify({ email, role: "owner", action }),
  });
}

export function createOrganizerEvent(tentativeName: string, ownerEmail: string) {
  return organizerCall<{ ok: true; candidateId: string; version: number; invitationSent: boolean; invitationDelivery: OrganizerInvitationDelivery }>("/api/admin/organizer/events", {
    method: "POST",
    body: JSON.stringify({ tentativeName, ownerEmail }),
  });
}

export function reviewOrganizerEvent(candidateId: string, expectedVersion: number, decision: "approve" | "changes_requested", note: string) {
  return organizerCall<{ ok: true; status: OrganizerCandidateStatus; selfApproval: boolean }>(`/api/admin/organizer/events/${encodeURIComponent(candidateId)}/review`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, decision, note }),
  });
}

export function retryOrganizerPublication(jobId: string) {
  return organizerCall<{ ok: true; status: string; step: string }>(`/api/organizer/publications/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });
}

export function reopenOrganizerEvent(candidateId: string, expectedVersion: number, reason: string) {
  return organizerCall<{
    ok: true; status: "changes_requested"; version: number; previousPublicationJobId: string;
  }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/reopen`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason }),
  });
}

export function abandonOrganizerAmendment(candidateId: string, expectedVersion: number, restorationPullNumber: number, reason: string) {
  return organizerCall<{ ok: true; status: "abandoned"; sourceCandidateId: string }>(`/api/admin/organizer/events/${encodeURIComponent(candidateId)}/abandon`, {
    method: "POST", body: JSON.stringify({ expectedVersion, restorationPullNumber, reason }),
  });
}
