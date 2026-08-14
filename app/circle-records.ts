import { FF47_EVENT, FF47_OFFICIAL_BOOTH_LIST_URLS, FF47_OFFICIAL_EVENT_URL } from "./event-catalog";
import { indexCircleOverrides } from "./circle-overrides";
import type { CircleOverride, CircleOverridesPayload } from "./circle-overrides";
import type { Booth, Tone } from "./booth";

export const CIRCLE_CATALOG_SCHEMA = "circle-catalog/1" as const;

export type SourceStatus = "linked" | "stale" | "unavailable" | "unverified";
export type SourceContentType = "official" | "circle" | "catalog" | "social" | "media";

export type SourceLink = {
  provider: string;
  contentType: SourceContentType;
  label: string;
  url: string;
  fetchedAt: string;
  status: SourceStatus;
};

export type CircleMedia = {
  id: string;
  kind: "thumbnail";
  url: string;
  sourceUrl: string;
  provider: string;
  alt: string;
};

export type CircleTemplateLinkKind = "social" | "support" | "website" | "announcement" | "catalog" | "store" | "sample";

export type CircleExternalLink = {
  provider: string;
  kind: CircleTemplateLinkKind;
  url: string;
};

/** One reviewed workbook row: a circle's identity evidence before placement. */
export type CircleTemplate = {
  id: string;
  sourceRow: number;
  name: string;
  pen?: string;
  placements: Record<"1" | "2" | "3", string[]>;
  creatorTypes: string[];
  ageRatings: string[];
  workTypes: string[];
  referencedWorks: string[];
  saleInfo?: string;
  specialTags: string[];
  confidence?: string;
  surveyUrls: string[];
  links: CircleExternalLink[];
  thumbnail?: {
    sourceUrl: string;
    url: string;
    provider: string;
  };
};

/**
 * Versioned static catalog snapshot. Exported from the reviewed workbook and
 * booth sources by `scripts/export-static-circle-catalog.mjs`, then fetched at
 * runtime so the event payload stays out of the application bundle.
 */
export type CircleCatalogPayload = {
  schema: typeof CIRCLE_CATALOG_SCHEMA;
  eventId: string;
  generatedAt: string;
  officialSupplementKeys: string[];
  /** Permanent compatibility map. Kept in the lazy static snapshot, not the JS bundle. */
  legacyCircleIds: Record<string, string>;
  booths: Booth[];
  templates: CircleTemplate[];
};

/** A circle's reusable identity and catalog metadata, independent of a booth. */
export type CircleRecord = {
  id: string;
  sourceRow?: number;
  name: string;
  nameReading?: string;
  description: string;
  categories: string[];
  pen: string;
  work: string;
  creatorTypes: string[];
  ageRatings: string[];
  workTypes: string[];
  referencedWorks: string[];
  saleInfo: string;
  specialTags: string[];
  media: CircleMedia[];
  externalLinks: CircleExternalLink[];
  updatedAt: string;
  sources: SourceLink[];
};

/** An event-specific placement. A circle may have more than one placement. */
export type PlacementRecord = {
  id: string;
  eventId: string;
  circleId: string;
  day: Booth["day"];
  area: Booth["hall"];
  boothCode: string;
  status: "active" | "cancelled" | "moved";
  x: number;
  y: number;
  tone: Tone;
};

/** Read model used by the map UI. Its record ID is unique even when source IDs collide. */
export type CircleViewRecord = Booth & {
  recordId: string;
  sources: SourceLink[];
  circle: CircleRecord;
  placement: PlacementRecord;
};

export type CircleCatalog = {
  generatedAt: string;
  circles: CircleRecord[];
  circlesById: Map<string, CircleRecord>;
  placements: PlacementRecord[];
  records: CircleViewRecord[];
  recordsById: Map<string, CircleViewRecord>;
  recordsByCircleId: Map<string, CircleViewRecord[]>;
  idMigrationTargets: Map<string, string[]>;
};

