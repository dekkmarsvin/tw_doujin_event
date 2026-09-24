import { MAP_SERVICE_POINT_KINDS, resolveMapLandmarkKind, type EventMapLayout, type MapAccessKind, type MapLandmarkKind, type MapServicePointKind } from "./event-map";
import { mapMarkerLabelKey } from "./map-marker-presentation";

type MapPoint = { x: number; y: number };

export type MapFacilityEntry = {
  /** The renderer's marker key, so a located entry can be outlined. */
  key: string;
  group: "access" | "service" | "area";
  kind: MapAccessKind | MapServicePointKind | MapLandmarkKind;
  label: string;
  /** Accessible name: the label, plus its type when the label does not say it. */
  ariaLabel: string;
  point: MapPoint;
};

export type MapLegendEntry = { kind: MapAccessKind | MapServicePointKind | "pillar" | "area"; label: string };

export const MAP_FACILITY_TYPE_LABELS: Record<MapFacilityEntry["kind"], string> = {
  entrance: "入口", exit: "出口", both: "出入兩用",
  toilet: "廁所", "accessible-toilet": "無障礙廁所", information: "服務台", cloakroom: "寄物處", "first-aid": "醫護站", stairs: "樓梯", elevator: "電梯",
  enterprise: "企業攤", stage: "舞台", other: "區域",
};

function describe(label: string, kind: MapFacilityEntry["kind"]) {
  const type = MAP_FACILITY_TYPE_LABELS[kind];
  return label.includes(type) ? label : `${label}，${type}`;
}

/**
 * What the reader's facility list offers for one map. Every named access point
 * is its own entry, and so is every service point, grouped by type so a reader
 * sees all the toilets together; one without a name of its own goes by its
 * type. A non-booth area is its own entry only when its name is its own: a name
 * several areas share, such as a hall's many 企業攤, says what the grey blocks
 * are rather than where to go, so it is explained once in the legend instead of
 * listed once per block. The legend covers only what this map draws.
 */
export function mapFacilityDirectory(layout: Pick<EventMapLayout, "accessPoints" | "landmarks" | "pillars" | "servicePoints">): { entries: MapFacilityEntry[]; legend: MapLegendEntry[] } {
  const entries: MapFacilityEntry[] = [];
  for (const point of layout.accessPoints) {
    const label = point.label.trim();
    if (!label) continue;
    entries.push({ key: mapMarkerLabelKey("access", point.id), group: "access", kind: point.kind, label, ariaLabel: describe(label, point.kind), point: { x: point.x, y: point.y } });
  }
  const services = layout.servicePoints ?? [];
  for (const kind of MAP_SERVICE_POINT_KINDS) {
    for (const point of services) {
      if (point.kind !== kind) continue;
      const label = point.label?.trim() || MAP_FACILITY_TYPE_LABELS[kind];
      entries.push({ key: mapMarkerLabelKey("service", point.id), group: "service", kind, label, ariaLabel: describe(label, kind), point: { x: point.x, y: point.y } });
    }
  }
  const labelCounts = new Map<string, number>();
  for (const landmark of layout.landmarks) {
    const label = landmark.label.trim();
    if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  for (const landmark of layout.landmarks) {
    const label = landmark.label.trim();
    if (!label || labelCounts.get(label) !== 1) continue;
    const kind = resolveMapLandmarkKind(landmark);
    entries.push({
      key: mapMarkerLabelKey("landmark", landmark.id), group: "area", kind, label, ariaLabel: describe(label, kind),
      point: { x: landmark.rect.x + landmark.rect.width / 2, y: landmark.rect.y + landmark.rect.height / 2 },
    });
  }
  const legend: MapLegendEntry[] = [];
  for (const kind of ["entrance", "exit", "both"] as const) {
    if (layout.accessPoints.some((point) => point.kind === kind)) legend.push({ kind, label: MAP_FACILITY_TYPE_LABELS[kind] });
  }
  for (const kind of MAP_SERVICE_POINT_KINDS) {
    if (services.some((point) => point.kind === kind)) legend.push({ kind, label: MAP_FACILITY_TYPE_LABELS[kind] });
  }
  if (layout.pillars.length) legend.push({ kind: "pillar", label: "柱子" });
  for (const [label, count] of labelCounts) if (count > 1) legend.push({ kind: "area", label });
  return { entries, legend };
}
