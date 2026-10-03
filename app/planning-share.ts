import { getCircleCatalogState, type CircleViewRecord } from "./circle-records";
import type { EventDayKey, PlanningDocument } from "./planning-store";

/** Single-event public whitelist; array order is the shared order, null day denotes a favorite. */
export type SharedList = {
  version: 1;
  eventId: string;
  items: { circleId: string; day: EventDayKey | null }[];
};

/** Parsing never writes planning data; failures contain a displayable Chinese error. */
export type SharedListReadResult = { ok: true; list: SharedList } | { ok: false; error: string };

/** Current identity and display records; days lists active destinations, records retain retired evidence if none remain. */
export type ResolvedSharedItem = SharedList["items"][number] & {
  state: "available" | "moved" | "withdrawn" | "unknown";
  circle: CircleViewRecord["circle"] | null;
  records: CircleViewRecord[];
  days: EventDayKey[];
};

/** Maximum UTF-8 bytes of the entire generated URL; oversized lists must use the share file. */
export const SHARE_URL_MAX_BYTES = 8192;

const MAX_FILE_BYTES = 256 * 1024;
/** A share link or file never carries more items; the picker stops at the same number. */
export const SHARE_MAX_ITEMS = 500;
const itemKey = (circleId: string, day: EventDayKey | null) => JSON.stringify([circleId, day === null ? null : String(day)]);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const isDay = (value: unknown): value is EventDayKey | null => value === null
  || (typeof value === "string" && !!value.trim() && !value.includes("\u0000"))
  || (typeof value === "number" && Number.isFinite(value));
const failure = (error: string): SharedListReadResult => ({ ok: false, error });

/** Reads only event/circle IDs and days; null selections require a favorite, dated selections a matching plan. */
export function projectSharedList(document: PlanningDocument, eventId: string, selection: SharedList["items"]): SharedList {
  const eligible = new Set<string>();
  for (const favorite of document.favorites) {
    if (favorite.eventId === eventId) eligible.add(itemKey(favorite.circleId, null));
  }
  for (const entry of document.visitPlans) {
    if (entry.eventId === eventId) eligible.add(itemKey(entry.circleId, entry.day));
  }
  const seen = new Set<string>();
  const items = selection.flatMap(({ circleId, day }) => {
    const key = itemKey(circleId, day);
    if (!eligible.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ circleId, day }];
  });
  return { version: 1, eventId, items };
}

function encodePayload(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Encodes only whitelisted fields into the fragment; fits measures the complete URL without truncation. */
export function sharedListUrl(origin: string, list: SharedList): { url: string; fits: boolean } {
  const payload = encodePayload(JSON.stringify({ v: list.version, e: list.eventId, c: list.items.map(({ circleId, day }) => day === null ? [circleId] : [circleId, day]) }));
  const url = `${origin}/?event=${encodeURIComponent(list.eventId)}#share=${payload}`;
  return { url, fits: new TextEncoder().encode(url).byteLength <= SHARE_URL_MAX_BYTES };
}

function validateList(value: unknown, file = false): SharedListReadResult {
  if (!isObject(value) || !onlyKeys(value, file ? ["kind", "version", "eventId", "items"] : ["version", "eventId", "items"])) return failure("分享清單格式不正確。");
  if (file && value.kind !== "circle-share/1") return failure("不支援的分享檔格式。");
  if (value.version !== 1) return failure("不支援的分享清單版本。");
  if (typeof value.eventId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.eventId)) return failure("分享清單的活動代碼不正確。");
  if (!Array.isArray(value.items) || value.items.length > SHARE_MAX_ITEMS) return failure("分享清單最多可包含 500 個項目。");
  const items: SharedList["items"] = [];
  for (const item of value.items) {
    if (!isObject(item) || !onlyKeys(item, ["circleId", "day"])
      || typeof item.circleId !== "string" || !/^c-\d+$/.test(item.circleId) || !isDay(item.day)) return failure("分享清單的社團代碼或活動日不正確。");
    items.push({ circleId: item.circleId, day: item.day });
  }
  return { ok: true, list: { version: 1, eventId: value.eventId, items } };
}

