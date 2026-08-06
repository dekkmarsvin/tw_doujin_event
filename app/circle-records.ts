import { FF47_EVENT } from "./event-catalog";
import { BOOTHS, type Booth, type Tone } from "./ff47-booths";

export type SourceStatus = "linked" | "stale" | "unavailable" | "unverified";
export type SourceContentType = "official" | "circle" | "catalog" | "social" | "media";

export type SourceLink = {
  provider: string;
  contentType: SourceContentType;
  label: string;
  url: string;
  fetchedAt: string;
  status: SourceStatus;
};

/** A circle's reusable identity and catalog metadata, independent of a booth. */
export type CircleRecord = {
  id: string;
  name: string;
  nameReading?: string;
  description: string;
  categories: string[];
  pen: string;
  work: string;
  updatedAt: string;
  sources: SourceLink[];
};

/** An event-specific placement. A circle may have more than one placement. */
export type PlacementRecord = {
  id: string;
  eventId: string;
  circleId: string;
  day: Booth["day"];
  area: Booth["hall"];
  boothCode: string;
  status: "active" | "cancelled" | "moved";
  x: number;
  y: number;
  tone: Tone;
};

/** Read model used by the map UI. Its record ID is unique even when source IDs collide. */
export type CircleViewRecord = Booth & {
  recordId: string;
  sources: SourceLink[];
  circle: CircleRecord;
  placement: PlacementRecord;
};

const CATALOG_FETCHED_AT = "2026-08-06T00:00:00.000+08:00";

const FF47_SOURCES = [
  {
    provider: "開拓動漫",
    contentType: "official",
    label: "FF47 活動與攤位配置",
    url: "https://www.f-2.com.tw/ff47%E4%B8%89%E6%97%A5%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F%E5%85%AC%E4%BD%88/",
    fetchedAt: CATALOG_FETCHED_AT,
    status: "linked",
  },
  {
    provider: "加帕利天藍怪預警中心",
    contentType: "catalog",
    label: "FF47 社團公開整理資料",
    url: "https://www.facebook.com/JapariWeatherBureau/",
    fetchedAt: CATALOG_FETCHED_AT,
    status: "linked",
  },
] as const satisfies readonly SourceLink[];

function cloneSources(): SourceLink[] {
  return FF47_SOURCES.map((source) => ({ ...source }));
}

const rows = BOOTHS.map((booth, index) => {
  const recordId = `${booth.id}-${index}`;
  // The current reviewed catalog is one row per circle identity. Future
  // reviewed merges may let multiple placements share a canonical circle key.
  const circleId = recordId;
  const sources = cloneSources();
  const circle: CircleRecord = {
    id: circleId,
    name: booth.name,
    description: booth.note,
    categories: [booth.genre, ...booth.tags.map((tag) => tag.trim()).filter(Boolean)],
    pen: booth.pen,
    work: booth.work,
    updatedAt: CATALOG_FETCHED_AT,
    sources: cloneSources(),
  };
  const placement: PlacementRecord = {
    id: booth.id,
    eventId: FF47_EVENT.id,
    circleId,
    day: booth.day,
    area: booth.hall,
    boothCode: booth.code,
    status: "active",
    x: booth.x,
    y: booth.y,
    tone: booth.tone,
  };

  const view: CircleViewRecord = { ...booth, recordId, sources, circle, placement };
  return { circle, placement, view };
});

export const CIRCLE_CATALOG: CircleRecord[] = rows.map(({ circle }) => circle);
export const PLACEMENT_CATALOG: PlacementRecord[] = rows.map(({ placement }) => placement);
export const CIRCLE_RECORDS: CircleViewRecord[] = rows.map(({ view }) => view);
export const CIRCLE_RECORDS_BY_ID = new Map(CIRCLE_RECORDS.map((record) => [record.recordId, record]));
export const LEGACY_CIRCLE_RECORD_IDS = new Map<string, string[]>();
CIRCLE_RECORDS.forEach((record) => {
  LEGACY_CIRCLE_RECORD_IDS.set(record.id, [...(LEGACY_CIRCLE_RECORD_IDS.get(record.id) ?? []), record.recordId]);
});

export function circleSearchText(record: CircleViewRecord) {
  return [record.code, record.name, record.pen, record.genre, record.work, record.note, ...record.tags]
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
}
