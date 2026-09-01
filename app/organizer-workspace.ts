import {
  validateOrganizerEventDraft,
  type OrganizerCandidateStatus,
  type OrganizerEventDraft,
  type OrganizerValidationIssue,
} from "./organizer-event";

export const ORGANIZER_GUIDED_TASKS = ["identity_source", "days", "venue"] as const;
export type OrganizerGuidedTask = typeof ORGANIZER_GUIDED_TASKS[number];

export const ORGANIZER_WORKSPACE_SECTIONS = ["event", "venue", "import", "map", "validate", "review"] as const;
export type OrganizerWorkspaceSection = typeof ORGANIZER_WORKSPACE_SECTIONS[number];
export type OrganizerWorkspaceSectionState = "complete" | "available" | "needs_attention" | "blocked";

export type OrganizerWorkspaceMapScope = { periodKey: string; venueSpaceId: string };

export type OrganizerWorkspaceReadiness = {
  completed: number;
  total: 6;
  suggestedNextSection: OrganizerWorkspaceSection;
  blockers: Array<{ section: OrganizerWorkspaceSection; code: string; message: string; target?: string }>;
  sections: Array<{ id: OrganizerWorkspaceSection; state: OrganizerWorkspaceSectionState }>;
};

const IDENTITY_SOURCE_CODES = new Set([
  "missing_name",
  "missing_event_id",
  "invalid_event_id",
  "missing_source",
  "invalid_source_url",
]);
const DAY_CODES = new Set(["missing_days", "invalid_day", "duplicate_day"]);

export function isOrganizerGuidedTask(value: unknown): value is OrganizerGuidedTask {
  return typeof value === "string" && (ORGANIZER_GUIDED_TASKS as readonly string[]).includes(value);
}