const CATALOG_SOURCE = {
    provider: "加帕利天藍怪預警中心",
    contentType: "catalog",
    label: "FF47 社團公開整理資料",
    url: "https://www.facebook.com/JapariWeatherBureau/",
    fetchedAt: FF47_EVENT.dataUpdatedAt,
    status: "linked",
} as const satisfies SourceLink;

function buildOfficialSource(day?: Booth["day"]): SourceLink {
  return {
    provider: "開拓動漫",
    contentType: "official",
    label: day ? `FF47 第 ${day} 天攤位清單` : "FF47 活動與攤位配置",
    url: day ? FF47_OFFICIAL_BOOTH_LIST_URLS[day] : FF47_OFFICIAL_EVENT_URL,
    fetchedAt: FF47_EVENT.dataUpdatedAt,
    status: "linked",
  };
}

function cloneSources(): SourceLink[] {
  return [buildOfficialSource(), { ...CATALOG_SOURCE }];
}

function templateSource(template?: CircleTemplate): SourceLink[] {
  return template?.thumbnail ? [{
    provider: template.thumbnail.provider,
    contentType: "media",
    label: `${template.name} 公開縮圖`,
    url: template.thumbnail.sourceUrl,
    fetchedAt: FF47_EVENT.dataUpdatedAt,
    status: "linked",
  }] : [];
}

export function normalizeCircleTemplateName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

/** Unambiguous composite key: no separator can appear inside a JSON member. */
function placementKey(day: number, boothCode: string, nameKey: string) {
  return JSON.stringify([day, boothCode, nameKey]);
}

/** Circle-authored content is labelled as self-reported, never as organizer-confirmed. */
function circleSelfSource(override: CircleOverride): SourceLink {
  return {
    provider: "社團本人",
    contentType: "circle",
    label: "社團自行提供的補充資料",
    url: "",
    fetchedAt: override.updatedAt,
    status: "unverified",
  };
}

function circleFromTemplate(circleId: string, template?: CircleTemplate, booth?: Booth, override?: CircleOverride): CircleRecord {
  // Per-field precedence: what the circle wrote, else the reviewed workbook,
  // else the booth row. Applying this here rather than in the view layer means
  // `categories`, `work`, `media` and `circleSearchText` all pick it up, so
  // edited text becomes searchable without any extra code.
  const fields = override?.fields;
  // Not overridable: the name keys booth matching, the thumbnail index and the
  // circle id hash, so it stays whatever the reviewed sources say.
  const name = template?.name ?? booth?.name ?? "未命名社團";
  const creatorTypes = fields?.creatorTypes ?? template?.creatorTypes ?? [];
  const workTypes = fields?.workTypes ?? template?.workTypes ?? [];
  const referencedWorks = fields?.referencedWorks ?? template?.referencedWorks ?? [];
  const specialTags = fields?.specialTags ?? template?.specialTags ?? [];
  const saleInfo = fields?.saleInfo ?? template?.saleInfo;
  // `null` is a deliberate tombstone. A missing key inherits the reviewed
  // thumbnail; null must not fall through via `??` and resurrect it.
  const thumbnail = fields && Object.prototype.hasOwnProperty.call(fields, "thumbnail")
    ? fields.thumbnail
    : template?.thumbnail;
  return {
    id: circleId,
    sourceRow: template?.sourceRow,
    name,
    description: saleInfo ?? booth?.note ?? "尚未提供販售資訊。",
    categories: [...new Set([
      ...(booth ? [booth.genre, ...booth.tags.map((tag) => tag.trim()).filter(Boolean)] : []),
      ...creatorTypes,
      ...workTypes,
      ...referencedWorks,
      ...specialTags,
    ])],
    pen: fields?.pen ?? template?.pen ?? booth?.pen ?? "",
    work: referencedWorks.join("、") || booth?.work || creatorTypes.join("、") || "尚未提供作品分類",
    creatorTypes,
    ageRatings: fields?.ageRatings ?? template?.ageRatings ?? [],
    workTypes,
    referencedWorks,
    saleInfo: saleInfo ?? "",
    specialTags,
    media: thumbnail ? [{
      id: `${circleId}-thumbnail`,
      kind: "thumbnail",
      url: thumbnail.url,
      sourceUrl: thumbnail.sourceUrl,
      provider: thumbnail.provider,
      alt: `${name} 社團縮圖`,
    }] : [],
    externalLinks: (fields?.links ?? template?.links)?.map((link) => ({ ...link })) ?? [],
    updatedAt: override?.updatedAt ?? FF47_EVENT.dataUpdatedAt,
    sources: [...cloneSources(), ...templateSource(template), ...(override ? [circleSelfSource(override)] : [])],
  };
}

