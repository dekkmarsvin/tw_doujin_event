import { getPublishedEvent, type EventDefinition } from "./event-catalog";

export const SHARE_MAX_ITEMS = 500;

export type ShareSnapshot = {
  version: 1;
  eventId: string;
  items: { circleId: string; day: string | number }[];
};

type ShareEvent = Pick<EventDefinition, "days">;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Browser uses the built catalog; Functions supplies the deployed asset's event.
 * Array order is the itinerary order. Never project private planning fields. */
export function parseShareSnapshot(
  value: unknown,
  publishedEvent: (eventId: string) => ShareEvent | null = getPublishedEvent,
): { ok: true; snapshot: ShareSnapshot } | { ok: false; error: string } {
  const invalid = { ok: false, error: "分享清單格式無效。" } as const;
  if (!record(value) || !exactKeys(value, ["version", "eventId", "items"])
    || value.version !== 1 || typeof value.eventId !== "string") return invalid;
  const event = publishedEvent(value.eventId);
  if (!event) return { ok: false, error: "活動尚未公開或不存在。" };
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > SHARE_MAX_ITEMS) {
    return { ok: false, error: `分享清單須包含 1 至 ${SHARE_MAX_ITEMS} 個項目。` };
  }
  const seen = new Set<string>();
  const items: ShareSnapshot["items"] = [];
  for (const item of value.items) {
    if (!record(item) || !exactKeys(item, ["circleId", "day"])
      || typeof item.circleId !== "string" || item.circleId.trim() !== item.circleId || !/^c-\d+$/.test(item.circleId)
      || (typeof item.day !== "string" && typeof item.day !== "number")
      || !event.days.some(day => day.id === item.day)) return invalid;
    const key = JSON.stringify([item.circleId, item.day]);
    if (seen.has(key)) return { ok: false, error: "分享清單包含重複項目。" };
    seen.add(key);
    items.push({ circleId: item.circleId, day: item.day });
  }
  return { ok: true, snapshot: { version: 1, eventId: value.eventId, items } };
}
