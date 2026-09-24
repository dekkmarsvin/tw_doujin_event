import type { OrganizerEventDraft, OrganizerValidationIssue } from "./organizer-event";
import { INITIAL_ORGANIZER_VENUE_CATALOG, normalizeOrganizerVenueName, normalizeOrganizerVenueSourceUrl } from "./organizer-venue-catalog";
import { parseReferenceRecord, verifyReferenceFiles } from "./reference-selection.mjs";
import { sha256Hex } from "./portal-crypto";
import { pinnedVenue, pinnedSpace } from "./organizer-reference-seeds";
import { parseCircleCategoryDefinitions } from "./circle-categories";

export type OrganizerReferenceRecord = {
  path: string;
  kind: "organizer" | "category-catalog" | "venue" | "venue-space";
  id: string;
  organizerId: string | null;
  revision: string | null;
  displayName: string;
  publicReferenceJson: string;
  sourceCapturedAt: number;
};
export type OrganizerReferenceCatalog = {
  organizers: Array<{ id: string; name: string; officialUrl: string }>;
  categories: Array<{ id: string; organizerId: string; revision: string; name: string; sourceUrl: string;
    categories: Array<{ id: string; label: string; description?: string }> }>;
};
export type OrganizerReferenceSnapshot = {
  selection: {
    schema: "reference-selection/1"; eventId: string;
    organizers: Array<{ id: string; path: string }>;
    categoryCatalog: { id: string; organizerId: string; revision: string; path: string };
    venues: Array<{ id: string; path: string; spaces: Array<{ id: string; path: string }> }>;
  };
  files: Array<{ path: string; content: string; sha256: string }>;
};

function provenance(url: string, capturedAt: number, kind: "organizer-official" | "venue-official", pointers: string[]) {
  return {
    sources: [{ id: "official-source", kind, url, retrievedAt: new Date(capturedAt).toISOString() }],
    provenance: Object.fromEntries(pointers.map((pointer) => [pointer, ["official-source"]])),
  };
}

function record(kind: OrganizerReferenceRecord["kind"], value: Record<string, unknown>, path: string,
  displayName: string, capturedAt: number, bytes?: string): OrganizerReferenceRecord {
  const publicReferenceJson = bytes ?? `${JSON.stringify(value, null, 2)}\n`;
  parseReferenceRecord(JSON.parse(publicReferenceJson), path);
  return { path, kind, id: String(value.id), organizerId: typeof value.organizerId === "string" ? value.organizerId : null,
    revision: typeof value.revision === "string" ? value.revision : null, displayName, publicReferenceJson, sourceCapturedAt: capturedAt };
}

export function createOrganizerReference(input: { name: unknown; sourceUrl: unknown }, now: number) {
  const name = normalizeOrganizerVenueName(input.name);
  const url = normalizeOrganizerVenueSourceUrl(input.sourceUrl);
  if (!name || !url) throw new Error("請填寫主辦名稱與有效的 HTTPS 官方來源網址。");
  const id = `organizer-${crypto.randomUUID()}`;
  return record("organizer", { schema: "organizer/1", id, name, officialUrl: url,
    ...provenance(url, now, "organizer-official", ["/name", "/officialUrl"]) }, `references/organizers/${id}.json`, name, now);
}

export function createCategoryReference(input: { name: unknown; sourceUrl: unknown; categories: unknown }, organizerId: string, now: number) {
  const name = normalizeOrganizerVenueName(input.name);
  const url = normalizeOrganizerVenueSourceUrl(input.sourceUrl);
  if (!name || !url || !Array.isArray(input.categories) || input.categories.length === 0 || input.categories.length > 100) {
    throw new Error("請填寫分類目錄名稱、HTTPS 官方來源網址，以及至少一個分類（最多 100 個）。");
  }
  const labels = new Set<string>();
  const categories = input.categories.map((value, index) => {
    const label = normalizeOrganizerVenueName(value?.label);
    const description = typeof value?.description === "string" ? value.description.trim() : "";
    if (!label || description.length > 1000 || labels.has(label)) throw new Error("分類名稱不可空白或重複，說明最多 1000 字。");
    labels.add(label);
    return { id: `category-${index + 1}`, label, ...(description ? { description } : {}) };
  });
  const id = `catalog-${crypto.randomUUID()}`;
  try { parseCircleCategoryDefinitions(categories); }
  catch { throw new Error("分類名稱不可空白、重複或使用系統保留名稱「全部類別」。"); }
  const revision = "1";
  const pointers = categories.flatMap((category, index) => [`/categories/${index}/label`, ...(category.description ? [`/categories/${index}/description`] : [])]);
  return record("category-catalog", { schema: "category-catalog/1", id, organizerId, revision, categories,
    ...provenance(url, now, "organizer-official", pointers) }, `references/category-catalogs/${organizerId}/${id}/${revision}.json`, name, now);
}

