import { getCircleCatalog, getCircleCatalogState, isKnownCircleId } from "./circle-records";
import { ACTIVE_EVENT_ID } from "./event-catalog";
import type { Locale } from "./i18n/locale";
import { defineMessages, translate } from "./i18n/messages";
import {
  EMPTY_PLANNING_DOCUMENT,
  PLANNING_SCHEMA_VERSION,
  parsePlanningDocument,
  type FavoriteGroup,
  type FavoriteRecord,
  type PlanningDocument,
  type VisitPlanEntry,
} from "./planning-store";

const CSV_SCHEMA_VERSION = "circle-plan-csv/1";
const MAX_IMPORT_ROWS = 20_000;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/** Incoming record counts; identical compares editable values, ignoring timestamps and local order. */
export type BackupCounts = { total: number; new: number; identical: number; conflicting: number };

/** Unresolved records, retained in document; arrays also provide their displayable IDs and original days. */
export type BackupItems = { total: number; favorites: FavoriteRecord[]; visitPlans: VisitPlanEntry[] };

/** One incoming event: differences, original day keys (String(day)), and three distinct unresolved causes. */
export type BackupEventPreview = {
  eventId: string;
  catalogStatus: "ready" | "loading" | "error";
  favorites: BackupCounts;
  visitPlans: BackupCounts & { perDay: Record<string, number> };
  unresolved: { notLoaded: BackupItems; failed: BackupItems; unmatched: BackupItems };
};

/** Global groups identified only by ID; clashes include both definitions and the deterministic target ID. */
export type BackupGroupPreview = {
  new: FavoriteGroup[];
  identical: FavoriteGroup[];
  clashes: { incoming: FavoriteGroup; local: FavoriteGroup; mappedId: string }[];
  idMap: Record<string, string>;
};

type ItemCollection = "group" | "favorite" | "plan";
type ItemReason = "groupIncomplete" | "groupId" | "groupName" | "groupColor" | "groupOrder" | "groupDuplicate"
  | "itemIncomplete" | "eventId" | "circleId" | "updatedAt" | "memo" | "createdAt" | "groupRef" | "favoriteDuplicate"
  | "day" | "status" | "routeOrder" | "purchaseMemo" | "budget" | "planDuplicate";
/** One rejection reason, translated where it is shown so a language switch does not need the file again. */
export type BackupIssue =
  | { key: "tooLarge" | "unparseable" | "notObject" | "unknownKind" | "noPlanning" | "unknownVersion" | "missingLists" | "tooManyRows" }
  | { key: "item"; collection: ItemCollection; index: number; reason: ItemReason };

