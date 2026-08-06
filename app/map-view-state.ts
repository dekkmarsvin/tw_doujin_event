import type { CircleViewRecord } from "./circle-records";

export function resolveCircleSelection(
  records: CircleViewRecord[],
  recordsById: ReadonlyMap<string, CircleViewRecord>,
  day: 1 | 2 | 3,
  selectedCircleId: string | null,
  selectedBoothCode: string | null,
) {
  const byId = selectedCircleId ? recordsById.get(selectedCircleId) : undefined;
  const circleMatchesDay = byId?.day === day;

  if (selectedCircleId && selectedBoothCode) {
    return circleMatchesDay && byId.code === selectedBoothCode ? byId : null;
  }
  if (selectedCircleId) return circleMatchesDay ? byId : null;
  if (selectedBoothCode) return records.find((record) => record.day === day && record.code === selectedBoothCode) ?? null;
  return null;
}
