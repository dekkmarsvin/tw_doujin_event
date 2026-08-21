import { ACTIVE_EVENT, getEventDefinition, type EventDefinition } from "./event-catalog";
import { indexCircleOverrides } from "./circle-overrides";
import type { CircleOverride, CircleOverridesPayload } from "./circle-overrides";
import type { Booth, Tone } from "./booth";

export const CIRCLE_CATALOG_SCHEMA = "circle-catalog/3" as const;

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

/** Organizer-confirmed identity included in an event's thin base catalog. */
export type CatalogCircle = {
  id: string;
  name: string;
};

export type CatalogPlacement = {
  id: string;
  circleId: string;
  day: string | number;
  area: string;
  boothCode: string;
  status: "active" | "cancelled" | "moved";
  tone: Tone;
};

/** Versioned official-only base. Circle-authored fields arrive via overlay. */
export type CircleCatalogPayload = {
  schema: typeof CIRCLE_CATALOG_SCHEMA;
  eventId: string;
  generatedAt: string;
  circles: CatalogCircle[];
  placements: CatalogPlacement[];
};

/** A circle's reusable identity and catalog metadata, independent of a booth. */
export type CircleRecord = {
  id: string;
  sourceRow?: number;
  name: string;
  nameReading?: string;
  description: string;
  categories: string[];
  circleCategory: string;
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
  circleIdAliases: Map<string, string[]>;
};

export function normalizeCircleName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