const BACKUP_MESSAGES = defineMessages({
  "zh-Hant": {
    tooLarge: "備份檔超過 10 MiB 上限。", unparseable: "JSON 格式無法解析。", notObject: "備份檔結構不完整。", unknownKind: "不支援的 JSON 備份格式。",
    noPlanning: "規劃資料結構不完整。", unknownVersion: "不支援的內層規劃資料版本；未匯入任何資料。", missingLists: "備份檔須包含收藏、行程與群組清單。", tooManyRows: "備份檔超過 20,000 筆資料上限。",
    item: "{collection}第 {position} 筆：{reason}。", group: "群組", favorite: "收藏", plan: "行程",
    groupIncomplete: "須為完整的群組資料", groupId: "缺少有效的群組代碼", groupName: "名稱須為非空文字", groupColor: "顏色須為文字", groupOrder: "排序須為零或正整數", groupDuplicate: "群組代碼重複",
    itemIncomplete: "須為完整的項目資料", eventId: "缺少有效的活動代碼", circleId: "缺少有效的社團代碼", updatedAt: "更新時間須為文字且收藏不可留空",
    memo: "備註須為文字", createdAt: "建立時間須為非空文字", groupRef: "群組代碼無效或不存在於備份檔", favoriteDuplicate: "活動與社團重複",
    day: "活動日須為非空文字或有限數值", status: "行程狀態無效", routeOrder: "行程排序須為零或正整數", purchaseMemo: "購買備註須為文字", budget: "預算須為零或正整數，或留空", planDuplicate: "同活動日的社團重複",
  },
  en: {
    tooLarge: "The backup file is larger than 10 MiB.", unparseable: "The JSON could not be read.", notObject: "The backup file is incomplete.", unknownKind: "This JSON backup format is not supported.",
    noPlanning: "The planning data in the file is incomplete.", unknownVersion: "This planning data version is not supported. Nothing was imported.", missingLists: "The backup file must contain favorite, plan and group lists.", tooManyRows: "The backup file has more than 20,000 records.",
    item: "{collection} {position}: {reason}.", group: "Group", favorite: "Favorite", plan: "Plan item",
    groupIncomplete: "group data is incomplete", groupId: "group ID is missing or invalid", groupName: "name must be non-empty text", groupColor: "color must be text", groupOrder: "order must be zero or a positive integer", groupDuplicate: "group ID is duplicated",
    itemIncomplete: "item data is incomplete", eventId: "event ID is missing or invalid", circleId: "circle ID is missing or invalid", updatedAt: "update time must be text and cannot be empty for favorites",
    memo: "note must be text", createdAt: "creation time must be non-empty text", groupRef: "group ID is invalid or not in the backup file", favoriteDuplicate: "event and circle are duplicated",
    day: "event day must be non-empty text or a number", status: "plan status is invalid", routeOrder: "plan order must be zero or a positive integer", purchaseMemo: "items to buy must be text", budget: "budget must be zero, a positive integer or empty", planDuplicate: "circle is duplicated on the same event day",
  },
  ja: {
    tooLarge: "バックアップファイルが上限の 10 MiB を超えています。", unparseable: "JSON を読み取れません。", notObject: "バックアップファイルの構造が不完全です。", unknownKind: "対応していない JSON バックアップ形式です。",
    noPlanning: "保存データの構造が不完全です。", unknownVersion: "対応していない保存データのバージョンです。何も取り込んでいません。", missingLists: "バックアップファイルにはお気に入り、巡回プラン、グループの一覧が必要です。", tooManyRows: "バックアップファイルが上限の 20,000 件を超えています。",
    item: "{collection}の {position} 件目：{reason}。", group: "グループ", favorite: "お気に入り", plan: "巡回プラン",
    groupIncomplete: "グループのデータが不完全です", groupId: "有効なグループ ID がありません", groupName: "名前は空でないテキストにしてください", groupColor: "色はテキストにしてください", groupOrder: "並び順は 0 以上の整数にしてください", groupDuplicate: "グループ ID が重複しています",
    itemIncomplete: "項目のデータが不完全です", eventId: "有効なイベント ID がありません", circleId: "有効なサークル ID がありません", updatedAt: "更新日時はテキストにし、お気に入りでは空にできません",
    memo: "メモはテキストにしてください", createdAt: "作成日時は空でないテキストにしてください", groupRef: "グループ ID が無効か、バックアップファイルにありません", favoriteDuplicate: "イベントとサークルが重複しています",
    day: "開催日は空でないテキストか数値にしてください", status: "巡回プランの状態が無効です", routeOrder: "巡回順は 0 以上の整数にしてください", purchaseMemo: "購入メモはテキストにしてください", budget: "予算は 0 以上の整数にするか、空にしてください", planDuplicate: "同じ開催日にサークルが重複しています",
  },
});

export function backupIssueMessage(issue: BackupIssue, locale: Locale = "zh-Hant"): string {
  if (issue.key !== "item") return translate(BACKUP_MESSAGES, locale, issue.key);
  return translate(BACKUP_MESSAGES, locale, "item", { collection: translate(BACKUP_MESSAGES, locale, issue.collection), position: issue.index + 1, reason: translate(BACKUP_MESSAGES, locale, issue.reason) });
}

/** ok narrows the result: rejection has no writable document and at most five reasons; success is unfiltered.
 * `errors` is the Traditional Chinese text of `issues`. */
export type BackupPreview = { baseFingerprint: string } & (
  | { ok: false; document: null; errors: string[]; issues: BackupIssue[] }
  | { ok: true; document: PlanningDocument; errors: []; events: BackupEventPreview[]; groups: BackupGroupPreview }
);

/** Full-replace impact on local records: absent incoming keys are removed, present keys are replaced (even identical). */
export type ReplaceCounts = { total: number; removed: number; replaced: number };

/** Whole-browser impact; shared groups count in each referring event, unused groups only in global totals. */
export type PlanningReplaceSummary = {
  events: { eventId: string; favorites: ReplaceCounts; visitPlans: ReplaceCounts; groups: ReplaceCounts }[];
  totals: { favorites: ReplaceCounts; visitPlans: ReplaceCounts; groups: ReplaceCounts };
};