/** Returns null without share=; rejects oversized/noncanonical encoding and non-whitelisted data, never throws. */
export function readSharedListFromHash(hash: string): SharedListReadResult | null {
  try {
    const params = hash.replace(/^#/, "").split("&");
    const shares = params.filter((param) => param.startsWith("share="));
    if (!shares.length) return null;
    if (hash.length > SHARE_URL_MAX_BYTES || new TextEncoder().encode(hash).byteLength > SHARE_URL_MAX_BYTES) return failure("分享連結過長，請改用分享檔。");
    if (shares.length !== 1) return failure("分享連結格式不正確。");
    const payload = shares[0].slice(6);
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) return failure("分享連結格式不正確。");
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    if (encodePayload(text) !== payload) return failure("分享連結格式不正確。");
    const value: unknown = JSON.parse(text);
    if (!isObject(value) || !onlyKeys(value, ["v", "e", "c"]) || !Array.isArray(value.c)) return failure("分享清單格式不正確。");
    if (value.c.length > SHARE_MAX_ITEMS) return failure("分享清單最多可包含 500 個項目。");
    const items = [];
    for (const tuple of value.c) {
      if (!Array.isArray(tuple) || tuple.length < 1 || tuple.length > 2) return failure("分享清單格式不正確。");
      items.push({ circleId: tuple[0], day: tuple.length === 1 ? null : tuple[1] });
    }
    return validateList({ version: value.v, eventId: value.e, items });
  } catch {
    return failure("分享連結無法讀取，請確認連結是否完整。");
  }
}

/** Flat circle-share/1 JSON envelope containing only the public whitelist, including every item. */
export function sharedListFile(list: SharedList): string {
  return JSON.stringify({ kind: "circle-share/1", version: list.version, eventId: list.eventId, items: list.items.map(({ circleId, day }) => ({ circleId, day })) });
}

/** Validates the share file before use (256 KiB / 500 items); rejects extra fields and never throws. */
export function readSharedListFile(text: string): SharedListReadResult {
  try {
    if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) return failure("分享檔超過 256 KiB 上限。");
    return validateList(JSON.parse(text), true);
  } catch {
    return failure("分享檔無法讀取，請確認檔案是否完整。");
  }
}

/** Resolves canonical IDs only; active same-day booths win, then moved destinations, then cancelled/moved evidence. */
export function resolveSharedList(list: SharedList): { status: "ready" | "loading" | "error"; items: ResolvedSharedItem[] } {
  const { status, catalog } = getCircleCatalogState(list.eventId);
  if (status !== "ready") return { status, items: [] };
  const items = list.items.map(({ circleId, day }): ResolvedSharedItem => {
    const circle = catalog.circlesById.get(circleId) ?? null;
    const allRecords = catalog.recordsByCircleId.get(circleId) ?? [];
    const active = allRecords.filter((record) => record.placement.status === "active");
    const matching = day === null ? active : active.filter((record) => String(record.day) === String(day));
    const days = [...new Map(active.map((record) => [String(record.day), record.day])).values()];
    const state = !circle ? "unknown" : matching.length ? "available" : active.length ? "moved"
      : allRecords.some((record) => record.placement.status === "cancelled") ? "withdrawn"
      : allRecords.some((record) => record.placement.status === "moved") || day !== null ? "moved" : "available";
    return { circleId, day, state, circle, records: matching.length ? matching : active.length ? active : allRecords, days };
  });
  return { status, items };
}

/** Pure append of missing favorites in input order; preserves existing entries and returns the actual added count. */
export function addSharedFavorites(document: PlanningDocument, eventId: string, circleIds: string[]): { document: PlanningDocument; added: number } {
  const existing = new Set(document.favorites.filter((item) => item.eventId === eventId).map((item) => item.circleId));
  const updatedAt = new Date().toISOString();
  const additions = circleIds.flatMap((circleId) => {
    if (existing.has(circleId)) return [];
    existing.add(circleId);
    return [{ eventId, circleId, groupId: null, memo: "", createdAt: updatedAt, updatedAt }];
  });
  return { document: additions.length ? { ...document, favorites: [...document.favorites, ...additions] } : document, added: additions.length };
}

/** Pure append of missing planned entries after existing route orders; numeric/string equivalent days share a scope. */
export function addSharedToPlan(document: PlanningDocument, eventId: string, day: EventDayKey, circleIds: string[]): { document: PlanningDocument; added: number } {
  const scoped = document.visitPlans.filter((item) => item.eventId === eventId && String(item.day) === String(day));
  const existing = new Set(scoped.map((item) => item.circleId));
  let routeOrder = scoped.reduce((maximum, item) => Math.max(maximum, item.routeOrder), -1) + 1;
  const updatedAt = new Date().toISOString();
  const additions = circleIds.flatMap((circleId) => {
    if (existing.has(circleId)) return [];
    existing.add(circleId);
    return [{ eventId, day, circleId, status: "planned" as const, routeOrder: routeOrder++, purchaseMemo: "", budget: null, updatedAt }];
  });
  return { document: additions.length ? { ...document, visitPlans: [...document.visitPlans, ...additions] } : document, added: additions.length };
}
