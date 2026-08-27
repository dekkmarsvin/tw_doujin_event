import { EVENT_MAP_VERSION, validateEventMapLayout, type EventMapLayout, type MapRect, type PublishedEventMap } from "./event-map";
import { validateMapTemplateLayout } from "./map-template-registry";

export const MAP_CONTRIBUTION_DRAFT_SCHEMA = "map-contribution-draft/1" as const;

export type MapContributionDraftContent = {
  schema: typeof MAP_CONTRIBUTION_DRAFT_SCHEMA;
  layout: EventMapLayout;
};

export type MapContributionScope = {
  eventId: string;
  periodKey: string;
  /** Accepted request/storage aliases which all normalize to periodKey. */
  periodAliases: readonly string[];
  venueSpaceId: string;
  mapTemplate: string;
  allowedBoothCodes: readonly string[];
  requiredBoothCodes: readonly string[];
  targetPath: string;
};

export function resolveCanonicalMapPeriod<T extends { id: string | number }>(
  days: readonly T[],
  requestedPeriodKey: string,
) {
  // Exact event IDs always win. The compatibility alias is accepted only
  // when it cannot name another declared day in the same event.
  const exact = days.find(({ id }) => requestedPeriodKey === String(id));
  const aliasKey = requestedPeriodKey.startsWith("day-") ? requestedPeriodKey.slice(4) : null;
  const period = exact ?? (aliasKey ? days.find(({ id }) => aliasKey === String(id)) : undefined);
  if (!period) return null;
  const periodKey = String(period.id);
  const compatibilityAlias = `day-${periodKey}`;
  const aliasIsAnotherExactDay = days.some(({ id }) => String(id) === compatibilityAlias && id !== period.id);
  return {
    period,
    periodKey,
    periodAliases: aliasIsAnotherExactDay ? [periodKey] : [...new Set([periodKey, compatibilityAlias])],
  };
}

export type MapDraftProblem = {
  code: "invalid_content" | "invalid_layout" | "template_mismatch" | "unknown_booth" | "missing_booth" | "missing_evidence" | "overlap";
  message: string;
  boothCodes?: string[];
};

export type MapDraftActorRole = "map_contributor" | "admin" | "system";

/** Why an optimistic-lock write on a draft was refused, plus the facts a
 * contributor needs to decide what to do next. `updatedByRole` is a role, not
 * an actor: participants on a draft are never identified to one another. */
export type MapDraftConflict = {
  cause: "version" | "permission" | "status";
  revision: number;
  updatedAt: number;
  updatedByRole: MapDraftActorRole;
};

export function parseMapDraftConflict(value: unknown): MapDraftConflict | null {
  if (typeof value !== "object" || value === null) return null;
  const { cause, revision, updatedAt, updatedByRole } = value as Record<string, unknown>;
  if (cause !== "version" && cause !== "permission" && cause !== "status") return null;
  if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(updatedAt)) return null;
  if (updatedByRole !== "map_contributor" && updatedByRole !== "admin" && updatedByRole !== "system") return null;
  return { cause, revision: revision as number, updatedAt: updatedAt as number, updatedByRole };
}

export type MapDraftValidation =
  | { ok: true; content: MapContributionDraftContent; problems: [] }
  | { ok: false; content: MapContributionDraftContent | null; problems: MapDraftProblem[] };

const MAX_LAYOUT_DIMENSION = 100_000;
const MAX_SLOTS = 5_000;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function strictLayoutShape(layout: Record<string, unknown>) {
  if (!onlyKeys(layout, ["version", "template", "width", "height", "floor", "rows", "pillars", "accessPoints", "landmarks"])) return false;
  if (!record(layout.floor) || !onlyKeys(layout.floor, ["x", "y", "width", "height"])) return false;
  if (!Array.isArray(layout.rows) || !layout.rows.every((row) => record(row)
    && onlyKeys(row, ["label", "orientation", "confidence", "slots"])
    && Array.isArray(row.slots) && row.slots.every((slot) => record(slot)
      && onlyKeys(slot, ["code", "rect"]) && record(slot.rect) && onlyKeys(slot.rect, ["x", "y", "width", "height"])))) return false;
  if (!Array.isArray(layout.pillars) || !layout.pillars.every((pillar) => record(pillar)
    && onlyKeys(pillar, ["id", "x", "y", "width", "height"]))) return false;
  if (!Array.isArray(layout.accessPoints) || !layout.accessPoints.every((point) => record(point)
    && onlyKeys(point, ["id", "kind", "direction", "x", "y", "label"]))) return false;
  return Array.isArray(layout.landmarks) && layout.landmarks.every((landmark) => record(landmark)
    && onlyKeys(landmark, ["id", "kind", "rect", "label"])
    && record(landmark.rect) && onlyKeys(landmark.rect, ["x", "y", "width", "height"]));
}

