export type OrganizerRole = "owner" | "editor";

export type OrganizerCandidateStatus =
  | "draft"
  | "changes_requested"
  | "submitted"
  | "approved"
  | "publishing"
  | "published"
  | "failed";

export type OrganizerValidationIssue = {
  severity: "error" | "warning";
  step: "event" | "venue" | "import" | "map" | "preview";
  code: string;
  row?: number;
  target?: string;
  message: string;
};

type OrganizerEventDay = { id: string; label: string; date: string };
type OrganizerVenueAssignment = {
  venueId: string;
  venueSpaceId: string;
  areaIds: string[];
  mapTemplate: string;
  /** Event-specific. The catalog only supplies a default for a new assignment. */
  areaMode?: "imported" | "none";
};

export type OrganizerEventDraft = {
  schema: "organizer-event-draft/1";
  event: {
    id: string | null;
    name: string;
    days: OrganizerEventDay[];
  };
  venue: {
    assignments: OrganizerVenueAssignment[];
  };
  officialSource: {
    label: string;
    url: string | null;
  };
};

const ID = /^[a-z0-9][a-z0-9-]*$/u;
const AREA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function httpsUrl(value: string | null) {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

export function createEmptyOrganizerEventDraft(tentativeName: string): OrganizerEventDraft {
  return {
    schema: "organizer-event-draft/1",
    event: { id: null, name: text(tentativeName), days: [] },
    venue: { assignments: [] },
    officialSource: { label: "", url: null },
  };
}

function localDate(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A new day continues the run: the day after the last dated day, or the
 * author's own today when the draft has no dated day yet. */
export function nextOrganizerEventDay(days: readonly OrganizerEventDay[], now: Date): OrganizerEventDay {
  const taken = new Set(days.map((day) => day.id));
  let ordinal = 1;
  while (taken.has(String(ordinal))) ordinal += 1;
  const last = days.filter((day) => DATE.test(day.date) && !Number.isNaN(Date.parse(`${day.date}T00:00:00Z`))).at(-1);
  const date = last
    ? new Date(Date.parse(`${last.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    : localDate(now);
  return { id: String(ordinal), label: `第 ${ordinal} 日`, date };
}

/** Areas are a fact of the booth list, not something to type before the list
 * exists. The import derives them per venue space so the organizer checks a
 * result instead of guessing ids, and the import API keeps refusing any row
 * whose area was never declared — it is declared from the same rows.
 *
 * Import is replace semantics, so this is a replacement too: a configured space
 * the new file never mentions loses its areas rather than keeping the ones an
 * older file left behind. Keeping them would leave the space looking covered
 * while its booth rows are gone, and the prerequisite check — which reads an
 * empty area list as "the import never reached this space" — would stay
 * silent. */
export function withOrganizerImportedAreaIds(
  draft: OrganizerEventDraft,
  rows: readonly { venueSpaceId: string; areaId: string }[],
): OrganizerEventDraft {
  const bySpace = new Map<string, Set<string>>();
  for (const row of rows) {
    const areas = bySpace.get(row.venueSpaceId) ?? new Set<string>();
    areas.add(row.areaId);
    bySpace.set(row.venueSpaceId, areas);
  }
  return {
    ...draft,
    venue: {
      assignments: draft.venue.assignments.map((assignment) => ({
        ...assignment,
        areaIds: assignment.areaMode === "none"
          ? ["ALL"]
          : [...(bySpace.get(assignment.venueSpaceId) ?? [])].sort((a, b) => a.localeCompare(b, "en")),
      })),
    },
  };
}

/** Area ids reach public URLs, so a derived value still has to be url-safe.
 * The import preview flags the ones that are not instead of failing later. */
export function isOrganizerAreaId(value: string) {
  return AREA_ID.test(value);
}

export function parseOrganizerEventDraft(value: unknown): OrganizerEventDraft | null {
  if (!record(value) || value.schema !== "organizer-event-draft/1"
    || !record(value.event) || !record(value.venue) || !record(value.officialSource)
    || !Array.isArray(value.event.days) || !Array.isArray(value.venue.assignments)) return null;
  const eventId = value.event.id === null ? null : text(value.event.id);
  const name = text(value.event.name);
  const days: OrganizerEventDay[] = [];
  for (const day of value.event.days) {
    if (!record(day)) return null;
    days.push({ id: text(day.id), label: text(day.label), date: text(day.date) });
  }
  const assignments: OrganizerVenueAssignment[] = [];
  for (const assignment of value.venue.assignments) {
    if (!record(assignment) || !Array.isArray(assignment.areaIds)) return null;
    const hasAreaMode = Object.prototype.hasOwnProperty.call(assignment, "areaMode");
    if (hasAreaMode && assignment.areaMode !== "imported" && assignment.areaMode !== "none") return null;
    const areaIds = assignment.areaIds.map(text);
    if (assignment.areaMode === "none" && (areaIds.length !== 1 || areaIds[0] !== "ALL")) return null;
    assignments.push({
      venueId: text(assignment.venueId),
      venueSpaceId: text(assignment.venueSpaceId),
      areaIds,
      mapTemplate: text(assignment.mapTemplate) || "TAIWAN_GENERIC_V1",
      ...(assignment.areaMode === "imported" || assignment.areaMode === "none"
        ? { areaMode: assignment.areaMode }
        : {}),
    });
  }
  const sourceUrl = value.officialSource.url === null || value.officialSource.url === undefined
    ? null
    : text(value.officialSource.url);
  return {
    schema: "organizer-event-draft/1",
    event: { id: eventId, name, days },
    venue: { assignments },
    officialSource: { label: text(value.officialSource.label), url: sourceUrl },
  };
}

export function serializeOrganizerEventDraft(value: unknown) {
  const draft = parseOrganizerEventDraft(value);
  if (!draft) return null;
  const json = JSON.stringify(draft);
  return new TextEncoder().encode(json).byteLength <= 1024 * 1024 ? { draft, json } : null;
}

export function validateOrganizerEventDraft(draft: OrganizerEventDraft): OrganizerValidationIssue[] {
  const issues: OrganizerValidationIssue[] = [];
  const add = (issue: OrganizerValidationIssue) => issues.push(issue);
  if (!draft.event.name) add({ severity: "error", step: "event", code: "missing_name", target: "event.name", message: "活動名稱為必填。" });
  if (!draft.event.id) add({ severity: "error", step: "event", code: "missing_event_id", target: "event.id", message: "活動代碼為必填。" });
  else if (!ID.test(draft.event.id)) add({ severity: "error", step: "event", code: "invalid_event_id", target: "event.id", message: "活動代碼只能使用小寫英數字與連字號。" });
  if (draft.event.days.length === 0) add({ severity: "error", step: "event", code: "missing_days", target: "event.days", message: "至少需要一個活動日。" });
  const dayIds = new Set<string>();
  draft.event.days.forEach((day, row) => {
    if (!ID.test(day.id) || !day.label || !DATE.test(day.date) || Number.isNaN(Date.parse(`${day.date}T00:00:00Z`))) {
      add({ severity: "error", step: "event", code: "invalid_day", row: row + 1, target: `event.days.${row}`, message: "活動日需要代碼、名稱與日期。" });
    }
    if (dayIds.has(day.id)) add({ severity: "error", step: "event", code: "duplicate_day", row: row + 1, target: `event.days.${row}.id`, message: `活動日 ${day.id} 重複。` });
    dayIds.add(day.id);
  });
  if (draft.venue.assignments.length === 0) add({ severity: "error", step: "venue", code: "missing_venue", target: "venue.assignments", message: "至少需要一個場館空間。" });
  const spaces = new Set<string>();
  draft.venue.assignments.forEach((assignment, row) => {
    if (!assignment.venueId) add({ severity: "error", step: "venue", code: "missing_venue_selection", row: row + 1, target: `venue.assignments.${row}.venueId`, message: "請選擇場館。" });
    else if (!ID.test(assignment.venueId)) add({ severity: "error", step: "venue", code: "invalid_venue_selection", row: row + 1, target: `venue.assignments.${row}.venueId`, message: "場館選項格式無效，請重新選擇。" });
    if (!assignment.venueSpaceId) add({ severity: "error", step: "venue", code: "missing_venue_space_selection", row: row + 1, target: `venue.assignments.${row}.venueSpaceId`, message: "請選擇使用空間。" });
    else if (!ID.test(assignment.venueSpaceId)) add({ severity: "error", step: "venue", code: "invalid_venue_space_selection", row: row + 1, target: `venue.assignments.${row}.venueSpaceId`, message: "使用空間選項格式無效，請重新選擇。" });
    if (!assignment.mapTemplate) add({ severity: "error", step: "venue", code: "missing_map_template", row: row + 1, target: `venue.assignments.${row}.mapTemplate`, message: "請選擇地圖模板。" });
    if (assignment.areaMode !== undefined && assignment.areaMode !== "imported" && assignment.areaMode !== "none") {
      add({ severity: "error", step: "venue", code: "invalid_area_mode", row: row + 1, target: `venue.assignments.${row}.areaMode`, message: "展區方式無效，請重新選擇。" });
    }
    if (assignment.areaMode === "none" && (assignment.areaIds.length !== 1 || assignment.areaIds[0] !== "ALL")) {
      add({ severity: "error", step: "venue", code: "invalid_no_division_areas", row: row + 1, target: `venue.assignments.${row}.areaIds`, message: "無分區的使用空間必須使用 ALL，請重新選擇展區方式。" });
    }
    if (assignment.areaIds.some((area) => !AREA_ID.test(area))) {
      add({ severity: "error", step: "venue", code: "invalid_area", row: row + 1, target: `venue.assignments.${row}.areaIds`, message: "匯入的展區代碼格式無效。" });
    }
    if (spaces.has(assignment.venueSpaceId)) add({ severity: "error", step: "venue", code: "duplicate_space", row: row + 1, target: `venue.assignments.${row}.venueSpaceId`, message: "同一個使用空間重複選取。" });
    spaces.add(assignment.venueSpaceId);
  });
  if (!draft.officialSource.label) add({ severity: "error", step: "event", code: "missing_source", target: "officialSource.label", message: "請說明主辦資料來源。" });
  if (!httpsUrl(draft.officialSource.url)) add({ severity: "error", step: "event", code: "invalid_source_url", target: "officialSource.url", message: "來源網址必須使用 HTTPS。" });
  return issues;
}
