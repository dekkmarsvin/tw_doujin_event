import type { CircleExternalLink, CircleTemplateLinkKind } from "./circle-records";

export const CIRCLE_OVERRIDES_SCHEMA = "circle-overrides/1" as const;

/**
 * Fields a circle may supply about itself. Placements, sources and identity
 * keys are absent by construction: the organizer's booth data is authoritative,
 * and a self-written `SourceLink` would let a circle forge official attribution.
 *
 * The circle name is absent too, matching Comic Market's circle editor, which
 * lets a circle correct its credited author but never its own name. Here the
 * name additionally keys booth matching and the thumbnail index, and is half
 * the input to the circle id hash — changing it would detach the circle from
 * its placements and from every reader's saved favorites. A wrong name is
 * corrected upstream in the reviewed workbook, which is the single source.
 *
 * An absent key inherits the reviewed catalog value; a present key replaces it
 * wholesale. Arrays are never merged item-by-item — that is impossible to
 * explain to an editor and impossible to test exhaustively.
 */
export type CircleOverrideFields = {
  pen?: string;
  saleInfo?: string;
  creatorTypes?: string[];
  ageRatings?: string[];
  workTypes?: string[];
  referencedWorks?: string[];
  specialTags?: string[];
  links?: CircleExternalLink[];
  thumbnail?: { sourceUrl: string; url: string; provider: string };
};

export type CircleOverride = {
  circleId: string;
  updatedAt: string;
  fields: CircleOverrideFields;
};

export type CircleOverridesPayload = {
  schema: typeof CIRCLE_OVERRIDES_SCHEMA;
  eventId: string;
  generatedAt: string;
  revision: number;
  overrides: CircleOverride[];
};

/** Caps exist so one circle cannot bloat the document every reader downloads. */
export const OVERRIDE_LIMITS = {
  pen: 80,
  saleInfo: 2000,
  listItems: 20,
  listItemLength: 60,
  links: 12,
  serializedFields: 8192,
} as const;

const LIST_FIELDS = ["creatorTypes", "ageRatings", "workTypes", "referencedWorks", "specialTags"] as const;

/** The only accepted kinds. Exported so the editor cannot offer a value this file would reject. */
export const LINK_KINDS: readonly CircleTemplateLinkKind[] = ["social", "support", "website", "announcement", "catalog", "store", "sample"];

/**
 * Remote images are fetched by every reader who views the circle, so an
 * arbitrary host would be an IP-logging beacon aimed at the whole audience.
 * Restricting the host is what later lets `img-src` tighten from `https:`.
 */
export const THUMBNAIL_HOST_ALLOWLIST: readonly string[] = [
  "drive.google.com",
  "lh3.googleusercontent.com",
  "i.pximg.net",
  "pbs.twimg.com",
  "i.imgur.com",
];

/** Exported so the editor's inline warnings cannot disagree with this validator. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Explicit protocol check: never rely on framework escaping to stop
  // `javascript:` or `data:` reaching an href.
  return url.protocol === "https:";
}

/** Exported for the same reason as `isHttpsUrl`: one host rule, not two. */
export function isAllowedThumbnailHost(value: string) {
  try {
    return THUMBNAIL_HOST_ALLOWLIST.includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isBoundedList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= OVERRIDE_LIMITS.listItems
    && value.every((item) => isBoundedString(item, OVERRIDE_LIMITS.listItemLength));
}

function isLink(value: unknown): value is CircleExternalLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return isBoundedString(link.provider, OVERRIDE_LIMITS.listItemLength)
    && typeof link.kind === "string" && LINK_KINDS.includes(link.kind as CircleTemplateLinkKind)
    && isHttpsUrl(link.url);
}

function isThumbnail(value: unknown): value is CircleOverrideFields["thumbnail"] {
  if (!value || typeof value !== "object") return false;
  const thumbnail = value as Record<string, unknown>;
  return isHttpsUrl(thumbnail.url) && isAllowedThumbnailHost(thumbnail.url)
    && isHttpsUrl(thumbnail.sourceUrl)
    && isBoundedString(thumbnail.provider, OVERRIDE_LIMITS.listItemLength);
}

/** Shared by the write route and the read guard so both enforce one ruleset. */
export function isCircleOverrideFields(value: unknown): value is CircleOverrideFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;

  // `name` is deliberately not here: an override carrying one is refused, not
  // silently dropped, so a client sending it learns the field is not authorable.
  const known = new Set(["pen", "saleInfo", "links", "thumbnail", ...LIST_FIELDS]);
  if (Object.keys(fields).some((key) => !known.has(key))) return false;

  if ("pen" in fields && !isBoundedString(fields.pen, OVERRIDE_LIMITS.pen)) return false;
  if ("saleInfo" in fields && !isBoundedString(fields.saleInfo, OVERRIDE_LIMITS.saleInfo)) return false;
  if (LIST_FIELDS.some((field) => field in fields && !isBoundedList(fields[field]))) return false;
  if ("links" in fields && !(Array.isArray(fields.links) && fields.links.length <= OVERRIDE_LIMITS.links && fields.links.every(isLink))) return false;
  if ("thumbnail" in fields && !isThumbnail(fields.thumbnail)) return false;

  return JSON.stringify(fields).length <= OVERRIDE_LIMITS.serializedFields;
}

function isCircleOverride(value: unknown): value is CircleOverride {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  return typeof override.circleId === "string" && override.circleId.length > 0
    && typeof override.updatedAt === "string"
    && isCircleOverrideFields(override.fields);
}

/**
 * Validate the envelope, then keep only the entries the read model can project.
 * A malformed envelope rejects the whole document, but one bad entry must not
 * discard every other circle's contributions — this layer is an optional
 * enhancement, so it degrades entry by entry rather than all at once.
 */
export function parseCircleOverridesPayload(value: unknown): CircleOverridesPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.schema !== CIRCLE_OVERRIDES_SCHEMA) return null;
  if (typeof payload.eventId !== "string" || typeof payload.generatedAt !== "string") return null;
  if (!Number.isInteger(payload.revision)) return null;
  if (!Array.isArray(payload.overrides)) return null;

  return {
    schema: CIRCLE_OVERRIDES_SCHEMA,
    eventId: payload.eventId,
    generatedAt: payload.generatedAt,
    revision: payload.revision as number,
    overrides: payload.overrides.filter(isCircleOverride),
  };
}

export function isCircleOverridesPayload(value: unknown): value is CircleOverridesPayload {
  return parseCircleOverridesPayload(value) !== null;
}

export function indexCircleOverrides(payload?: CircleOverridesPayload) {
  return new Map((payload?.overrides ?? []).map((override) => [override.circleId, override]));
}