/**
 * Drafts may omit expected booths while being edited, but every shape that is
 * present must still be structurally safe for the shared renderer. Submission
 * adds template, coverage, identity and overlap checks below.
 */
export function parseMapContributionDraftContent(value: unknown): MapContributionDraftContent | null {
  if (!record(value) || value.schema !== MAP_CONTRIBUTION_DRAFT_SCHEMA || !record(value.layout)) return null;
  if (Object.keys(value).some((key) => key !== "schema" && key !== "layout")) return null;
  if (!strictLayoutShape(value.layout)) return null;
  const layout = value.layout as Partial<EventMapLayout>;
  if (layout.version !== EVENT_MAP_VERSION || typeof layout.template !== "string" || !layout.template.trim()) return null;
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)
    || Number(layout.width) <= 0 || Number(layout.height) <= 0
    || Number(layout.width) > MAX_LAYOUT_DIMENSION || Number(layout.height) > MAX_LAYOUT_DIMENSION) return null;
  if (!record(layout.floor) || !Array.isArray(layout.rows) || !Array.isArray(layout.pillars)
    || !Array.isArray(layout.accessPoints) || !Array.isArray(layout.landmarks)) return null;
  const slotCount = layout.rows.reduce((total, row) => total + (record(row) && Array.isArray(row.slots) ? row.slots.length : MAX_SLOTS + 1), 0);
  if (slotCount > MAX_SLOTS) return null;
  if (!validateEventMapLayout(layout).ok) return null;
  return value as MapContributionDraftContent;
}

function slotEntries(layout: EventMapLayout) {
  return layout.rows.flatMap((row) => row.slots.map((slot) => ({ code: slot.code, rect: slot.rect })));
}

function intersects(a: MapRect, b: MapRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function overlapProblems(layout: EventMapLayout) {
  const slots = slotEntries(layout).sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.code.localeCompare(b.code));
  const active: typeof slots = [];
  const pairs: string[][] = [];
  for (const slot of slots) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].rect.x + active[index].rect.width <= slot.rect.x) active.splice(index, 1);
    }
    for (const other of active) {
      if (intersects(slot.rect, other.rect)) {
        pairs.push([other.code, slot.code].sort());
        if (pairs.length >= 50) break;
      }
    }
    active.push(slot);
    if (pairs.length >= 50) break;
  }
  return pairs;
}

export function validateMapContributionDraft(
  value: unknown,
  scope: MapContributionScope,
): MapDraftValidation {
  const content = parseMapContributionDraftContent(value);
  if (!content) return { ok: false, content: null, problems: [{ code: "invalid_content", message: "草稿格式或尺寸限制無效。" }] };

  const problems: MapDraftProblem[] = [];
  const base = validateEventMapLayout(content.layout);
  if (!base.ok) problems.push(...base.errors.slice(0, 50).map((message) => ({ code: "invalid_layout" as const, message })));
  if (content.layout.template !== scope.mapTemplate) {
    problems.push({ code: "template_mismatch", message: `layout template ${content.layout.template} 與活動 ${scope.mapTemplate} 不一致。` });
  } else {
    const template = validateMapTemplateLayout(scope.mapTemplate, content.layout);
    if (!template.ok) {
      const existing = new Set(problems.map(({ message }) => message));
      problems.push(...template.errors.filter((message) => !existing.has(message)).slice(0, 50).map((message) => ({ code: "invalid_layout" as const, message })));
    }
  }

  const codes = new Set(slotEntries(content.layout).map(({ code }) => code));
  const allowed = new Set(scope.allowedBoothCodes);
  const unknown = [...codes].filter((code) => !allowed.has(code)).sort();
  const missing = [...new Set(scope.requiredBoothCodes)].filter((code) => !codes.has(code)).sort();
  if (unknown.length) problems.push({ code: "unknown_booth", message: `含有 ${unknown.length} 個主辦攤位資料未出現的代碼。`, boothCodes: unknown });
  if (missing.length) problems.push({ code: "missing_booth", message: `缺少本 period 的 ${missing.length} 個主辦攤位代碼。`, boothCodes: missing });

  const overlaps = base.ok ? overlapProblems(content.layout) : [];
  if (overlaps.length) {
    problems.push({
      code: "overlap",
      message: `有 ${overlaps.length}${overlaps.length === 50 ? " 組以上" : " 組"}攤位矩形重疊。`,
      boothCodes: [...new Set(overlaps.flat())].sort(),
    });
  }
  return problems.length ? { ok: false, content, problems } : { ok: true, content, problems: [] };
}

