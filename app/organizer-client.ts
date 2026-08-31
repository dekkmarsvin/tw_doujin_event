import { PortalError } from "./circle-editor-client";
import type {
  OrganizerCandidateStatus,
  OrganizerEventDraft,
  OrganizerRole,
  OrganizerValidationIssue,
} from "./organizer-event";
import type { OrganizerImportMapping, OrganizerNormalizedImportRow } from "./organizer-import";
import type { EventMapLayout } from "./event-map";

async function organizerCall<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(method !== "GET" && method !== "HEAD" ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new PortalError(typeof body.error === "string" ? body.error : "操作失敗，請稍後再試。", response.status, body);
  }
  return body as T;
}

export type OrganizerEventSummary = {
  id: string;
  tentativeName: string;
  eventId: string | null;
  status: OrganizerCandidateStatus;
  version: number;
  updatedAt: number;
  updatedByRole: string;
  role: OrganizerRole | "admin";
};

export type OrganizerEventDetail = {
  event: OrganizerEventSummary & { eventIdLocked: boolean };
  draft: OrganizerEventDraft;
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
    updatedAt: number;
  };
};

export function listOrganizerEvents() {
  return organizerCall<{ events: OrganizerEventSummary[] }>("/api/organizer/events");
}

export function readOrganizerEvent(candidateId: string) {
  return organizerCall<OrganizerEventDetail>(`/api/organizer/events/${encodeURIComponent(candidateId)}`);
}

export function saveOrganizerEvent(candidateId: string, expectedVersion: number, draft: OrganizerEventDraft) {
  return organizerCall<{ ok: true; candidateId: string; version: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion, draft }),
  });
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
};

export type OrganizerMapDetail = OrganizerMapSummary & { layout: EventMapLayout };

export type OrganizerReaderPreview = {
  schema: "organizer-reader-preview/1";
  event: OrganizerEventDraft["event"];
  venueAssignments: OrganizerEventDraft["venue"]["assignments"];
  officialSource: OrganizerEventDraft["officialSource"];
  placements: Array<{
    sourceRow: number; dayId: string; venueSpaceId: string; areaId: string;
    boothCode: string; circleName: string; identityGroup: string | null;
  }>;
  maps: Array<{ periodKey: string; venueSpaceId: string; revision: number; layout: EventMapLayout }>;
};

export function listOrganizerMaps(candidateId: string) {
  return organizerCall<{ maps: OrganizerMapSummary[] }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps`);
}

export function readOrganizerMap(candidateId: string, draftId: string) {
  return organizerCall<{ map: OrganizerMapDetail }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps/${encodeURIComponent(draftId)}`);
}

export function createOrganizerMap(candidateId: string, input: {
  expectedVersion: number; periodKey: string; venueSpaceId: string; layout: EventMapLayout;
}) {
  return organizerCall<{ ok: true; draftId: string; version: number; mapRevision: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export function saveOrganizerMap(candidateId: string, draftId: string, input: {
  expectedVersion: number; expectedMapRevision: number; layout: EventMapLayout;
}) {
  return organizerCall<{ ok: true; version: number; mapRevision: number }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/maps/${encodeURIComponent(draftId)}`, {
    method: "PATCH", body: JSON.stringify(input),
  });
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

export function manageOrganizerEditor(candidateId: string, email: string, action: "invite" | "revoke") {
  return organizerCall<{ ok: true }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/collaborators`, {
    method: "POST",
    body: JSON.stringify({ email, action }),
  });
}

export function manageOrganizerOwner(candidateId: string, email: string, action: "invite" | "revoke") {
  return organizerCall<{ ok: true }>(`/api/organizer/events/${encodeURIComponent(candidateId)}/collaborators`, {
    method: "POST",
    body: JSON.stringify({ email, role: "owner", action }),
  });
}

export function createOrganizerEvent(tentativeName: string, ownerEmail: string) {
  return organizerCall<{ ok: true; candidateId: string; version: number }>("/api/admin/organizer/events", {
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
  return organizerCall<{ ok: true; status: "queued"; step: string }>(`/api/admin/organizer/publications/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });
}