const favoriteKey = (item: FavoriteRecord) => JSON.stringify([item.eventId, item.circleId]);
// Store normalization scopes numeric and string days with the same text together.
const planKey = (item: VisitPlanEntry) => JSON.stringify([item.eventId, String(item.day), item.circleId]);
const scopeKey = (item: VisitPlanEntry) => JSON.stringify([item.eventId, String(item.day)]);
const sameGroup = (a: FavoriteGroup, b: FavoriteGroup) => a.name === b.name && a.color === b.color;
const sameFavorite = (a: FavoriteRecord, b: FavoriteRecord) => a.memo === b.memo && a.groupId === b.groupId;
const samePlan = (a: VisitPlanEntry, b: VisitPlanEntry) => a.status === b.status && a.purchaseMemo === b.purchaseMemo && a.budget === b.budget;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && !value.includes("\u0000");
const isOrder = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Stable, lossless comparison string for every field and array order; compare again immediately before committing. */
export function planningFingerprint(document: PlanningDocument): string {
  return JSON.stringify({
    schemaVersion: document.schemaVersion,
    favoriteGroups: document.favoriteGroups.map(({ id, name, color, sortOrder }) => [id, name, color, sortOrder]),
    favorites: document.favorites.map(({ eventId, circleId, groupId, memo, createdAt, updatedAt }) => [eventId, circleId, groupId, memo, createdAt, updatedAt]),
    visitPlans: document.visitPlans.map(({ eventId, day, circleId, status, routeOrder, purchaseMemo, budget, updatedAt }) => [eventId, day, circleId, status, routeOrder, purchaseMemo, budget, updatedAt]),
  });
}

function readBackup(text: string): { document: PlanningDocument | null; issues: BackupIssue[] } {
  const reject = (key: Exclude<BackupIssue["key"], "item">) => ({ document: null, issues: [{ key }] });
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) return reject("tooLarge");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return reject("unparseable"); }
  if (!isObject(value)) return reject("notObject");
  if (value.kind !== "circle-plan-json/1") return reject("unknownKind");
  const raw = value.planning;
  if (!isObject(raw)) return reject("noPlanning");
  if (raw.schemaVersion !== PLANNING_SCHEMA_VERSION) return reject("unknownVersion");
  if (!Array.isArray(raw.favoriteGroups) || !Array.isArray(raw.favorites) || !Array.isArray(raw.visitPlans)) return reject("missingLists");
  if (raw.favoriteGroups.length + raw.favorites.length + raw.visitPlans.length > MAX_IMPORT_ROWS) return reject("tooManyRows");
  const issues: BackupIssue[] = [];
  const invalid = (collection: ItemCollection, index: number, reason: ItemReason) => {
    if (issues.length < 5) issues.push({ key: "item", collection, index, reason });
  };
  const groupIds = new Set<string>();
  raw.favoriteGroups.forEach((item: unknown, index: number) => {
    if (!isObject(item)) { invalid("group", index, "groupIncomplete"); return; }
    if (!isId(item.id)) invalid("group", index, "groupId");
    if (typeof item.name !== "string" || !item.name.trim()) invalid("group", index, "groupName");
    if (typeof item.color !== "string") invalid("group", index, "groupColor");
    if (!isOrder(item.sortOrder)) invalid("group", index, "groupOrder");
    if (isId(item.id)) {
      if (groupIds.has(item.id)) invalid("group", index, "groupDuplicate");
      groupIds.add(item.id);
    }
  });
  const favoriteIds = new Set<string>();
  const planIds = new Set<string>();
  for (const [collection, items] of [["favorite", raw.favorites], ["plan", raw.visitPlans]] as const) {
    items.forEach((item: unknown, index: number) => {
      if (!isObject(item)) { invalid(collection, index, "itemIncomplete"); return; }
      if (!isId(item.eventId)) invalid(collection, index, "eventId");
      if (!isId(item.circleId)) invalid(collection, index, "circleId");
      if (typeof item.updatedAt !== "string" || (collection === "favorite" && !item.updatedAt)) invalid(collection, index, "updatedAt");
      if (collection === "favorite") {
        if (typeof item.memo !== "string") invalid(collection, index, "memo");
        if (typeof item.createdAt !== "string" || !item.createdAt) invalid(collection, index, "createdAt");
        if (item.groupId !== null && (!isId(item.groupId) || !groupIds.has(item.groupId))) invalid(collection, index, "groupRef");
        const key = JSON.stringify([item.eventId, item.circleId]);
        if (favoriteIds.has(key)) invalid(collection, index, "favoriteDuplicate");
        favoriteIds.add(key);
      } else {
        if (!((typeof item.day === "string" && !!item.day.trim() && !item.day.includes("\u0000")) || (typeof item.day === "number" && Number.isFinite(item.day)))) invalid(collection, index, "day");
        if (item.status !== "planned" && item.status !== "next" && item.status !== "visited") invalid(collection, index, "status");
        if (!isOrder(item.routeOrder)) invalid(collection, index, "routeOrder");
        if (typeof item.purchaseMemo !== "string") invalid(collection, index, "purchaseMemo");
        if (item.budget !== null && !isOrder(item.budget)) invalid(collection, index, "budget");
        const key = JSON.stringify([item.eventId, String(item.day), item.circleId]);
        if (planIds.has(key)) invalid(collection, index, "planDuplicate");
        planIds.add(key);
      }
    });
  }
  return issues.length ? { document: null, issues } : { document: parsePlanningDocument(raw), issues: [] };
}

