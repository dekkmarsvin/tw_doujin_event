import type { CircleExternalLink, CircleTemplateLinkKind } from "./circle-records";
import { isCircleCategoryLabel, type CircleCategoryCatalog } from "./circle-categories";
import { ACTIVE_EVENT, getEventDefinition } from "./event-catalog";

export const CIRCLE_OVERRIDES_SCHEMA = "circle-overrides/1" as const;

/**
 * Fields a circle may supply about itself. Placements, sources and identity
 * keys are absent by construction: the organizer's booth data is authoritative,
 * and a self-written `SourceLink` would let a circle forge official attribution.
 *
 * The circle name is absent too, matching Comic Market's circle editor, which
 * lets a circle correct its credited author but never its own name. Here the
 * name additionally keys booth matching against the organizer's published
 * lists. ADR-0010 removed it from identity allocation, but did not remove that
 * reviewed join; changing it here could still detach a circle from organizer
 * data. A wrong name is corrected in the reviewed source rather than by an
 * unverified self-authored overlay.
 *
 * An absent key inherits the reviewed catalog value; a present key replaces it
 * wholesale. Arrays are never merged item-by-item — that is impossible to
 * explain to an editor and impossible to test exhaustively.
 */
export type CircleOverrideThumbnail = { sourceUrl: string; url: string; provider: string };

export type CircleOverrideFields = {
  pen?: string;
  saleInfo?: string;
  circleCategory?: string;
  creatorTypes?: string[];
  ageRatings?: string[];
  workTypes?: string[];
  referencedWorks?: string[];
  specialTags?: string[];
  links?: CircleExternalLink[];
  /**
   * `null` is an explicit tombstone. Since ADR-0012 retired the workbook
   * thumbnail index there is no reviewed thumbnail left to inherit, so absence
   * and `null` now yield the same reader-visible result; the tombstone stays
   * accepted so an editor clearing the field is never answered with a 400.
   */
  thumbnail?: CircleOverrideThumbnail | null;
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

/**
 * How long a circle's own contributions live, chosen by the circle while it
 * writes them (ADR-0018).
 *
 * `keep` is the default because the irreversible side must never be the one
 * nobody chose. `purge` deletes the row once the event has been over for
 * `OVERRIDE_RETENTION_PURGE_AFTER_MS` — and stays public for the whole of that
 * window: the deadline is a lifespan, not an early withdrawal. A circle that
 * wants to be gone sooner deletes it itself.
 *
 * These are the values written onto the row, not a rule applied at read time:
 * every row carries its own deadline so it can be queried, not derived.
 */
const OVERRIDE_RETENTION_CHOICES = ["keep", "purge"] as const;

export type CircleRetentionChoice = (typeof OVERRIDE_RETENTION_CHOICES)[number];

/** Counted from the end of the event, never from the last edit: the reason for
 * the deadline is that the event is over, not that the circle stopped editing. */
export const OVERRIDE_RETENTION_PURGE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export function isRetentionChoice(value: unknown): value is CircleRetentionChoice {
  return typeof value === "string" && (OVERRIDE_RETENTION_CHOICES as readonly string[]).includes(value);
}

/** The instant a row disappears, or `null` for the rows that never do. */
export function circleRetentionExpiresAt(choice: CircleRetentionChoice, eventEndsAt: number) {
  return choice === "purge" ? eventEndsAt + OVERRIDE_RETENTION_PURGE_AFTER_MS : null;
}

export const CIRCLE_OVERRIDE_LIST_FIELDS = [
  { key: "referencedWorks", label: "作品／題材" },
  { key: "creatorTypes", label: "創作者類型" },
  { key: "workTypes", label: "作品類型" },
  { key: "ageRatings", label: "年齡分級" },
  { key: "specialTags", label: "作品標籤" },
] as const;

/**
 * 三個 facet 的可選值。編輯器只提供這些選項，搜尋面板讀同一份，兩邊不會漂移。
 *
 * 寫入驗證刻意不做成員檢查：`isCircleOverrideFields` 同時是讀取端守門，
 * 收緊會讓既有含舊值的 override 整列從公開文件消失。收斂靠編輯器的選項，
 * 舊值在作者下次編輯時換掉（ADR-0051）。
 */
export const CREATOR_TYPE_OPTIONS = [
  "繪師",
  "Coser",
  "Vtuber",
  "寫手",
  "音聲作品",
  "手工藝品",
  "模型",
  "攝影",
] as const;

export const WORK_TYPE_OPTIONS = ["男性向", "女性向", "一般向"] as const;

export const AGE_RATING_OPTIONS = ["全年齡", "R18"] as const;

const LIST_FIELDS = CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key }) => key);
const TEXT_FIELDS = ["pen", "saleInfo"] as const;

/** One editable-scope authority shared by validation, editor controls and tests. */
export const CIRCLE_OVERRIDE_FIELD_KEYS = [...TEXT_FIELDS, "circleCategory", ...LIST_FIELDS, "links", "thumbnail"] as const satisfies readonly (keyof CircleOverrideFields)[];

export type CircleOverrideFieldKey = (typeof CIRCLE_OVERRIDE_FIELD_KEYS)[number];
type CircleOverrideFieldMode = "inherit" | "replace" | "clear";

export function circleOverrideFieldMode(fields: CircleOverrideFields, key: CircleOverrideFieldKey): CircleOverrideFieldMode {
  if (!Object.prototype.hasOwnProperty.call(fields, key)) return "inherit";
  const value = fields[key];
  return value === null || value === "" || (Array.isArray(value) && value.length === 0) ? "clear" : "replace";
}

