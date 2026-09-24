import { resolveMapLandmarkKind, type EventMapLayout, type MapAccessPoint, type MapLandmarkKind } from "./event-map";
import { mapMarkerLabelKey } from "./map-marker-presentation";

type MapPoint = { x: number; y: number };

export type MapFacilityEntry = {
  /** The renderer's marker key, so a located entry can be outlined. */
  key: string;
  group: "access" | "area";
  kind: MapAccessPoint["kind"] | MapLandmarkKind;
  label: string;
  /** Accessible name: the label, plus its type when the label does not say it. */
  ariaLabel: string;
  point: MapPoint;
};

export type MapLegendEntry = { kind: MapAccessPoint["kind"] | "pillar" | "area"; label: string };

const TYPE_LABELS: Record<MapFacilityEntry["kind"], string> = { entrance: "入口", exit: "出口", enterprise: "企業攤", stage: "舞台", other: "區域" };

function describe(label: string, kind: MapFacilityEntry["kind"]) {
  const type = TYPE_LABELS[kind];
  return label.includes(type) ? label : `${label}，${type}`;
}

/**
 * What the reader's facility list offers for one map. Every named access point
 * is its own entry. A non-booth area is its own entry only when its name is its
 * own: a name several areas share, such as a hall's many 企業攤, says what the
 * grey blocks are rather than where to go, so it is explained once in the legend
 * instead of listed once per block. The legend covers only what this map draws.
 */
export function mapFacilityDirectory(layout: Pick<EventMapLayout, "accessPoints" | "landmarks" | "pillars">): { entries: MapFacilityEntry[]; legend: MapLegendEntry[] } {
  const entries: MapFacilityEntry[] = [];
  for (const point of layout.accessPoints) {
    const label = point.label.trim();
    if (!label) continue;
    entries.push({ key: mapMarkerLabelKey("access", point.id), group: "access", kind: point.kind, label, ariaLabel: describe(label, point.kind), point: { x: point.x, y: point.y } });
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
  if (layout.accessPoints.some((point) => point.kind === "entrance")) legend.push({ kind: "entrance", label: TYPE_LABELS.entrance });
  if (layout.accessPoints.some((point) => point.kind === "exit")) legend.push({ kind: "exit", label: TYPE_LABELS.exit });
  if (layout.pillars.length) legend.push({ kind: "pillar", label: "柱子" });
  for (const [label, count] of labelCounts) if (count > 1) legend.push({ kind: "area", label });
  return { entries, legend };
}
