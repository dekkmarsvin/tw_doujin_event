import { getCircleCatalog, isKnownCircleId } from "./circle-records";
import {
  EMPTY_PLANNING_DOCUMENT,
  PLANNING_SCHEMA_VERSION,
  parsePlanningDocument,
  type FavoriteGroup,
  type PlanningDocument,
  type VisitPlanEntry,
} from "./planning-store";

export const CSV_SCHEMA_VERSION = "circle-plan-csv/1";
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export type ImportPreview = {
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
    .map((item) => item.circleId)
    .filter((circleId) => !isKnownCircleId(circleId)))];
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
  const errors: string[] = [];
  try {
    const value = JSON.parse(text) as { kind?: unknown; planning?: unknown };
    if (value.kind !== "circle-plan-json/1") errors.push("不支援的 JSON schema version。");
    const planning = value.planning as { schemaVersion?: unknown } | null;
    if (value.kind === "circle-plan-json/1" && planning?.schemaVersion !== PLANNING_SCHEMA_VERSION) errors.push("不支援的內層規劃資料版本；未匯入任何資料。");
    const document = value.kind === "circle-plan-json/1" && planning?.schemaVersion === PLANNING_SCHEMA_VERSION ? parsePlanningDocument(planning) : EMPTY_PLANNING_DOCUMENT;
    return preview(document, "json", errors, current);
  } catch {
    return preview(EMPTY_PLANNING_DOCUMENT, "json", ["JSON 格式無法解析。"], current);
  }
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
    const catalog = getCircleCatalog();
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
    if (!visitStatus) favorites.push({ eventId: eventId || "ff47", circleId, groupId, memo: memoRaw, createdAt: updatedAt, updatedAt });
    else if (visitStatus === "planned" || visitStatus === "next" || visitStatus === "visited") {
      const routeOrder = Number(routeOrderRaw);
      if (!Number.isInteger(routeOrder) || routeOrder < 1) { errors.push(`第 ${line} 列：route_order 必須是正整數。`); return; }
      const budget = budgetRaw.trim() ? Number(budgetRaw) : null;
      if (budget !== null && (!Number.isInteger(budget) || budget < 0)) { errors.push(`第 ${line} 列：budget 必須是零或正整數。`); return; }
      visitPlans.push({ eventId: eventId || "ff47", day: resolvedDay, circleId, status: visitStatus, routeOrder: routeOrder - 1, purchaseMemo: purchaseMemoRaw, budget, updatedAt });
    } else errors.push(`第 ${line} 列：visit_status 無效。`);
  });
  const document = parsePlanningDocument({ schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups: [...groupByLabel.values()], favorites, visitPlans });
  return preview(document, "csv", errors, current);
}

export function parsePlanningFile(name: string, text: string, current?: PlanningDocument): ImportPreview {
  return name.toLocaleLowerCase().endsWith(".csv") ? parsePlanningCsv(text, current) : parsePlanningJson(text, current);
}

export function mergePlanningImport(current: PlanningDocument, incoming: PlanningDocument, conflict: "keep" | "incoming" | "replace") {
  const validFavorites = incoming.favorites.filter((item) => isKnownCircleId(item.circleId));
  const validPlans = incoming.visitPlans.filter((item) => isKnownCircleId(item.circleId));
  if (conflict === "replace") return parsePlanningDocument({ ...incoming, favorites: validFavorites, visitPlans: validPlans });
  const favoriteMap = new Map(current.favorites.map((item) => [`${item.eventId}\u0000${item.circleId}`, item]));
  validFavorites.forEach((item) => { const key = `${item.eventId}\u0000${item.circleId}`; if (conflict === "incoming" || !favoriteMap.has(key)) favoriteMap.set(key, item); });
  const planMap = new Map(current.visitPlans.map((item) => [`${item.eventId}\u0000${item.day}\u0000${item.circleId}`, item]));
  validPlans.forEach((item) => { const key = `${item.eventId}\u0000${item.day}\u0000${item.circleId}`; if (conflict === "incoming" || !planMap.has(key)) planMap.set(key, item); });
  const groupMap = new Map(current.favoriteGroups.map((item) => [item.id, item]));
  incoming.favoriteGroups.forEach((item) => { if (!groupMap.has(item.id)) groupMap.set(item.id, item); });
  return parsePlanningDocument({ schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups: [...groupMap.values()], favorites: [...favoriteMap.values()], visitPlans: [...planMap.values()] });
}
