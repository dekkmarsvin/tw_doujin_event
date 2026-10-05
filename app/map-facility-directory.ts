import { MAP_SERVICE_POINT_KINDS, resolveMapLandmarkKind, type EventMapLayout, type MapAccessKind, type MapLandmarkKind, type MapServicePointKind } from "./event-map";
import type { Locale } from "./i18n/locale";
import { defineMessages, translate } from "./i18n/messages";
import { mapMarkerLabelKey } from "./map-marker-presentation";
import { shapeInterior } from "./map-shape-geometry";

type MapPoint = { x: number; y: number };

export type MapFacilityEntry = {
  /** The renderer's marker key, so a located entry can be outlined. */
  key: string;
  group: "access" | "service" | "area";
  kind: MapAccessKind | MapServicePointKind | MapLandmarkKind;
  /** The organizer's own name; null when the entry goes by its type. */
  name: string | null;
  label: string;
  /** Accessible name: the label, plus its type when the label does not say it. */
  ariaLabel: string;
  point: MapPoint;
};

/** An `area` entry's label is a name the organizer gave several areas; every
 * other label is the site's own name for the kind. */
export type MapLegendEntry = { kind: MapAccessKind | MapServicePointKind | "pillar" | "area"; label: string };

export const MAP_FACILITY_TYPE_LABELS: Record<MapFacilityEntry["kind"], string> = {
  entrance: "入口", exit: "出口", both: "出入兩用",
  toilet: "廁所", "accessible-toilet": "無障礙廁所", information: "服務台", cloakroom: "寄物處", "first-aid": "醫護站", stairs: "樓梯", elevator: "電梯",
  "ticket-office": "售票處", "changing-room": "更衣室",
  enterprise: "企業攤", stage: "舞台", other: "區域",
};

const TYPE_MESSAGES = defineMessages({
  "zh-Hant": { ...MAP_FACILITY_TYPE_LABELS, pillar: "柱子", separator: "，" },
  en: {
    entrance: "Entrance", exit: "Exit", both: "Entrance & exit",
    toilet: "Restroom", "accessible-toilet": "Accessible restroom", information: "Information", cloakroom: "Cloakroom", "first-aid": "First aid", stairs: "Stairs", elevator: "Elevator",
    "ticket-office": "Ticket office", "changing-room": "Changing room",
    enterprise: "Corporate booths", stage: "Stage", other: "Area", pillar: "Pillar", separator: ", ",
  },
  ja: {
    entrance: "入口", exit: "出口", both: "出入口",
    toilet: "トイレ", "accessible-toilet": "多目的トイレ", information: "案内所", cloakroom: "クローク", "first-aid": "救護室", stairs: "階段", elevator: "エレベーター",
    "ticket-office": "チケット売り場", "changing-room": "更衣室",
    enterprise: "企業ブース", stage: "ステージ", other: "エリア", pillar: "柱", separator: "、",
  },
});

/** The site's name for a kind of facility. Organizer-given names never pass through here. */
export function mapFacilityTypeLabel(kind: MapFacilityEntry["kind"] | "pillar", locale: Locale = "zh-Hant"): string {
  return translate(TYPE_MESSAGES, locale, kind);
}

/** A name followed by its type, unless the name already says the type. */
export function describeMapFacility(name: string, kind: MapFacilityEntry["kind"], locale: Locale = "zh-Hant"): string {
  const type = mapFacilityTypeLabel(kind, locale);
  return name.includes(type) ? name : `${name}${translate(TYPE_MESSAGES, locale, "separator")}${type}`;
}

/** An entry's visible and accessible names in the interface language. */
export function mapFacilityEntryText(entry: Pick<MapFacilityEntry, "kind" | "name">, locale: Locale = "zh-Hant") {
  const label = entry.name ?? mapFacilityTypeLabel(entry.kind, locale);
  return { label, ariaLabel: describeMapFacility(label, entry.kind, locale) };
}

/** A legend row's label: an organizer's shared area name stays as written. */
export function mapLegendLabel(item: MapLegendEntry, locale: Locale = "zh-Hant"): string {
  return item.kind === "area" ? item.label : mapFacilityTypeLabel(item.kind, locale);
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
    entries.push({ key: mapMarkerLabelKey("access", point.id), group: "access", kind: point.kind, name: label, ...mapFacilityEntryText({ kind: point.kind, name: label }), point: { x: point.x, y: point.y } });
  }
  const services = layout.servicePoints ?? [];
  for (const kind of MAP_SERVICE_POINT_KINDS) {
    for (const point of services) {
      if (point.kind !== kind) continue;
      const name = point.label?.trim() || null;
      entries.push({ key: mapMarkerLabelKey("service", point.id), group: "service", kind, name, ...mapFacilityEntryText({ kind, name }), point: { x: point.x, y: point.y } });
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
    const { x, y } = shapeInterior(landmark.rect);
    entries.push({
      key: mapMarkerLabelKey("landmark", landmark.id), group: "area", kind, name: label, ...mapFacilityEntryText({ kind, name: label }),
      point: { x, y },
    });
  }
  const legend: MapLegendEntry[] = [];
  for (const kind of ["entrance", "exit", "both"] as const) {
    if (layout.accessPoints.some((point) => point.kind === kind)) legend.push({ kind, label: MAP_FACILITY_TYPE_LABELS[kind] });
  }
  for (const kind of MAP_SERVICE_POINT_KINDS) {
    if (services.some((point) => point.kind === kind)) legend.push({ kind, label: MAP_FACILITY_TYPE_LABELS[kind] });
  }
  if (layout.pillars.length) legend.push({ kind: "pillar", label: mapFacilityTypeLabel("pillar") });
  for (const [label, count] of labelCounts) if (count > 1) legend.push({ kind: "area", label });
  return { entries, legend };
}