function buildOfficialSource(event: EventDefinition, fetchedAt: string, day?: Booth["day"]): SourceLink {
  return {
    provider: "活動主辦單位",
    contentType: "official",
    label: day ? `${event.name} ${day} 日攤位清單` : `${event.name} 活動與攤位配置`,
    url: day ? event.organizer.boothListUrls[day] : event.organizer.eventUrl,
    fetchedAt,
    status: "linked",
  };
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

function circleFromBase(base: CatalogCircle, event: EventDefinition, generatedAt: string, override?: CircleOverride): CircleRecord {
  const fields = override?.fields;
  const creatorTypes = fields?.creatorTypes ?? [];
  const workTypes = fields?.workTypes ?? [];
  const referencedWorks = fields?.referencedWorks ?? [];
  const specialTags = fields?.specialTags ?? [];
  const circleCategory = fields?.circleCategory ?? "";
  const saleInfo = fields?.saleInfo ?? "";
  const thumbnail = fields?.thumbnail;
  return {
    id: base.id,
    name: base.name,
    description: saleInfo,
    categories: [...new Set([circleCategory, ...creatorTypes, ...workTypes, ...referencedWorks, ...specialTags].filter(Boolean))],
    circleCategory,
    pen: fields?.pen ?? "",
    work: referencedWorks.join("、") || creatorTypes.join("、"),
    creatorTypes,
    ageRatings: fields?.ageRatings ?? [],
    workTypes,
    referencedWorks,
    saleInfo,
    specialTags,
    media: thumbnail ? [{
      id: `${base.id}-thumbnail`,
      kind: "thumbnail",
      url: thumbnail.url,
      sourceUrl: thumbnail.sourceUrl,
      provider: thumbnail.provider,
      alt: `${base.name} 社團縮圖`,
    }] : [],
    externalLinks: fields?.links?.map((link) => ({ ...link })) ?? [],
    updatedAt: override?.updatedAt ?? generatedAt,
    sources: [buildOfficialSource(event, generatedAt), ...(override ? [circleSelfSource(override)] : [])],
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
export function buildCircleCatalog(payload: CircleCatalogPayload, overrides?: CircleOverridesPayload, eventDefinition?: EventDefinition): CircleCatalog {
  const overridesById = indexCircleOverrides(overrides);
  const event = eventDefinition ?? getEventDefinition(payload.eventId) ?? ACTIVE_EVENT;
  const circlesById = new Map(payload.circles.map((base) => [
    base.id,
    circleFromBase(base, event, payload.generatedAt, overridesById.get(base.id)),
  ]));

  const rows = payload.placements.map((sourcePlacement) => {
    const circle = circlesById.get(sourcePlacement.circleId);
    if (!circle) throw new Error(`Placement ${sourcePlacement.id} refers to unknown circle ${sourcePlacement.circleId}.`);
    const placement: PlacementRecord = { ...sourcePlacement, eventId: payload.eventId };
    const booth: Booth = {
      id: placement.id,
      code: placement.boothCode,
      name: circle.name,
      pen: "",
      genre: circle.circleCategory || event.genres[0],
      tags: [],
      day: placement.day,
      hall: placement.area,
      x: 0,
      y: 0,
      tone: placement.tone,
      work: "",
      note: "",
    };
    const sources = [
      buildOfficialSource(event, payload.generatedAt, placement.day),
      ...circle.sources.filter((source) => source.contentType === "circle"),
    ];
    const view: CircleViewRecord = { ...booth, recordId: placement.id, sources, circle, placement };
    return { placement, view };
  });

  const records = rows.map(({ view }) => view);
  const recordsByCircleId = new Map<string, CircleViewRecord[]>();
  // Booth-scoped ids stay resolvable because a shared link may carry one; they
  // are derived from the records in hand, not from a stored table. The `ff47-`
  // content hashes are gone with their map (ADR-0013).
  const circleIdAliases = new Map<string, string[]>();
  records.forEach((record) => {
    recordsByCircleId.set(record.circle.id, [...(recordsByCircleId.get(record.circle.id) ?? []), record]);
    circleIdAliases.set(record.circle.id, [record.circle.id]);
    circleIdAliases.set(record.recordId, [record.circle.id]);
    circleIdAliases.set(record.id, [...new Set([...(circleIdAliases.get(record.id) ?? []), record.circle.id])]);
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
    circleIdAliases,
  };
}

const TONES: readonly string[] = ["coral", "mint", "blue", "amber", "lilac"];

function isCatalogCircle(value: unknown): value is CatalogCircle {
  if (!value || typeof value !== "object") return false;
  const circle = value as Record<string, unknown>;
  return Object.keys(circle).every((key) => key === "id" || key === "name")
    && /^c-\d{6}$/.test(String(circle.id ?? "")) && typeof circle.name === "string" && circle.name.trim().length > 0;
}

function isCatalogPlacement(value: unknown): value is CatalogPlacement {
  if (!value || typeof value !== "object") return false;
  const placement = value as Record<string, unknown>;
  const allowed = new Set(["id", "circleId", "day", "area", "boothCode", "status", "tone"]);
  return Object.keys(placement).every((key) => allowed.has(key))
    && typeof placement.id === "string" && /^c-\d{6}$/.test(String(placement.circleId ?? ""))
    && (typeof placement.day === "string" || typeof placement.day === "number")
    && typeof placement.area === "string" && typeof placement.boothCode === "string"
    && ["active", "cancelled", "moved"].includes(String(placement.status))
    && TONES.includes(String(placement.tone));
}

/** Reject any snapshot the read model cannot project, rather than half-rendering it. */
export function isCircleCatalogPayload(value: unknown): value is CircleCatalogPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const circles = Array.isArray(payload.circles) ? payload.circles : [];
  const placements = Array.isArray(payload.placements) ? payload.placements : [];
  return payload.schema === CIRCLE_CATALOG_SCHEMA
    && typeof payload.eventId === "string" && typeof payload.generatedAt === "string"
    && circles.length > 0 && circles.every(isCatalogCircle)
    && new Set(circles.map((circle) => (circle as CatalogCircle).id)).size === circles.length
    && placements.length > 0 && placements.every(isCatalogPlacement)
    && new Set(placements.map((placement) => (placement as CatalogPlacement).id)).size === placements.length
    && placements.every((placement) => circles.some((circle) => (circle as CatalogCircle).id === (placement as CatalogPlacement).circleId));
}

export const EMPTY_CIRCLE_CATALOG: CircleCatalog = {
  generatedAt: "",
  circles: [],
  circlesById: new Map(),
  placements: [],
  records: [],
  recordsById: new Map(),
  recordsByCircleId: new Map(),
  circleIdAliases: new Map(),
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

/** Resolve a booth-scoped id from a shared link to the circle it belongs to. */
export function resolveCircleIdAliases(circleId: string, eventId = defaultEventId) {
  return stateFor(eventId).catalog.circleIdAliases.get(circleId) ?? [circleId];
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