/**
 * Project a reviewed snapshot into the catalog read model. Pure: the same
 * payload and overrides always produce the same circles, placements and view
 * records.
 *
 * Circle-authored overrides are applied per field inside `circleFromTemplate`,
 * deliberately downstream of the name indexes below. Rewriting a template name
 * before those indexes are built would stop `findTemplate` from matching that
 * circle's booth rows, silently detaching it from every map placement.
 */
export function buildCircleCatalog(payload: CircleCatalogPayload, overrides?: CircleOverridesPayload): CircleCatalog {
  const overridesById = indexCircleOverrides(overrides);
  const templatesByName = new Map<string, CircleTemplate[]>();
  const templatesByPlacement = new Map<string, CircleTemplate[]>();
  for (const template of payload.templates) {
    const nameKey = normalizeCircleTemplateName(template.name);
    templatesByName.set(nameKey, [...(templatesByName.get(nameKey) ?? []), template]);
    for (const day of [1, 2, 3] as const) {
      for (const code of template.placements[String(day) as "1" | "2" | "3"] ?? []) {
        const key = placementKey(day, code, nameKey);
        templatesByPlacement.set(key, [...(templatesByPlacement.get(key) ?? []), template]);
      }
    }
  }

  /** Match only exact workbook evidence: same normalized name and, when present, the same day/booth. */
  const findTemplate = (name: string, day: 1 | 2 | 3, boothCode: string) => {
    const nameKey = normalizeCircleTemplateName(name);
    const placementMatches = templatesByPlacement.get(placementKey(day, boothCode.toUpperCase(), nameKey)) ?? [];
    if (placementMatches.length === 1) return placementMatches[0];
    const nameMatches = templatesByName.get(nameKey) ?? [];
    return nameMatches.length === 1 ? nameMatches[0] : undefined;
  };

  const officialSupplementKeys = new Set(payload.officialSupplementKeys);
  const circlesById = new Map<string, CircleRecord>();

  const rows = payload.booths.map((booth, index) => {
    const recordId = `${booth.id}-${index}`;
    const template = findTemplate(booth.name, booth.day, booth.code);
    // One row in the reviewed Excel master is identity evidence. Its booth cells
    // may expand to several event placements without duplicating the circle.
    const circleId = template?.id ?? recordId;
    const circle = circlesById.get(circleId) ?? circleFromTemplate(circleId, template, booth, overridesById.get(circleId));
    circlesById.set(circleId, circle);
    const placement: PlacementRecord = {
      id: recordId,
      eventId: payload.eventId,
      circleId,
      day: booth.day,
      area: booth.hall,
      boothCode: booth.code,
      status: "active",
      x: booth.x,
      y: booth.y,
      tone: booth.tone,
    };

    const organizerSource = officialSupplementKeys.has(`${booth.day}:${booth.code}`) ? buildOfficialSource(booth.day) : buildOfficialSource();
    const placementSources = [organizerSource, ...circle.sources.filter((source) => source.provider !== "開拓動漫")];
    const view: CircleViewRecord = { ...booth, recordId, sources: placementSources, circle, placement };
    return { circle, placement, view };
  });

  // Keep known Excel circles even when their row currently has no numbered booth
  // (for example an enterprise/guest entry). They remain searchable data, but do
  // not fabricate a PlacementRecord or map slot.
  for (const template of payload.templates) {
    if (circlesById.has(template.id)) continue;
    circlesById.set(template.id, circleFromTemplate(template.id, template, undefined, overridesById.get(template.id)));
  }

  const records = rows.map(({ view }) => view);
  const recordsByCircleId = new Map<string, CircleViewRecord[]>();
  const idMigrationTargets = new Map<string, string[]>();
  Object.entries(payload.legacyCircleIds).forEach(([legacyId, circleId]) => {
    idMigrationTargets.set(legacyId, [circleId]);
  });
  records.forEach((record) => {
    recordsByCircleId.set(record.circle.id, [...(recordsByCircleId.get(record.circle.id) ?? []), record]);
    idMigrationTargets.set(record.circle.id, [record.circle.id]);
    idMigrationTargets.set(record.recordId, [record.circle.id]);
    idMigrationTargets.set(record.id, [...new Set([...(idMigrationTargets.get(record.id) ?? []), record.circle.id])]);
  });

  const circles = [...circlesById.values()];
  return {
    generatedAt: payload.generatedAt,
    circles,
    circlesById: new Map(circles.map((circle) => [circle.id, circle])),
    placements: rows.map(({ placement }) => placement),
    records,
    recordsById: new Map(records.map((record) => [record.recordId, record])),
    recordsByCircleId,
    idMigrationTargets,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCircleIdMap(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([legacyId, circleId]) => legacyId.startsWith("ff47-") && /^c-\d{6}$/.test(circleId));
}

function isBooth(value: unknown): value is Booth {
  if (!value || typeof value !== "object") return false;
  const booth = value as Record<string, unknown>;
  return typeof booth.id === "string" && typeof booth.code === "string" && typeof booth.name === "string"
    && typeof booth.pen === "string" && typeof booth.genre === "string" && isStringArray(booth.tags)
    && (booth.day === 1 || booth.day === 2 || booth.day === 3) && (booth.hall === "A" || booth.hall === "B")
    && typeof booth.x === "number" && typeof booth.y === "number" && typeof booth.tone === "string"
    && typeof booth.work === "string" && typeof booth.note === "string";
}

function isTemplate(value: unknown): value is CircleTemplate {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  const placements = template.placements as Record<string, unknown> | undefined;
  return typeof template.id === "string" && typeof template.name === "string" && Number.isInteger(template.sourceRow)
    && !!placements && (["1", "2", "3"] as const).every((day) => isStringArray(placements[day]))
    && isStringArray(template.creatorTypes) && isStringArray(template.ageRatings) && isStringArray(template.workTypes)
    && isStringArray(template.referencedWorks) && isStringArray(template.specialTags) && isStringArray(template.surveyUrls)
    && Array.isArray(template.links);
}

/** Reject any snapshot the read model cannot project, rather than half-rendering it. */
export function isCircleCatalogPayload(value: unknown): value is CircleCatalogPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.schema === CIRCLE_CATALOG_SCHEMA
    && typeof payload.eventId === "string" && typeof payload.generatedAt === "string"
    && isStringArray(payload.officialSupplementKeys)
    && isCircleIdMap(payload.legacyCircleIds)
    && Array.isArray(payload.booths) && payload.booths.length > 0 && payload.booths.every(isBooth)
    && Array.isArray(payload.templates) && payload.templates.every(isTemplate);
}

