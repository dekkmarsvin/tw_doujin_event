import type { CircleViewRecord } from "./circle-records";

/**
 * `selectedCircle` may carry a booth-scoped alias (`1-e19`, `1-e19-0`) instead
 * of the allocated `c-xxxxxx`, because links shared before the switch still do.
 * `resolveAliases` derives the canonical ids from the records in hand — there
 * is no stored translation table and no migration left to run (ADR-0013), so
 * nothing here is named after one.
 */
export function resolveCircleSelection(
  records: CircleViewRecord[],
  recordsById: ReadonlyMap<string, CircleViewRecord>,
  day: string | number,
  selectedCircleId: string | null,
  selectedBoothCode: string | null,
  resolveAliases: (circleId: string) => readonly string[] = (circleId) => [circleId],
) {
  const boothScopedMatch = selectedCircleId ? recordsById.get(selectedCircleId) : undefined;
  const circleIds = selectedCircleId ? resolveAliases(selectedCircleId) : [];
  const circleMatches = selectedCircleId ? records.filter((record) => record.day === day
    && (circleIds.includes(record.circle.id) || record.recordId === selectedCircleId)) : [];

  if (selectedCircleId && selectedBoothCode) {
    return circleMatches.find((record) => record.code === selectedBoothCode) ?? null;
  }
  if (selectedCircleId) return circleMatches[0] ?? (boothScopedMatch?.day === day ? boothScopedMatch : null);
  if (selectedBoothCode) return records.find((record) => record.day === day && record.code === selectedBoothCode) ?? null;
  return null;
}
