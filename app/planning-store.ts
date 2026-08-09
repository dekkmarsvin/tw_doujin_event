export const PLANNING_SCHEMA_VERSION = 2 as const;
const LEGACY_PLANNING_SCHEMA_VERSION = 1;
export const PLANNING_STORAGE_KEY = "event-map-planning-v1";
export const LEGACY_FAVORITES_KEY = "event-map-favorites";
export const PLANNING_CHANGED_EVENT = "event-map-planning-changed";

export type FavoriteGroup = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};

export type FavoriteRecord = {
  eventId: string;
  circleId: string;
  groupId: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

export type EventDayKey = string | number;

export type VisitPlanEntry = {
  eventId: string;
  day: EventDayKey;
  circleId: string;
  status: "planned" | "next" | "visited";
  routeOrder: number;
  updatedAt: string;
};

export type PlanningDocument = {
  schemaVersion: typeof PLANNING_SCHEMA_VERSION;
  favoriteGroups: FavoriteGroup[];
  favorites: FavoriteRecord[];
  visitPlans: VisitPlanEntry[];
};

export const EMPTY_PLANNING_DOCUMENT: PlanningDocument = {
  schemaVersion: PLANNING_SCHEMA_VERSION,
  favoriteGroups: [],
  favorites: [],
  visitPlans: [],
};

export type PlanningLoadSnapshot = {
  document: PlanningDocument;
  writable: boolean;
  raw: string | null;
  error: string;
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isDay = (value: unknown): value is EventDayKey => (typeof value === "string" && !!value.trim()) || (typeof value === "number" && Number.isFinite(value));
const nowIso = () => new Date().toISOString();

function normalize(document: PlanningDocument): PlanningDocument {
  const favoriteGroups = document.favoriteGroups
    .filter((group) => group.id && group.name.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group, sortOrder) => ({ ...group, name: group.name.trim(), sortOrder }));
  const groupIds = new Set(favoriteGroups.map((group) => group.id));
  const favoriteMap = new Map<string, FavoriteRecord>();
  document.favorites.forEach((favorite) => favoriteMap.set(`${favorite.eventId}\u0000${favorite.circleId}`, {
    ...favorite,
    groupId: favorite.groupId && groupIds.has(favorite.groupId) ? favorite.groupId : null,
  }));
  const planScopes = new Map<string, VisitPlanEntry[]>();
  document.visitPlans.forEach((entry) => {
    const key = `${entry.eventId}\u0000${entry.day}`;
    const entries = planScopes.get(key) ?? [];
    const duplicateIndex = entries.findIndex((item) => item.circleId === entry.circleId);
    if (duplicateIndex >= 0) entries[duplicateIndex] = entry; else entries.push(entry);
    planScopes.set(key, entries);
  });
  const visitPlans = [...planScopes.values()].flatMap((entries) => {
    let nextAssigned = false;
    return entries.sort((a, b) => a.routeOrder - b.routeOrder).map((entry, routeOrder) => {
      let status = entry.status;
      if (status === "next" && nextAssigned) status = "planned";
      if (status === "next") nextAssigned = true;
      return { ...entry, status, routeOrder };
    });
  });
  return { schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups, favorites: [...favoriteMap.values()], visitPlans };
}

export function parsePlanningDocument(value: unknown): PlanningDocument {
  if (!isObject(value) || value.schemaVersion !== PLANNING_SCHEMA_VERSION) return EMPTY_PLANNING_DOCUMENT;
  const favoriteGroups = Array.isArray(value.favoriteGroups) ? value.favoriteGroups.flatMap((item): FavoriteGroup[] => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name, color: typeof item.color === "string" ? item.color : "coral", sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0 }];
  }) : [];
  const favorites = Array.isArray(value.favorites) ? value.favorites.flatMap((item): FavoriteRecord[] => {
    if (!isObject(item) || typeof item.eventId !== "string" || typeof item.circleId !== "string") return [];
    const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : nowIso();
    return [{ eventId: item.eventId, circleId: item.circleId, groupId: typeof item.groupId === "string" ? item.groupId : null, memo: typeof item.memo === "string" ? item.memo : "", createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : updatedAt, updatedAt }];
  }) : [];
  const visitPlans = Array.isArray(value.visitPlans) ? value.visitPlans.flatMap((item): VisitPlanEntry[] => {
    if (!isObject(item) || typeof item.eventId !== "string" || typeof item.circleId !== "string" || !isDay(item.day)) return [];
    const status = item.status === "next" || item.status === "visited" ? item.status : "planned";
    return [{ eventId: item.eventId, day: item.day, circleId: item.circleId, status, routeOrder: typeof item.routeOrder === "number" ? item.routeOrder : 0, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "" }];
  }) : [];
  return normalize({ schemaVersion: PLANNING_SCHEMA_VERSION, favoriteGroups, favorites, visitPlans });
}

