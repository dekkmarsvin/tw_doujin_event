import type { CircleViewRecord } from "./circle-records";

export function resolveCircleSelection(
  records: CircleViewRecord[],
  recordsById: ReadonlyMap<string, CircleViewRecord>,
  day: 1 | 2 | 3,
  selectedCircleId: string | null,
  selectedBoothCode: string | null,
  migrateCircleId: (circleId: string) => readonly string[] = (circleId) => [circleId],
) {
  const legacyById = selectedCircleId ? recordsById.get(selectedCircleId) : undefined;
  const circleIds = selectedCircleId ? migrateCircleId(selectedCircleId) : [];
  const circleMatches = selectedCircleId ? records.filter((record) => record.day === day
    && (circleIds.includes(record.circle.id) || record.recordId === selectedCircleId)) : [];

  if (selectedCircleId && selectedBoothCode) {
    return circleMatches.find((record) => record.code === selectedBoothCode) ?? null;
  }
  if (selectedCircleId) return circleMatches[0] ?? (legacyById?.day === day ? legacyById : null);
  if (selectedBoothCode) return records.find((record) => record.day === day && record.code === selectedBoothCode) ?? null;
  return null;
}