export const EMPTY_CIRCLE_CATALOG: CircleCatalog = {
  generatedAt: "",
  circles: [],
  circlesById: new Map(),
  placements: [],
  records: [],
  recordsById: new Map(),
  recordsByCircleId: new Map(),
  idMigrationTargets: new Map(),
};

export type CircleCatalogStatus = "loading" | "ready" | "error";

export type CatalogState = {
  eventId: string;
  catalog: CircleCatalog;
  status: CircleCatalogStatus;
  error: string;
  overlayStatus: "idle" | "loading" | "applied" | "unavailable";
  overlayError: string;
  /** Kept so a later overlay can rebuild without refetching the 1.8 MB base. */
  payload?: CircleCatalogPayload;
  overrides?: CircleOverridesPayload;
};

const states = new Map<string, CatalogState>();
const listeners = new Map<string, Set<() => void>>();
let defaultEventId = "";

function initialState(eventId: string): CatalogState {
  return { eventId, catalog: EMPTY_CIRCLE_CATALOG, status: "loading", error: "", overlayStatus: "idle", overlayError: "" };
}

function stateFor(eventId: string) {
  const current = states.get(eventId);
  if (current) return current;
  const created = initialState(eventId);
  states.set(eventId, created);
  return created;
}

function publish(eventId: string, next: CatalogState) {
  states.set(eventId, next);
  listeners.get(eventId)?.forEach((listener) => listener());
}