export function isOrganizerWorkspaceSection(value: unknown): value is OrganizerWorkspaceSection {
  return typeof value === "string" && (ORGANIZER_WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

export function organizerGuidedTaskIssues(
  draft: OrganizerEventDraft,
  task: OrganizerGuidedTask,
): OrganizerValidationIssue[] {
  const issues = validateOrganizerEventDraft(draft).filter((issue) => issue.severity === "error");
  if (task === "identity_source") return issues.filter((issue) => IDENTITY_SOURCE_CODES.has(issue.code));
  if (task === "days") return issues.filter((issue) => DAY_CODES.has(issue.code));
  return issues.filter((issue) => issue.step === "venue");
}

export function organizerOnboardingIssues(draft: OrganizerEventDraft): OrganizerValidationIssue[] {
  return ORGANIZER_GUIDED_TASKS.flatMap((task) => organizerGuidedTaskIssues(draft, task));
}

/** Revalidates persisted import rows whenever the event draft changes. A draft
 * edit must not make old rows silently point at a removed day/space or retain
 * an area that no longer matches the event-specific area mode. */
export function validateOrganizerImportedRowsAgainstDraft(
  draft: OrganizerEventDraft,
  rows: readonly { sourceRow?: number; dayId: string; venueSpaceId: string; areaId: string }[],
): OrganizerValidationIssue[] {
  const days = new Set(draft.event.days.map((day) => day.id));
  const spaces = new Map(draft.venue.assignments.map((assignment) => [assignment.venueSpaceId, assignment]));
  const issues: OrganizerValidationIssue[] = [];
  for (const row of rows) {
    const issueBase = { severity: "error" as const, step: "import" as const, row: row.sourceRow, target: row.venueSpaceId };
    if (!days.has(row.dayId)) {
      issues.push({ ...issueBase, code: "stale_import_day", message: "這筆匯入資料的活動日已不在活動設定中，請重新匯入。" });
    }
    const assignment = spaces.get(row.venueSpaceId);
    if (!assignment) {
      issues.push({ ...issueBase, code: "stale_import_space", message: "這筆匯入資料的使用空間已不在活動設定中，請重新匯入。" });
      continue;
    }
    if (assignment.areaMode === "none") {
      if (row.areaId !== "ALL") {
        issues.push({ ...issueBase, code: "stale_import_area_mode", message: "使用空間已改為無分區，既有匯入資料需要重新匯入以套用 ALL。" });
      }
    } else if (!assignment.areaIds.includes(row.areaId)) {
      issues.push({ ...issueBase, code: "stale_import_area", message: "這筆匯入資料的展區已不在目前的活動設定中，請重新匯入。" });
    }
  }
  return issues;
}

export function getOrganizerWorkspacePrerequisiteIssues(input: {
  draft: OrganizerEventDraft;
  importedRows: number;
  importedVenueSpaceIds?: readonly string[];
  maps: readonly OrganizerWorkspaceMapScope[];
}): OrganizerValidationIssue[] {
  const issues = validateOrganizerEventDraft(input.draft);
  if (input.importedRows === 0) {
    issues.push({
      severity: "error",
      step: "import",
      code: "missing_import",
      message: "請先匯入並確認至少一筆攤位資料。",
    });
  }
  // Areas come from the imported booth list, so this is the first step that
  // can name a space the import never covered.
  if (input.importedRows > 0) {
    const importedSpaces = input.importedVenueSpaceIds ? new Set(input.importedVenueSpaceIds) : null;
    for (const assignment of input.draft.venue.assignments) {
      if (importedSpaces ? importedSpaces.has(assignment.venueSpaceId) : assignment.areaIds.length > 0) continue;
      issues.push({
        severity: "error",
        step: "import",
        code: "missing_space_import",
        target: assignment.venueSpaceId,
        message: "匯入資料沒有包含其中一個已選取使用空間的攤位。",
      });
    }
  }
  for (const day of input.draft.event.days) {
    for (const assignment of input.draft.venue.assignments) {
      if (!input.maps.some((map) => map.periodKey === day.id && map.venueSpaceId === assignment.venueSpaceId)) {
        issues.push({
          severity: "error",
          step: "map",
          code: "missing_map",
          target: `${day.id}/${assignment.venueSpaceId}`,
          message: `缺少 ${day.label}其中一個已選取使用空間的地圖。`,
        });
      }
    }
  }
  return issues;
}

export function evaluateOrganizerWorkspaceReadiness(input: {
  draft: OrganizerEventDraft;
  importedRows: number;
  maps: readonly OrganizerWorkspaceMapScope[];
  validationIssues?: readonly OrganizerValidationIssue[];
  currentVersion: number;
  lastValidatedVersion: number | null;
  status: OrganizerCandidateStatus;
}): OrganizerWorkspaceReadiness {
  const issues = (input.validationIssues ?? getOrganizerWorkspacePrerequisiteIssues(input))
    .filter((issue) => issue.severity === "error");
  const eventComplete = !issues.some((issue) => issue.step === "event");
  const venueComplete = !issues.some((issue) => issue.step === "venue");
  const importComplete = input.importedRows > 0;
  const mapComplete = eventComplete && venueComplete
    && input.draft.event.days.length > 0 && input.draft.venue.assignments.length > 0
    && !issues.some((issue) => issue.step === "map");
  const validationComplete = input.lastValidatedVersion === input.currentVersion;
  const reviewComplete = input.status !== "draft" && input.status !== "changes_requested";

  const sections: OrganizerWorkspaceReadiness["sections"] = [
    { id: "event", state: eventComplete ? "complete" : "needs_attention" },
    { id: "venue", state: venueComplete ? "complete" : "needs_attention" },
    {
      id: "import",
      state: importComplete ? "complete" : eventComplete && venueComplete ? "available" : "blocked",
    },
    {
      id: "map",
      state: mapComplete ? "complete"
        : eventComplete && venueComplete && importComplete
          ? input.maps.length > 0 ? "needs_attention" : "available"
          : "blocked",
    },
    {
      id: "validate",
      state: validationComplete ? "complete" : eventComplete && venueComplete && importComplete && mapComplete ? "available" : "blocked",
    },
    {
      id: "review",
      state: reviewComplete ? "complete" : validationComplete ? "available" : "blocked",
    },
  ];

  const blockers: OrganizerWorkspaceReadiness["blockers"] = issues.map((issue) => ({
    section: issue.step === "preview" ? "validate" : issue.step,
    code: issue.code,
    message: issue.message,
    ...(issue.target ? { target: issue.target } : {}),
  }));
  if (!validationComplete) {
    blockers.push({
      section: "validate",
      code: "validation_required",
      message: "目前這一版尚未通過檢查。",
    });
  }
  if (!reviewComplete) {
    blockers.push({
      section: "review",
      code: "submission_required",
      message: "活動尚未送審。",
    });
  }

  const suggested = sections.find((section) => section.state !== "complete" && section.state !== "blocked")
    ?? sections.find((section) => section.state !== "complete")
    ?? sections[sections.length - 1];
  return {
    completed: sections.filter((section) => section.state === "complete").length,
    total: 6,
    suggestedNextSection: suggested.id,
    blockers,
    sections,
  };
}