export type MapCandidateDiff = {
  previousRevision: number | null;
  candidateRevision: number;
  dimensionsChanged: boolean;
  floorChanged: boolean;
  addedBoothCodes: string[];
  removedBoothCodes: string[];
  movedBoothCodes: string[];
  changedRowLabels: string[];
  changedPillarIds: string[];
  changedAccessPointIds: string[];
  changedLandmarkIds: string[];
};

function same(valueA: unknown, valueB: unknown) {
  return JSON.stringify(valueA) === JSON.stringify(valueB);
}

function changedKeys<T>(previous: readonly T[], next: readonly T[], key: (value: T) => string) {
  const before = new Map(previous.map((value) => [key(value), value]));
  const after = new Map(next.map((value) => [key(value), value]));
  return [...new Set([...before.keys(), ...after.keys()])].filter((id) => !same(before.get(id), after.get(id))).sort();
}

export function buildMapCandidateDiff(previous: PublishedEventMap | null, candidate: PublishedEventMap): MapCandidateDiff {
  const beforeSlots = new Map((previous ? slotEntries(previous.layout) : []).map((slot) => [slot.code, slot.rect]));
  const afterSlots = new Map(slotEntries(candidate.layout).map((slot) => [slot.code, slot.rect]));
  const beforeCodes = new Set(beforeSlots.keys());
  const afterCodes = new Set(afterSlots.keys());
  return {
    previousRevision: previous?.revision ?? null,
    candidateRevision: candidate.revision,
    dimensionsChanged: !previous || previous.layout.width !== candidate.layout.width || previous.layout.height !== candidate.layout.height,
    floorChanged: !previous || !same(previous.layout.floor, candidate.layout.floor),
    addedBoothCodes: [...afterCodes].filter((code) => !beforeCodes.has(code)).sort(),
    removedBoothCodes: [...beforeCodes].filter((code) => !afterCodes.has(code)).sort(),
    movedBoothCodes: [...afterCodes].filter((code) => beforeSlots.has(code) && !same(beforeSlots.get(code), afterSlots.get(code))).sort(),
    changedRowLabels: changedKeys(previous?.layout.rows ?? [], candidate.layout.rows, (row) => row.label),
    changedPillarIds: changedKeys(previous?.layout.pillars ?? [], candidate.layout.pillars, (pillar) => pillar.id),
    changedAccessPointIds: changedKeys(previous?.layout.accessPoints ?? [], candidate.layout.accessPoints, (point) => point.id),
    changedLandmarkIds: changedKeys(previous?.layout.landmarks ?? [], candidate.layout.landmarks, (landmark) => landmark.id),
  };
}

export function buildMapCandidate(input: {
  scope: MapContributionScope;
  draftId: string;
  draftRevision: number;
  layout: EventMapLayout;
  previous: PublishedEventMap | null;
  now: number;
}) {
  const candidate: PublishedEventMap = {
    eventId: input.scope.eventId,
    revision: (input.previous?.revision ?? 0) + 1,
    sourceName: `map-contribution:${input.draftId}:r${input.draftRevision}`,
    confidence: 1,
    updatedAt: new Date(input.now).toISOString(),
    layout: input.layout,
  };
  return { targetPath: input.scope.targetPath, candidate, diff: buildMapCandidateDiff(input.previous, candidate) };
}