/** Snapshot getter. React reads this through `useCircleCatalog`. */
export function getCircleCatalogState(eventId = defaultEventId) {
  return stateFor(eventId);
}

export function getCircleCatalog(eventId = defaultEventId) {
  return stateFor(eventId).catalog;
}

export function setCircleCatalog(payload: CircleCatalogPayload, overrides?: CircleOverridesPayload) {
  if (overrides && overrides.eventId !== payload.eventId) throw new Error(`Overlay event ${overrides.eventId} does not match base event ${payload.eventId}.`);
  defaultEventId ||= payload.eventId;
  publish(payload.eventId, {
    eventId: payload.eventId,
    catalog: buildCircleCatalog(payload, overrides),
    status: "ready",
    error: "",
    overlayStatus: overrides ? "applied" : "idle",
    overlayError: "",
    payload,
    overrides,
  });
}

/**
 * Apply circle-authored content on top of an already-loaded base catalog.
 * Ignored when the base has not arrived, so the overlay can never be the thing
 * that puts a reader into a broken state.
 */
export function setCircleOverrides(overrides: CircleOverridesPayload) {
  const current = stateFor(overrides.eventId);
  if (!current.payload) throw new Error(`Cannot apply an overlay before base catalog ${overrides.eventId}.`);
  publish(overrides.eventId, { ...current, overrides, overlayStatus: "applied", overlayError: "", catalog: buildCircleCatalog(current.payload, overrides) });
}

export function markCircleOverlayLoading(eventId: string) {
  const current = stateFor(eventId);
  if (current.status === "ready") publish(eventId, { ...current, overlayStatus: "loading", overlayError: "" });
}

export function failCircleOverlay(eventId: string, error: string) {
  const current = stateFor(eventId);
  if (current.status === "ready") publish(eventId, { ...current, overlayStatus: "unavailable", overlayError: error });
}

export function failCircleCatalog(eventId: string, error: string) {
  publish(eventId, { ...initialState(eventId), status: "error", error, overlayStatus: "unavailable" });
}

/** Test and authoring seam: drop back to the pre-load state. */
export function resetCircleCatalog(eventId?: string) {
  if (eventId) {
    publish(eventId, initialState(eventId));
    return;
  }
  const eventIds = [...states.keys()];
  states.clear();
  defaultEventId = "";
  eventIds.forEach((id) => listeners.get(id)?.forEach((listener) => listener()));
}

export function subscribeCircleCatalog(eventId: string, listener: () => void) {
  const scoped = listeners.get(eventId) ?? new Set<() => void>();
  scoped.add(listener);
  listeners.set(eventId, scoped);
  return () => { scoped.delete(listener); };
}

export function circleIdMigrationTargets(circleId: string, eventId = defaultEventId) {
  return stateFor(eventId).catalog.idMigrationTargets.get(circleId) ?? [circleId];
}

export function isKnownCircleId(circleId: string, eventId = defaultEventId) {
  const catalog = stateFor(eventId).catalog;
  return catalog.circlesById.has(circleId) || catalog.recordsById.has(circleId);
}

export function circleSearchText(record: CircleViewRecord) {
  return [record.code, record.name, record.circle.pen, record.genre, record.circle.work, record.note, record.circle.saleInfo,
    ...record.tags, ...record.circle.creatorTypes, ...record.circle.ageRatings, ...record.circle.workTypes,
    ...record.circle.referencedWorks, ...record.circle.specialTags, ...record.circle.externalLinks.flatMap((link) => [link.provider, link.url])]
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
}