function mergeMemo(left: string, right: string) {
  return [...new Set([left.trim(), right.trim()].filter(Boolean))].join("\n\n");
}

export function migratePlanningCircleIds(document: PlanningDocument, migrateCircleId: (circleId: string) => string[]): PlanningDocument {
  const favorites = new Map<string, FavoriteRecord>();
  document.favorites.forEach((favorite) => {
    const targets = migrateCircleId(favorite.circleId);
    (targets.length > 0 ? targets : [favorite.circleId]).forEach((circleId) => {
      const key = `${favorite.eventId}\u0000${circleId}`;
      const current = favorites.get(key);
      if (!current) {
        favorites.set(key, { ...favorite, circleId });
        return;
      }
      const newer = current.updatedAt.localeCompare(favorite.updatedAt) <= 0 ? favorite : current;
      favorites.set(key, {
        ...newer,
        circleId,
        groupId: newer.groupId ?? current.groupId ?? favorite.groupId,
        memo: mergeMemo(current.memo, favorite.memo),
        createdAt: [current.createdAt, favorite.createdAt].filter(Boolean).sort()[0] ?? newer.createdAt,
        updatedAt: [current.updatedAt, favorite.updatedAt].sort().at(-1) ?? newer.updatedAt,
      });
    });
  });
  const visitPlans = document.visitPlans.flatMap((entry) => {
    const targets = migrateCircleId(entry.circleId);
    return (targets.length > 0 ? targets : [entry.circleId]).map((circleId) => ({ ...entry, circleId }));
  });
  return normalize({ ...document, favorites: [...favorites.values()], visitPlans });
}

export function loadPlanningDocument(storage: Pick<Storage, "getItem">, eventId: string, migrateLegacyCircleId?: (circleId: string) => string[]): PlanningDocument {
  return inspectPlanningStorage(storage, eventId, migrateLegacyCircleId).document;
}

export function inspectPlanningStorage(storage: Pick<Storage, "getItem">, eventId: string, migrateLegacyCircleId = (circleId: string) => [circleId]): PlanningLoadSnapshot {
  const saved = storage.getItem(PLANNING_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (!isObject(parsed) || (parsed.schemaVersion !== PLANNING_SCHEMA_VERSION && parsed.schemaVersion !== LEGACY_PLANNING_SCHEMA_VERSION)) {
        return { document: EMPTY_PLANNING_DOCUMENT, writable: false, raw: saved, error: "偵測到不相容的規劃資料版本；原始資料已保留，尚未覆寫。" };
      }
      const document = parsePlanningDocument({ ...parsed, schemaVersion: PLANNING_SCHEMA_VERSION });
      return {
        document: parsed.schemaVersion === LEGACY_PLANNING_SCHEMA_VERSION ? migratePlanningCircleIds(document, migrateLegacyCircleId) : document,
        writable: true,
        raw: saved,
        error: "",
      };
    } catch {
      return { document: EMPTY_PLANNING_DOCUMENT, writable: false, raw: saved, error: "規劃資料無法解析；原始資料已保留，尚未覆寫。" };
    }
  }
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_FAVORITES_KEY) || "[]");
    if (!Array.isArray(legacy)) return { document: EMPTY_PLANNING_DOCUMENT, writable: true, raw: null, error: "" };
    const updatedAt = nowIso();
    return { document: normalize({
      ...EMPTY_PLANNING_DOCUMENT,
      favorites: legacy.filter((id): id is string => typeof id === "string").flatMap((circleId) => migrateLegacyCircleId(circleId).map((migratedCircleId) => ({ eventId, circleId: migratedCircleId, groupId: null, memo: "", createdAt: updatedAt, updatedAt }))),
    }), writable: true, raw: null, error: "" };
  } catch {
    return { document: EMPTY_PLANNING_DOCUMENT, writable: true, raw: null, error: "" };
  }
}

