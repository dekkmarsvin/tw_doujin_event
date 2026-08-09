import type { CircleViewRecord } from "./circle-records";

export function resolveCircleSelection(
  records: CircleViewRecord[],
  recordsById: ReadonlyMap<string, CircleViewRecord>,
  day: 1 | 2 | 3,
  selectedCircleId: string | null,
  selectedBoothCode: string | null,
) {
  const legacyById = selectedCircleId ? recordsById.get(selectedCircleId) : undefined;
  const circleMatches = selectedCircleId ? records.filter((record) => record.day === day
    && (record.circle.id === selectedCircleId || record.recordId === selectedCircleId)) : [];

  if (selectedCircleId && selectedBoothCode) {
    return circleMatches.find((record) => record.code === selectedBoothCode) ?? null;
  }
  if (selectedCircleId) return circleMatches[0] ?? (legacyById?.day === day ? legacyById : null);
  if (selectedBoothCode) return records.find((record) => record.day === day && record.code === selectedBoothCode) ?? null;
  return null;
}
