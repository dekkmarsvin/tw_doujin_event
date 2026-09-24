/** 已發布活動的設定宣告（ADR-0068 決策 2）。
 *
 * A correction candidate keeps its draft equal to the published baseline; what
 * it changes about the event itself is declared here, next to the roster
 * declarations, and reviewed with them. Only the allow-listed settings can be
 * declared. Anything touching booths, maps or identity — adding or removing a
 * day, venues, areas, templates — stays out until a later decision.
 */
import { parseEventImage, sameEventImage, type EventImage } from "./event-image";
import { parseOrganizerEventDraft, serializeOrganizerEventDraft, validateOrganizerEventDraft, type OrganizerEventDraft } from "./organizer-event";

export type OrganizerAmendmentSettings = {
  name?: string;
  /** Declared as a whole list; an empty list removes every alias. */
  aliases?: string[];
  /** Only days whose date changes, in the baseline's day order. */
  days?: Array<{ id: string; date: string }>;
  /** A new picture, or null to remove the published one (#396). */
  image?: EventImage | null;
};

export type OrganizerAmendmentSettingsImpact =
  | { field: "name"; before: string; after: string }
  | { field: "aliases"; before: string[]; after: string[] }
  | { field: "day"; dayId: string; label: string; before: string; after: string }
  | { field: "image"; before: EventImage | null; after: EventImage | null };

/** `status` is the HTTP answer: a declaration the rules refuse is 422, one too large to store is 413. */
export class AmendmentSettingsError extends Error {
  constructor(message: string, readonly status: 413 | 422 = 422) { super(message); }
}

const SETTING_KEYS = ["name", "aliases", "days", "image"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: string) => value.normalize("NFKC").trim();

/** The draft the correction publishes: the baseline with the declaration applied. */
export function applyAmendmentSettings(baseline: OrganizerEventDraft, settings: OrganizerAmendmentSettings | null): OrganizerEventDraft {
  if (!settings) return baseline;
  const dates = new Map((settings.days ?? []).map((day) => [day.id, day.date]));
  // Parsing again puts the result in the draft's own canonical shape, so an
  // emptied alias list disappears the same way it does on a first save.
  const { image: baselineImage, ...event } = baseline.event;
  const image = settings.image === undefined ? baselineImage : settings.image ?? undefined;
  const draft = parseOrganizerEventDraft({ ...baseline, event: {
    ...event,
    ...(settings.name !== undefined ? { name: settings.name } : {}),
    ...(settings.aliases !== undefined ? { aliases: settings.aliases } : {}),
    ...(image ? { image } : {}),
    days: baseline.event.days.map((day) => dates.has(day.id) ? { ...day, date: dates.get(day.id)! } : day),
  } });
  if (!draft) throw new AmendmentSettingsError("活動設定宣告無效。");
  return draft;
}

/** Validates a declaration against the baseline and returns its one stored
 * form: values equal to the baseline drop out, and nothing left is null. */
export function normalizeAmendmentSettings(baseline: OrganizerEventDraft, input: unknown): OrganizerAmendmentSettings | null {
  if (input === undefined || input === null) return null;
  if (!record(input) || Object.keys(input).some((key) => !SETTING_KEYS.includes(key))) {
    throw new AmendmentSettingsError("只能更正活動名稱、活動別稱、活動日的日期與活動圖片。");
  }
  let name: string | undefined;
  if (input.name !== undefined) {
    if (typeof input.name !== "string") throw new AmendmentSettingsError("活動名稱必須是文字。");
    if (text(input.name) !== baseline.event.name) name = text(input.name);
  }
  let aliases: string[] | undefined;
  if (input.aliases !== undefined) {
    if (!Array.isArray(input.aliases) || input.aliases.some((alias) => typeof alias !== "string")) {
      throw new AmendmentSettingsError("活動別稱必須是文字清單。");
    }
    const next = (input.aliases as string[]).map(text).filter(Boolean);
    if (JSON.stringify(next) !== JSON.stringify(baseline.event.aliases ?? [])) aliases = next;
  }
  let days: Array<{ id: string; date: string }> | undefined;
  if (input.days !== undefined) {
    if (!Array.isArray(input.days)) throw new AmendmentSettingsError("活動日更正必須是清單。");
    const declared = new Map<string, string>();
    for (const day of input.days) {
      if (!record(day) || Object.keys(day).some((key) => key !== "id" && key !== "date")
        || typeof day.id !== "string" || typeof day.date !== "string") {
        throw new AmendmentSettingsError("活動日更正只接受活動日代號與日期。");
      }
      if (!baseline.event.days.some((item) => item.id === day.id) || declared.has(day.id)) {
        throw new AmendmentSettingsError("只能更正既有活動日的日期，不能新增或刪除活動日。");
      }
      declared.set(day.id, day.date.trim());
    }
    const changed = baseline.event.days
      .filter((day) => declared.has(day.id) && declared.get(day.id) !== day.date)
      .map((day) => ({ id: day.id, date: declared.get(day.id)! }));
    if (changed.length > 0) days = changed;
  }
  let image: EventImage | null | undefined;
  if (input.image !== undefined) {
    const next = input.image === null ? null : parseEventImage(input.image);
    if (input.image !== null && !next) throw new AmendmentSettingsError("活動圖片資料無效，請重新上傳。");
    if (!sameEventImage(next, baseline.event.image)) image = next;
  }
  const settings: OrganizerAmendmentSettings = {
    ...(name !== undefined ? { name } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
    ...(days !== undefined ? { days } : {}),
    ...(image !== undefined ? { image } : {}),
  };
  if (Object.keys(settings).length === 0) return null;
  // The same checks a first publication passes, so a corrected date or alias
  // is held to the rules the organizer met when creating the event, including
  // the size a draft save accepts.
  const applied = applyAmendmentSettings(baseline, settings);
  if (!serializeOrganizerEventDraft(applied)) throw new AmendmentSettingsError("更正後的活動資料超過 1 MB，請縮短活動名稱或別稱。", 413);
  const problems = validateOrganizerEventDraft(applied)
    .filter((issue) => issue.severity === "error" && issue.step === "event");
  if (problems.length > 0) throw new AmendmentSettingsError(problems.map((issue) => issue.message).join(""));
  return settings;
}

export function amendmentSettingsImpact(baseline: OrganizerEventDraft, settings: OrganizerAmendmentSettings | null): OrganizerAmendmentSettingsImpact[] {
  if (!settings) return [];
  const impact: OrganizerAmendmentSettingsImpact[] = [];
  if (settings.name !== undefined) impact.push({ field: "name", before: baseline.event.name, after: settings.name });
  if (settings.aliases !== undefined) impact.push({ field: "aliases", before: baseline.event.aliases ?? [], after: settings.aliases });
  for (const day of settings.days ?? []) {
    const before = baseline.event.days.find((item) => item.id === day.id)!;
    impact.push({ field: "day", dayId: day.id, label: before.label, before: before.date, after: day.date });
  }
  if (settings.image !== undefined) impact.push({ field: "image", before: baseline.event.image ?? null, after: settings.image });
  return impact;
}

/** The event draft an approved snapshot publishes, for callers that only hold the snapshot. */
export function approvedEventDraft(snapshot: { draft?: unknown; amendment?: { settings?: OrganizerAmendmentSettings | null } }) {
  const draft = parseOrganizerEventDraft(snapshot.draft);
  return draft ? applyAmendmentSettings(draft, snapshot.amendment?.settings ?? null) : null;
}
