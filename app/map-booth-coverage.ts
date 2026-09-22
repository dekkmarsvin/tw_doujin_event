import type { EventMapLayout } from "./event-map";

export type MapBoothGroup = { circleName: string; codes: readonly string[] };
export type MapBoothScope = {
  periodKey: string;
  venueSpaceId: string;
  requiredBoothCodes: readonly string[];
  allowedBoothCodes: readonly string[];
  allowsUnallocatedBooths: boolean;
  groups?: readonly MapBoothGroup[];
};

/** Use the same exact codes as server validation; this is a projection of the
 * current canvas, never a persisted completion flag. */
export function mapBoothCoverage(layout: EventMapLayout, scope: MapBoothScope) {
  const drawn = new Set(layout.rows.flatMap(row => row.slots.map(slot => slot.code)));
  const required = [...new Set(scope.requiredBoothCodes)];
  const allowed = new Set(scope.allowedBoothCodes);
  const missing = required.filter(code => !drawn.has(code));
  const unknown = [...drawn].filter(code => !allowed.has(code)).sort();
  return { drawn, required, missing, unknown, completed: required.length - missing.length };
}

export function boothGroupCoverage(codes: readonly string[], drawn: ReadonlySet<string>) {
  const unique = [...new Set(codes)];
  const completed = unique.filter(code => drawn.has(code)).length;
  return { completed, total: unique.length, label: completed === 0 ? "待畫" : completed === unique.length ? "已畫" : "部分已畫" };
}