export function createVenueReference(input: { id: string; name: string; sourceUrl: string | null }, now: number) {
  if (!input.sourceUrl) throw new Error("場館缺少官方來源網址。");
  return record("venue", { schema: "venue/1", id: input.id, name: input.name, officialUrl: input.sourceUrl,
    ...provenance(input.sourceUrl, now, "venue-official", ["/name", "/officialUrl"]) }, `references/venues/${input.id}.json`, input.name, now);
}

export function createVenueSpaceReference(input: { id: string; venueId: string; name: string; sourceUrl: string | null }, now: number) {
  if (!input.sourceUrl) throw new Error("場地缺少官方來源網址。");
  return record("venue-space", { schema: "venue-space/1", id: input.id, venueId: input.venueId, name: input.name,
    ...provenance(input.sourceUrl, now, "venue-official", ["/name"]) }, `references/venue-spaces/${input.id}.json`, input.name, now);
}

/** #248 pinned adoption: bytes from FF47 data commit 8c645303fa6838383549fbe8433ece081c514e1e;
 * other seed sources were checked at 2026-09-14T10:31:38Z (issuecomment-5662643892). */
export function initialVenueReferences() {
  const capturedAt = Date.parse("2026-09-14T10:31:38Z");
  return INITIAL_ORGANIZER_VENUE_CATALOG.flatMap((venue) => {
    if (venue.id === "taipei-expo-park-zhengyan-hall") {
      return [record("venue", JSON.parse(pinnedVenue), `references/venues/${venue.id}.json`, venue.name,
        Date.parse("2026-08-25T03:43:00Z"), pinnedVenue),
      record("venue-space", JSON.parse(pinnedSpace), "references/venue-spaces/zhengyan-exhibition-area.json", "全館",
        Date.parse("2026-08-25T03:43:00Z"), pinnedSpace)];
    }
    return [createVenueReference(venue, capturedAt), ...venue.spaces.map((space) => createVenueSpaceReference({ ...space, venueId: venue.id,
      sourceUrl: venue.id === "taipei-hakka-cultural-center" ? venue.sourceUrl : space.sourceUrl }, capturedAt))];
  });
}

export function projectReferenceCatalog(records: OrganizerReferenceRecord[]): OrganizerReferenceCatalog {
  return {
    organizers: records.filter((row) => row.kind === "organizer").map((row) => {
      const value = parseReferenceRecord(JSON.parse(row.publicReferenceJson), row.path);
      return { id: row.id, name: value.name, officialUrl: value.officialUrl };
    }),
    categories: records.filter((row) => row.kind === "category-catalog").map((row) => {
      const value = parseReferenceRecord(JSON.parse(row.publicReferenceJson), row.path);
      return { id: row.id, organizerId: value.organizerId, revision: value.revision, name: row.displayName,
        sourceUrl: value.sources[0].url, categories: value.categories };
    }),
  };
}