export function savePlanningDocument(storage: Pick<Storage, "setItem" | "removeItem">, document: PlanningDocument) {
  const normalized = normalize(document);
  storage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(normalized));
  storage.removeItem(LEGACY_FAVORITES_KEY);
  return normalized;
}

export function toggleFavorite(document: PlanningDocument, eventId: string, circleId: string, updatedAt = nowIso()): PlanningDocument {
  const existing = document.favorites.find((item) => item.eventId === eventId && item.circleId === circleId);
  return normalize({
    ...document,
    favorites: existing
      ? document.favorites.filter((item) => item !== existing)
      : [...document.favorites, { eventId, circleId, groupId: null, memo: "", createdAt: updatedAt, updatedAt }],
  });
}

export function updateFavorite(document: PlanningDocument, eventId: string, circleId: string, groupId: string | null, memo: string, updatedAt = nowIso()): PlanningDocument {
  return normalize({ ...document, favorites: document.favorites.map((item) => item.eventId === eventId && item.circleId === circleId ? { ...item, groupId, memo, updatedAt } : item) });
}

export function createFavoriteGroup(document: PlanningDocument, name: string, color = "coral"): PlanningDocument {
  const trimmed = name.trim();
  if (!trimmed) return document;
  const id = `group-${Date.now()}-${document.favoriteGroups.length}`;
  return normalize({ ...document, favoriteGroups: [...document.favoriteGroups, { id, name: trimmed, color, sortOrder: document.favoriteGroups.length }] });
}

export function restoreFavorite(document: PlanningDocument, favorite: FavoriteRecord): PlanningDocument {
  return normalize({
    ...document,
    favorites: [
      ...document.favorites.filter((item) => item.eventId !== favorite.eventId || item.circleId !== favorite.circleId),
      favorite,
    ],
  });
}

export function updateFavoriteGroup(document: PlanningDocument, groupId: string, changes: Partial<Pick<FavoriteGroup, "name" | "color">>): PlanningDocument {
  const name = changes.name?.trim();
  if (changes.name !== undefined && !name) return document;
  return normalize({ ...document, favoriteGroups: document.favoriteGroups.map((group) => group.id === groupId ? { ...group, ...changes, ...(name ? { name } : {}) } : group) });
}

export function moveFavoriteGroup(document: PlanningDocument, groupId: string, direction: -1 | 1): PlanningDocument {
  const groups = [...document.favoriteGroups].sort((a, b) => a.sortOrder - b.sortOrder);
  const from = groups.findIndex((group) => group.id === groupId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= groups.length) return document;
  [groups[from], groups[to]] = [groups[to], groups[from]];
  return normalize({ ...document, favoriteGroups: groups.map((group, sortOrder) => ({ ...group, sortOrder })) });
}

export function deleteFavoriteGroup(document: PlanningDocument, groupId: string, targetGroupId: string | null): PlanningDocument {
  if (targetGroupId === groupId || (targetGroupId && !document.favoriteGroups.some((group) => group.id === targetGroupId))) return document;
  return normalize({
    ...document,
    favoriteGroups: document.favoriteGroups.filter((group) => group.id !== groupId),
    favorites: document.favorites.map((favorite) => favorite.groupId === groupId ? { ...favorite, groupId: targetGroupId, updatedAt: nowIso() } : favorite),
  });
}