/** Remove the key entirely so the reviewed snapshot remains authoritative. */
export function inheritCircleOverrideField(fields: CircleOverrideFields, key: CircleOverrideFieldKey): CircleOverrideFields {
  const next = { ...fields };
  delete next[key];
  return next;
}

/** Encode an explicit tombstone without making the editor duplicate field kinds. */
export function clearCircleOverrideField(fields: CircleOverrideFields, key: CircleOverrideFieldKey): CircleOverrideFields {
  if (key === "thumbnail") return { ...fields, thumbnail: null };
  if (key === "links") return { ...fields, links: [] };
  if (LIST_FIELDS.includes(key as (typeof LIST_FIELDS)[number])) return { ...fields, [key]: [] };
  return { ...fields, [key]: "" };
}

/** The only accepted kinds. Exported so the editor cannot offer a value this file would reject. */
export const LINK_KINDS: readonly CircleTemplateLinkKind[] = ["social", "support", "website", "announcement", "catalog", "store", "sample"];

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

/**
 * Provenance is optional on a thumbnail (ADR-0053): a circle's own artwork has
 * no other page to cite, and demanding one only teaches authors to paste
 * something that is not a source. Empty means "not stated"; a stated source is
 * still checked, so a filled field is never a broken link.
 */
function isThumbnail(value: unknown): value is CircleOverrideThumbnail {
  if (!value || typeof value !== "object") return false;
  const thumbnail = value as Record<string, unknown>;
  return isHttpsUrl(thumbnail.url)
    && (thumbnail.sourceUrl === "" || isHttpsUrl(thumbnail.sourceUrl))
    && isBoundedString(thumbnail.provider, OVERRIDE_LIMITS.listItemLength);
}

/**
 * Why the payload is refused, or `null` when it is fine.
 *
 * The write route answers with this sentence rather than one message for every
 * field: an author who cannot see which row is wrong cannot fix it. The type
 * guard below is this function, so there is one ruleset and the reason can
 * never describe a rule the guard does not enforce.
 */
export function circleOverrideFieldsProblem(
  value: unknown,
  categories: CircleCategoryCatalog | null = ACTIVE_EVENT.circleCategories,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "資料格式不符。";
  const fields = value as Record<string, unknown>;

  // `name` is deliberately not here: an override carrying one is refused, not
  // silently dropped, so a client sending it learns the field is not authorable.
  const known = new Set<string>(CIRCLE_OVERRIDE_FIELD_KEYS);
  const unknownKey = Object.keys(fields).find((key) => !known.has(key));
  if (unknownKey) return `這裡不能填寫「${unknownKey}」。`;

  if ("pen" in fields && !isBoundedString(fields.pen, OVERRIDE_LIMITS.pen)) return `筆名最多 ${OVERRIDE_LIMITS.pen} 字。`;
  if ("saleInfo" in fields && !isBoundedString(fields.saleInfo, OVERRIDE_LIMITS.saleInfo)) return `販售資訊最多 ${OVERRIDE_LIMITS.saleInfo} 字。`;
  if ("circleCategory" in fields && !(categories
    ? isCircleCategoryLabel(categories, fields.circleCategory)
    : isBoundedString(fields.circleCategory, OVERRIDE_LIMITS.listItemLength))) return "社團主題類別不在這場活動的類別清單裡。";
  const listField = CIRCLE_OVERRIDE_LIST_FIELDS.find(({ key }) => key in fields && !isBoundedList(fields[key]));
  if (listField) return `${listField.label}最多 ${OVERRIDE_LIMITS.listItems} 項，每項最多 ${OVERRIDE_LIMITS.listItemLength} 字。`;
  if ("links" in fields && !(Array.isArray(fields.links) && fields.links.length <= OVERRIDE_LIMITS.links && fields.links.every(isLink))) {
    return `外部連結最多 ${OVERRIDE_LIMITS.links} 個，每個都要有平台名稱與 https:// 網址。`;
  }
  if ("thumbnail" in fields && fields.thumbnail !== null && !isThumbnail(fields.thumbnail)) {
    return "代表圖需要 https:// 的圖片網址；出處頁面若要填寫也必須是 https。";
  }

  return JSON.stringify(fields).length <= OVERRIDE_LIMITS.serializedFields
    ? null
    : `全部欄位合計超過 ${OVERRIDE_LIMITS.serializedFields} 字元，請縮短內容或連結。`;
}

/** Shared by the write route and the read guard so both enforce one ruleset. */
export function isCircleOverrideFields(
  value: unknown,
  categories: CircleCategoryCatalog | null = ACTIVE_EVENT.circleCategories,
): value is CircleOverrideFields {
  return circleOverrideFieldsProblem(value, categories) === null;
}

function isCircleOverride(value: unknown, categories: CircleCategoryCatalog | null): value is CircleOverride {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  return typeof override.circleId === "string" && override.circleId.length > 0
    && typeof override.updatedAt === "string"
    && isCircleOverrideFields(override.fields, categories);
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

  const event = getEventDefinition(payload.eventId);
  return {
    schema: CIRCLE_OVERRIDES_SCHEMA,
    eventId: payload.eventId,
    generatedAt: payload.generatedAt,
    revision: payload.revision as number,
    // A transport may need to parse a structurally valid foreign-event
    // envelope before it can report the event-id mismatch. Known events also
    // enforce their catalog vocabulary; an unknown event gets only the bounded
    // string guard and can never be projected as the active event.
    overrides: payload.overrides.filter((override) => isCircleOverride(override, event?.circleCategories ?? null)),
  };
}

export function indexCircleOverrides(payload?: CircleOverridesPayload) {
  return new Map((payload?.overrides ?? []).map((override) => [override.circleId, override]));
}