function remappedGroupId(group: FavoriteGroup) {
  let hash = 2166136261;
  for (const character of JSON.stringify([group.name, group.color])) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `backup-${group.id}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function mapBackupGroups(current: PlanningDocument, incoming: PlanningDocument) {
  const groups = new Map(current.favoriteGroups.map((group) => [group.id, group]));
  const idMap = new Map<string, string>();
  const result: BackupGroupPreview = { new: [], identical: [], clashes: [], idMap: {} };
  // Reserve all original new IDs before generating clash IDs.
  incoming.favoriteGroups.forEach((group) => {
    if (!groups.has(group.id)) groups.set(group.id, { ...group, sortOrder: groups.size });
  });
  const locals = new Map(current.favoriteGroups.map((group) => [group.id, group]));
  const incomingIds = new Set(incoming.favoriteGroups.map((group) => group.id));
  incoming.favoriteGroups.forEach((group) => {
    const local = locals.get(group.id);
    let mappedId = group.id;
    if (!local) result.new.push(group);
    else if (sameGroup(local, group)) result.identical.push(group);
    else {
      const base = remappedGroupId(group);
      mappedId = base;
      let suffix = 1;
      while (incomingIds.has(mappedId) || (groups.has(mappedId) && !sameGroup(groups.get(mappedId)!, group))) mappedId = `${base}-${suffix++}`;
      if (!groups.has(mappedId)) groups.set(mappedId, { ...group, id: mappedId, sortOrder: groups.size });
      result.clashes.push({ incoming: group, local, mappedId });
    }
    idMap.set(group.id, mappedId);
  });
  result.idMap = Object.fromEntries(idMap);
  return { groups: [...groups.values()], idMap, preview: result };
}

/** Validates all required schema fields (including timestamps), unique keys and group references before normalization.
 * Rejects >10 MiB UTF-8 / >20,000 combined records; success supplies UI differences and retains unresolved records.
 * Days accept the store's nonempty string / finite number keys; errors identify one-based collection positions.
 */
export function previewPlanningBackup(text: string, current: PlanningDocument, catalogStatus: (eventId: string) => "ready" | "loading" | "error"): BackupPreview {
  const baseFingerprint = planningFingerprint(current);
  const parsed = readBackup(text);
  if (!parsed.document) return { ok: false, document: null, errors: parsed.issues.map((issue) => backupIssueMessage(issue)), issues: parsed.issues, baseFingerprint };
  const document = parsed.document;
  const groupMapping = mapBackupGroups(current, document);
  const localFavorites = new Map(current.favorites.map((item) => [favoriteKey(item), item]));
  const localPlans = new Map(current.visitPlans.map((item) => [planKey(item), item]));
  const emptyCounts = (): BackupCounts => ({ total: 0, new: 0, identical: 0, conflicting: 0 });
  const emptyItems = (): BackupItems => ({ total: 0, favorites: [], visitPlans: [] });
  const events = new Map<string, BackupEventPreview>();
  const classify = (counts: BackupCounts, local: unknown, identical: boolean) => {
    counts.total += 1;
    counts[!local ? "new" : identical ? "identical" : "conflicting"] += 1;
  };
  for (const item of [...document.favorites, ...document.visitPlans]) {
    let event = events.get(item.eventId);
    if (!event) {
      event = { eventId: item.eventId, catalogStatus: catalogStatus(item.eventId), favorites: emptyCounts(), visitPlans: { ...emptyCounts(), perDay: {} }, unresolved: { notLoaded: emptyItems(), failed: emptyItems(), unmatched: emptyItems() } };
      events.set(item.eventId, event);
    }
    if ("day" in item) {
      const local = localPlans.get(planKey(item));
      classify(event.visitPlans, local, !!local && samePlan(local, item));
      const day = String(item.day);
      Object.defineProperty(event.visitPlans.perDay, day, { value: (Object.hasOwn(event.visitPlans.perDay, day) ? event.visitPlans.perDay[day] : 0) + 1, enumerable: true, configurable: true });
    } else {
      const local = localFavorites.get(favoriteKey(item));
      classify(event.favorites, local, !!local && sameFavorite(local, { ...item, groupId: item.groupId === null ? null : groupMapping.idMap.get(item.groupId)! }));
    }
    const bucket = event.catalogStatus === "loading" ? event.unresolved.notLoaded : event.catalogStatus === "error" ? event.unresolved.failed : !isKnownCircleId(item.circleId, item.eventId) ? event.unresolved.unmatched : null;
    if (bucket) {
      bucket.total += 1;
      if ("day" in item) bucket.visitPlans.push(item); else bucket.favorites.push(item);
    }
  }
  return { ok: true, document, errors: [], baseFingerprint, events: [...events.values()], groups: groupMapping.preview };
}

/** Merges every record; incoming overwrites editable values/timestamps but keeps existing route positions; new plans append. */
export function mergePlanningBackup(current: PlanningDocument, incoming: PlanningDocument, mode: "keep" | "incoming"): PlanningDocument {
  const groupMapping = mapBackupGroups(current, incoming);
  const favorites = new Map(current.favorites.map((item) => [favoriteKey(item), item]));
  incoming.favorites.forEach((item) => {
    const key = favoriteKey(item);
    if (mode === "incoming" || !favorites.has(key)) favorites.set(key, { ...item, groupId: item.groupId === null ? null : groupMapping.idMap.get(item.groupId)! });
  });
  const plans = new Map(current.visitPlans.map((item) => [planKey(item), item]));
  const nextOrders = new Map<string, number>();
  current.visitPlans.forEach((item) => nextOrders.set(scopeKey(item), Math.max(nextOrders.get(scopeKey(item)) ?? 0, item.routeOrder + 1)));
  incoming.visitPlans.forEach((item) => {
    const key = planKey(item);
    const local = plans.get(key);
    if (local) {
      if (mode === "incoming") plans.set(key, { ...item, routeOrder: local.routeOrder });
    } else {
      const scope = scopeKey(item);
      const routeOrder = nextOrders.get(scope) ?? 0;
      plans.set(key, { ...item, routeOrder });
      nextOrders.set(scope, routeOrder + 1);
    }
  });
  return parsePlanningDocument({ schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups: groupMapping.groups, favorites: [...favorites.values()], visitPlans: [...plans.values()] });
}

/** Counts all local data affected by writing incoming, including events absent from the backup and unused global groups. */
export function planningReplaceSummary(current: PlanningDocument, incoming: PlanningDocument): PlanningReplaceSummary {
  const favorites = new Set(incoming.favorites.map(favoriteKey));
  const plans = new Set(incoming.visitPlans.map(planKey));
  const groups = new Set(incoming.favoriteGroups.map((group) => group.id));
  const counts = <T,>(items: T[], key: (item: T) => string, incomingKeys: Set<string>): ReplaceCounts => {
    const replaced = items.filter((item) => incomingKeys.has(key(item))).length;
    return { total: items.length, removed: items.length - replaced, replaced };
  };
  const localEvents = new Map<string, { favorites: FavoriteRecord[]; visitPlans: VisitPlanEntry[]; groupIds: Set<string> }>();
  for (const item of [...current.favorites, ...current.visitPlans]) {
    let event = localEvents.get(item.eventId);
    if (!event) {
      event = { favorites: [], visitPlans: [], groupIds: new Set() };
      localEvents.set(item.eventId, event);
    }
    if ("day" in item) event.visitPlans.push(item);
    else {
      event.favorites.push(item);
      if (item.groupId !== null) event.groupIds.add(item.groupId);
    }
  }
  const localGroups = new Map(current.favoriteGroups.map((group) => [group.id, group]));
  return {
    events: [...localEvents].map(([eventId, event]) => {
      const eventGroups = [...event.groupIds].map((id) => localGroups.get(id)!);
      return { eventId, favorites: counts(event.favorites, favoriteKey, favorites), visitPlans: counts(event.visitPlans, planKey, plans), groups: counts(eventGroups, (group) => group.id, groups) };
    }),
    totals: { favorites: counts(current.favorites, favoriteKey, favorites), visitPlans: counts(current.visitPlans, planKey, plans), groups: counts(current.favoriteGroups, (group) => group.id, groups) },
  };
}

type ImportPreview = {
  document: PlanningDocument;
  errors: string[];
  unmatchedCircleIds: string[];
  counts: { groups: number; favorites: number; visitPlans: number; additions: number; conflicts: number; skipped: number; invalid: number };
  format: "json" | "csv";
};

const legacyCsvHeaders = ["schema_version", "event_id", "circle_id", "group_label", "memo", "visit_status", "route_order", "source_provider", "source_url"] as const;
const csvHeaders = [...legacyCsvHeaders, "purchase_memo", "budget"] as const;

function protectSpreadsheetValue(value: string) {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function unprotectSpreadsheetValue(value: string) {
  return value.startsWith("'") && /^[\s]*[=+\-@]/.test(value.slice(1)) ? value.slice(1) : value;
}

function csvCell(value: string | number | null | undefined) {
  const text = protectSpreadsheetValue(String(value ?? ""));
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportPlanningJson(document: PlanningDocument) {
  return JSON.stringify({ kind: "circle-plan-json/1", exportedAt: new Date().toISOString(), planning: parsePlanningDocument(document) }, null, 2);
}

export function exportPlanningCsv(document: PlanningDocument) {
  const groups = new Map(document.favoriteGroups.map((group) => [group.id, group.name]));
  const rows: string[][] = [];
  document.favorites.forEach((favorite) => rows.push([
    CSV_SCHEMA_VERSION,
    favorite.eventId,
    favorite.circleId,
    favorite.groupId ? groups.get(favorite.groupId) ?? "" : "",
    favorite.memo,
    "",
    "",
    "",
    "",
    "",
    "",
  ]));
  document.visitPlans.forEach((entry) => rows.push([
    CSV_SCHEMA_VERSION,
    entry.eventId,
    entry.circleId,
    "",
    "",
    entry.status,
    String(entry.routeOrder + 1),
    "",
    "",
    entry.purchaseMemo,
    entry.budget === null ? "" : String(entry.budget),
  ]));
  return [csvHeaders.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (quoted) throw new Error("CSV 引號未完整關閉。");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function preview(document: PlanningDocument, format: "json" | "csv", errors: string[], current?: PlanningDocument): ImportPreview {
  const unmatchedCircleIds = [...new Set([...document.favorites, ...document.visitPlans]
    .filter((item) => !isKnownCircleId(item.circleId, item.eventId))
    .map((item) => item.circleId))];
  const favoriteKeys = new Set(current?.favorites.map((item) => `${item.eventId}\u0000${item.circleId}`));
  const planKeys = new Set(current?.visitPlans.map((item) => `${item.eventId}\u0000${item.day}\u0000${item.circleId}`));
  const conflicts = document.favorites.filter((item) => favoriteKeys.has(`${item.eventId}\u0000${item.circleId}`)).length
    + document.visitPlans.filter((item) => planKeys.has(`${item.eventId}\u0000${item.day}\u0000${item.circleId}`)).length
    + document.favoriteGroups.filter((group) => current?.favoriteGroups.some((item) => item.name.trim().toLocaleLowerCase() === group.name.trim().toLocaleLowerCase())).length;
  const importedItems = document.favorites.length + document.visitPlans.length + document.favoriteGroups.length;
  return {
    document,
    errors,
    unmatchedCircleIds,
    counts: { groups: document.favoriteGroups.length, favorites: document.favorites.length, visitPlans: document.visitPlans.length, additions: Math.max(0, importedItems - conflicts - unmatchedCircleIds.length), conflicts, skipped: unmatchedCircleIds.length, invalid: errors.length },
    format,
  };
}

export function parsePlanningJson(text: string, current?: PlanningDocument): ImportPreview {
  const result = previewPlanningBackup(text, current ?? EMPTY_PLANNING_DOCUMENT, (eventId) => getCircleCatalogState(eventId).status);
  return preview(result.document ?? EMPTY_PLANNING_DOCUMENT, "json", result.errors, current);
}

export function parsePlanningCsv(text: string, current?: PlanningDocument): ImportPreview {
  const errors: string[] = [];
  let rows: string[][];
  try { rows = parseCsv(text); } catch (error) { return preview(EMPTY_PLANNING_DOCUMENT, "csv", [error instanceof Error ? error.message : "CSV 無法解析。"], current); }
  if (rows.length - 1 > MAX_IMPORT_ROWS) return preview(EMPTY_PLANNING_DOCUMENT, "csv", [`CSV 超過 ${MAX_IMPORT_ROWS.toLocaleString()} 筆資料列上限。`], current);
  const header = rows.shift() ?? [];
  const headerKey = header.join("\u0000");
  if (headerKey !== csvHeaders.join("\u0000") && headerKey !== legacyCsvHeaders.join("\u0000")) return preview(EMPTY_PLANNING_DOCUMENT, "csv", ["CSV 欄位不符合 circle-plan-csv/1。"], current);
  const groupByLabel = new Map<string, FavoriteGroup>();
  const favorites: PlanningDocument["favorites"] = [];
  const visitPlans: VisitPlanEntry[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const [schemaVersion, eventId, circleId, groupLabelRaw, memoRaw, visitStatus, routeOrderRaw, , sourceUrl, purchaseMemoRaw = "", budgetRaw = ""] = row.map(unprotectSpreadsheetValue);
    if (schemaVersion !== CSV_SCHEMA_VERSION) { errors.push(`第 ${line} 列：未知 schema version。`); return; }
    if (!circleId) { errors.push(`第 ${line} 列：circle_id 為必填。`); return; }
    if (row.some((value) => /^[\s]*[=+\-@]/.test(value))) { errors.push(`第 ${line} 列：包含可能的公式注入內容。`); return; }
    if (sourceUrl && (!sourceUrl.startsWith("https://") || (() => { try { new URL(sourceUrl); return false; } catch { return true; } })())) { errors.push(`第 ${line} 列：source_url 必須是有效 HTTPS URL。`); return; }
    const targetEventId = eventId || ACTIVE_EVENT_ID;
    const catalog = getCircleCatalog(targetEventId);
    const record = catalog.recordsByCircleId.get(circleId)?.[0] ?? catalog.recordsById.get(circleId);
    const resolvedDay = record?.day ?? 1;
    const updatedAt = new Date().toISOString();
    const groupLabel = groupLabelRaw.trim();
    let groupId: string | null = null;
    if (groupLabel) {
      let group = groupByLabel.get(groupLabel);
      if (!group) { group = { id: `csv-group-${groupByLabel.size + 1}`, name: groupLabel, color: "coral", sortOrder: groupByLabel.size }; groupByLabel.set(groupLabel, group); }
      groupId = group.id;
    }
    if (!visitStatus) favorites.push({ eventId: targetEventId, circleId, groupId, memo: memoRaw, createdAt: updatedAt, updatedAt });
    else if (visitStatus === "planned" || visitStatus === "next" || visitStatus === "visited") {
      const routeOrder = Number(routeOrderRaw);
      if (!Number.isInteger(routeOrder) || routeOrder < 1) { errors.push(`第 ${line} 列：route_order 必須是正整數。`); return; }
      const budget = budgetRaw.trim() ? Number(budgetRaw) : null;
      if (budget !== null && (!Number.isInteger(budget) || budget < 0)) { errors.push(`第 ${line} 列：budget 必須是零或正整數。`); return; }
      visitPlans.push({ eventId: targetEventId, day: resolvedDay, circleId, status: visitStatus, routeOrder: routeOrder - 1, purchaseMemo: purchaseMemoRaw, budget, updatedAt });
    } else errors.push(`第 ${line} 列：visit_status 無效。`);
  });
  const document = parsePlanningDocument({ schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups: [...groupByLabel.values()], favorites, visitPlans });
  return preview(document, "csv", errors, current);
}

export function mergePlanningImport(current: PlanningDocument, incoming: PlanningDocument, conflict: "keep" | "incoming" | "replace") {
  return conflict === "replace" ? parsePlanningDocument(incoming) : mergePlanningBackup(current, incoming, conflict);
}