export function moveFavoritesToGroup(document: PlanningDocument, eventId: string, sourceGroupId: string | null | "ALL", targetGroupId: string | null, updatedAt = nowIso()): PlanningDocument {
  if (targetGroupId && !document.favoriteGroups.some((group) => group.id === targetGroupId)) return document;
  return normalize({
    ...document,
    favorites: document.favorites.map((favorite) => {
      const inSource = favorite.eventId === eventId && (sourceGroupId === "ALL" || favorite.groupId === sourceGroupId);
      return inSource ? { ...favorite, groupId: targetGroupId, updatedAt } : favorite;
    }),
  });
}

export function addToVisitPlan(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string, updatedAt = nowIso()): PlanningDocument {
  if (document.visitPlans.some((item) => item.eventId === eventId && item.day === day && item.circleId === circleId)) return document;
  const scoped = document.visitPlans.filter((item) => item.eventId === eventId && item.day === day);
  return normalize({ ...document, visitPlans: [...document.visitPlans, { eventId, day, circleId, status: "planned", routeOrder: scoped.length, updatedAt }] });
}

export function removeFromVisitPlan(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string): PlanningDocument {
  return normalize({ ...document, visitPlans: document.visitPlans.filter((item) => item.eventId !== eventId || item.day !== day || item.circleId !== circleId) });
}

export function setNextStop(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string, updatedAt = nowIso()): PlanningDocument {
  const withTarget = document.visitPlans.some((item) => item.eventId === eventId && item.day === day && item.circleId === circleId) ? document : addToVisitPlan(document, eventId, day, circleId, updatedAt);
  return normalize({ ...withTarget, visitPlans: withTarget.visitPlans.map((item) => item.eventId === eventId && item.day === day ? { ...item, status: item.circleId === circleId ? "next" : item.status === "next" ? "planned" : item.status, updatedAt: item.circleId === circleId ? updatedAt : item.updatedAt } : item) });
}

export function markVisited(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string, visited: boolean, updatedAt = nowIso()): PlanningDocument {
  const current = document.visitPlans.find((item) => item.eventId === eventId && item.day === day && item.circleId === circleId);
  if (!current) return document;
  const visitPlans: VisitPlanEntry[] = document.visitPlans.map((item) => item === current ? { ...item, status: visited ? "visited" : "planned", updatedAt } : item);
  return normalize({ ...document, visitPlans });
}

export function moveVisitPlanEntry(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string, direction: -1 | 1): PlanningDocument {
  const scoped = document.visitPlans.filter((item) => item.eventId === eventId && item.day === day).sort((a, b) => a.routeOrder - b.routeOrder);
  const from = scoped.findIndex((item) => item.circleId === circleId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= scoped.length) return document;
  [scoped[from], scoped[to]] = [scoped[to], scoped[from]];
  const orders = new Map(scoped.map((item, routeOrder) => [item.circleId, routeOrder]));
  return normalize({ ...document, visitPlans: document.visitPlans.map((item) => item.eventId === eventId && item.day === day ? { ...item, routeOrder: orders.get(item.circleId) ?? item.routeOrder } : item) });
}

export function moveVisitPlanEntryToIndex(document: PlanningDocument, eventId: string, day: EventDayKey, circleId: string, targetIndex: number): PlanningDocument {
  const scoped = document.visitPlans.filter((item) => item.eventId === eventId && item.day === day).sort((a, b) => a.routeOrder - b.routeOrder);
  const from = scoped.findIndex((item) => item.circleId === circleId);
  if (from < 0 || targetIndex < 0 || targetIndex >= scoped.length || from === targetIndex) return document;
  const [entry] = scoped.splice(from, 1);
  scoped.splice(targetIndex, 0, entry);
  const orders = new Map(scoped.map((item, routeOrder) => [item.circleId, routeOrder]));
  return normalize({ ...document, visitPlans: document.visitPlans.map((item) => item.eventId === eventId && item.day === day ? { ...item, routeOrder: orders.get(item.circleId) ?? item.routeOrder } : item) });
}