export function validateOrganizerReferences(draft: OrganizerEventDraft, catalog: OrganizerReferenceCatalog, required = true): OrganizerValidationIssue[] {
  const issues: OrganizerValidationIssue[] = [];
  const add = (code: string, message: string) => issues.push({ severity: "error", step: "event", target: "references", code, message });
  const assignments = draft.references?.organizerAssignments ?? [];
  const category = draft.references?.categoryCatalog;
  if (assignments.length === 0) { if (required) add("missing_organizer", "請選擇主辦單位。"); }
  else {
    if (assignments.filter((item) => item.role === "lead").length !== 1) add("organizer_lead", "請指定恰好一個主辦單位；其餘可設為協辦或合作夥伴。");
    if (new Set(assignments.map((item) => item.organizerId)).size !== assignments.length) add("duplicate_organizer", "同一個主辦單位不可重複選取。");
    if (assignments.some((item) => !catalog.organizers.some((organizer) => organizer.id === item.organizerId))) add("unknown_organizer", "選取的主辦單位不存在，請重新選擇。");
  }
  if (!category) { if (required) add("missing_category_catalog", "請選擇含至少一個分類的主辦分類目錄。"); }
  else if (!assignments.some((item) => item.organizerId === category.organizerId)
    || !catalog.categories.some((item) => item.id === category.id && item.organizerId === category.organizerId && item.revision === category.revision && item.categories.length > 0)) {
    add("invalid_category_catalog", "分類目錄必須屬於已選取的主辦單位，且含至少一個分類。");
  } else {
    const selected = catalog.categories.find((item) => item.id === category.id && item.organizerId === category.organizerId && item.revision === category.revision)!;
    try { parseCircleCategoryDefinitions(selected.categories); }
    catch { add("invalid_category_catalog", "分類名稱不可空白、重複或使用系統保留名稱「全部類別」，請重新選擇分類目錄。"); }
  }
  return issues;
}

/** Validate, preview and submit share these selected bytes; publication only consumes the snapshot. */
export async function resolveOrganizerReferences(draft: OrganizerEventDraft, records: OrganizerReferenceRecord[]) {
  const issues = validateOrganizerReferences(draft, projectReferenceCatalog(records));
  if (issues.length || !draft.event.id || !draft.references?.categoryCatalog || !draft.venue.assignments.length) return { issues, snapshot: null };
  const category = draft.references.categoryCatalog;
  const venues = [...new Set(draft.venue.assignments.map((item) => item.venueId))].sort();
  const selection: OrganizerReferenceSnapshot["selection"] = {
    schema: "reference-selection/1", eventId: draft.event.id,
    organizers: draft.references.organizerAssignments.map(({ organizerId: id }) => ({ id, path: `references/organizers/${id}.json` })).sort((a, b) => a.id.localeCompare(b.id, "en")),
    categoryCatalog: { ...category, path: `references/category-catalogs/${category.organizerId}/${category.id}/${category.revision}.json` },
    venues: venues.map((id) => ({ id, path: `references/venues/${id}.json`, spaces: draft.venue.assignments.filter((item) => item.venueId === id)
      .map(({ venueSpaceId: id }) => ({ id, path: `references/venue-spaces/${id}.json` })).sort((a, b) => a.id.localeCompare(b.id, "en")) })),
  };
  const paths = [...selection.organizers.map((item) => item.path), selection.categoryCatalog.path,
    ...selection.venues.flatMap((venue) => [venue.path, ...venue.spaces.map((space) => space.path)])].sort();
  for (const venue of selection.venues) {
    for (const item of [venue, ...venue.spaces]) {
      if (!records.some((record) => record.path === item.path)) issues.push({ severity: "error", step: "venue",
        target: item.id, code: "missing_venue_reference",
        message: "所選場館或場地尚未保存完整來源，請在「場館與場地」補齊官方來源。" });
    }
  }
  if (issues.length) return { issues, snapshot: null };
  try {
    const files = await Promise.all(paths.map(async (path) => {
      const selected = records.find((row) => row.path === path);
      if (!selected) throw new Error("Missing canonical reference");
      return { path, content: selected.publicReferenceJson, sha256: await sha256Hex(selected.publicReferenceJson) };
    }));
    verifyReferenceFiles(selection, new Map(files.map((file) => [file.path, new TextEncoder().encode(file.content)])), draft.event.id);
    return { issues, snapshot: { selection, files } };
  } catch {
    issues.push({ severity: "error", step: "event", target: "references", code: "invalid_reference_records",
      message: "選取的主辦、分類或場館缺少完整官方來源記錄，請聯絡網站管理者。" });
    return { issues, snapshot: null };
  }
}
