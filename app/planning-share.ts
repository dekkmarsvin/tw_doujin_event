import { getCircleCatalogState, type CircleViewRecord } from "./circle-records";
import type { ShareSnapshot } from "./planning-share-snapshot";
import type { EventDayKey, PlanningDocument, VisitPlanEntry } from "./planning-store";

export { SHARE_MAX_ITEMS, type ShareSnapshot } from "./planning-share-snapshot";

/** Current identity and display records; days lists active destinations, records retain retired evidence. */
export type ResolvedSharedItem = ShareSnapshot["items"][number] & {
  state: "available" | "moved" | "withdrawn" | "unknown";
  circle: CircleViewRecord["circle"] | null;
  records: CircleViewRecord[];
  days: EventDayKey[];
};

const itemKey = (circleId: string, day: EventDayKey) => JSON.stringify([circleId, String(day)]);

/** Only this event's selected itinerary IDs/days leave the device, in selection order. */
export function projectSharedItinerary(document: PlanningDocument, eventId: string, selection: ShareSnapshot["items"]): ShareSnapshot {
  const eligible = new Set(document.visitPlans
    .filter(entry => entry.eventId === eventId)
    .map(entry => itemKey(entry.circleId, entry.day)));
  const seen = new Set<string>();
  const items = selection.flatMap(({ circleId, day }) => {
    const key = itemKey(circleId, day);
    if (!eligible.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ circleId, day }];
  });
  return { version: 1, eventId, items };
}

/** Resolves canonical IDs only; active same-day booths win, then moved destinations, then retired evidence. */
export function resolveSharedList(snapshot: ShareSnapshot): { status: "ready" | "loading" | "error"; items: ResolvedSharedItem[] } {
  const { status, catalog } = getCircleCatalogState(snapshot.eventId);
  if (status !== "ready") return { status, items: [] };
  const items = snapshot.items.map(({ circleId, day }): ResolvedSharedItem => {
    const circle = catalog.circlesById.get(circleId) ?? null;
    const allRecords = catalog.recordsByCircleId.get(circleId) ?? [];
    const active = allRecords.filter(record => record.placement.status === "active");
    const matching = active.filter(record => String(record.day) === String(day));
    const days = [...new Map(active.map(record => [String(record.day), record.day])).values()];
    const state = !circle ? "unknown" : matching.length ? "available" : active.length ? "moved"
      : allRecords.some(record => record.placement.status === "cancelled") ? "withdrawn" : "moved";
    return { circleId, day, state, circle, records: matching.length ? matching : active.length ? active : allRecords, days };
  });
  return { status, items };
}

/** Append missing planned entries to their own days; existing entries and private fields stay untouched. */
export function addSharedToPlan(document: PlanningDocument, eventId: string, items: ShareSnapshot["items"]): { document: PlanningDocument; added: number } {
  const existing = new Set<string>();
  const nextOrders = new Map<string, number>();
  for (const entry of document.visitPlans) {
    if (entry.eventId !== eventId) continue;
    existing.add(itemKey(entry.circleId, entry.day));
    const dayKey = String(entry.day);
    nextOrders.set(dayKey, Math.max(nextOrders.get(dayKey) ?? 0, entry.routeOrder + 1));
  }
  const updatedAt = new Date().toISOString();
  const additions = items.flatMap(({ circleId, day }): VisitPlanEntry[] => {
    const key = itemKey(circleId, day);
    if (existing.has(key)) return [];
    existing.add(key);
    const dayKey = String(day);
    const routeOrder = nextOrders.get(dayKey) ?? 0;
    nextOrders.set(dayKey, routeOrder + 1);
    return [{ eventId, day, circleId, status: "planned", routeOrder, purchaseMemo: "", budget: null, updatedAt }];
  });
  return { document: additions.length ? { ...document, visitPlans: [...document.visitPlans, ...additions] } : document, added: additions.length };
}
