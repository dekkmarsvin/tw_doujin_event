import { FF47_EVENT } from "./event-catalog";
import { FF47_CIRCLE_TEMPLATES, findCircleTemplate, type CircleTemplate, type CircleTemplateLinkKind } from "./ff47-circle-templates";
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

export type CircleMedia = {
  id: string;
  kind: "thumbnail";
  url: string;
  sourceUrl: string;
  provider: string;
  alt: string;
};

export type CircleExternalLink = {
  provider: string;
  kind: CircleTemplateLinkKind;
  url: string;
};

/** A circle's reusable identity and catalog metadata, independent of a booth. */
export type CircleRecord = {
  id: string;
  sourceRow?: number;
  name: string;
  nameReading?: string;
  description: string;
  categories: string[];
  pen: string;
  work: string;
  creatorTypes: string[];
  ageRatings: string[];
  workTypes: string[];
  referencedWorks: string[];
  saleInfo: string;
  specialTags: string[];
  media: CircleMedia[];
  externalLinks: CircleExternalLink[];
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

const CATALOG_FETCHED_AT = "2026-08-09T00:00:00.000+08:00";

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

function templateSource(template?: CircleTemplate): SourceLink[] {
  return template?.thumbnail ? [{
    provider: template.thumbnail.provider,
    contentType: "media",
    label: `${template.name} 公開縮圖`,
    url: template.thumbnail.sourceUrl,
    fetchedAt: CATALOG_FETCHED_AT,
    status: "linked",
  }] : [];
}

function circleFromTemplate(circleId: string, template?: CircleTemplate, booth?: Booth): CircleRecord {
  const name = template?.name ?? booth?.name ?? "未命名社團";
  return {
    id: circleId,
    sourceRow: template?.sourceRow,
    name,
    description: template?.saleInfo ?? booth?.note ?? "尚未提供販售資訊。",
    categories: [...new Set([
      ...(booth ? [booth.genre, ...booth.tags.map((tag) => tag.trim()).filter(Boolean)] : []),
      ...(template?.creatorTypes ?? []),
      ...(template?.workTypes ?? []),
      ...(template?.referencedWorks ?? []),
      ...(template?.specialTags ?? []),
    ])],
    pen: template?.pen ?? booth?.pen ?? "",
    work: template?.referencedWorks.join("、") || booth?.work || template?.creatorTypes.join("、") || "尚未提供作品分類",
    creatorTypes: template?.creatorTypes ?? [],
    ageRatings: template?.ageRatings ?? [],
    workTypes: template?.workTypes ?? [],
    referencedWorks: template?.referencedWorks ?? [],
    saleInfo: template?.saleInfo ?? "",
    specialTags: template?.specialTags ?? [],
    media: template?.thumbnail ? [{
      id: `${circleId}-thumbnail`,
      kind: "thumbnail",
      url: template.thumbnail.url,
      sourceUrl: template.thumbnail.sourceUrl,
      provider: template.thumbnail.provider,
      alt: `${name} 社團縮圖`,
    }] : [],
    externalLinks: template?.links.map((link) => ({ ...link })) ?? [],
    updatedAt: CATALOG_FETCHED_AT,
    sources: [...cloneSources(), ...templateSource(template)],
  };
}

const circlesById = new Map<string, CircleRecord>();

const rows = BOOTHS.map((booth, index) => {
  const recordId = `${booth.id}-${index}`;
  const template = findCircleTemplate(booth.name, booth.day, booth.code);
  // One row in the reviewed Excel master is identity evidence. Its booth cells
  // may expand to several event placements without duplicating the circle.
  const circleId = template?.id ?? recordId;
  const circle = circlesById.get(circleId) ?? circleFromTemplate(circleId, template, booth);
  circlesById.set(circleId, circle);
  const placement: PlacementRecord = {
    id: recordId,
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

  const view: CircleViewRecord = { ...booth, recordId, sources: circle.sources, circle, placement };
  return { circle, placement, view };
});

// Keep known Excel circles even when their row currently has no numbered booth
// (for example an enterprise/guest entry). They remain searchable data, but do
// not fabricate a PlacementRecord or map slot.
for (const template of FF47_CIRCLE_TEMPLATES) {
  if (circlesById.has(template.id)) continue;
  circlesById.set(template.id, circleFromTemplate(template.id, template));
}

export const CIRCLE_CATALOG: CircleRecord[] = [...circlesById.values()];
export const PLACEMENT_CATALOG: PlacementRecord[] = rows.map(({ placement }) => placement);
export const CIRCLE_RECORDS: CircleViewRecord[] = rows.map(({ view }) => view);
export const CIRCLE_RECORDS_BY_ID = new Map(CIRCLE_RECORDS.map((record) => [record.recordId, record]));
export const CIRCLE_RECORDS_BY_CIRCLE_ID = new Map<string, CircleViewRecord[]>();
CIRCLE_RECORDS.forEach((record) => CIRCLE_RECORDS_BY_CIRCLE_ID.set(record.circle.id, [...(CIRCLE_RECORDS_BY_CIRCLE_ID.get(record.circle.id) ?? []), record]));
export const CIRCLE_ID_MIGRATION_TARGETS = new Map<string, string[]>();
CIRCLE_RECORDS.forEach((record) => {
  CIRCLE_ID_MIGRATION_TARGETS.set(record.circle.id, [record.circle.id]);
  CIRCLE_ID_MIGRATION_TARGETS.set(record.recordId, [record.circle.id]);
  CIRCLE_ID_MIGRATION_TARGETS.set(record.id, [...new Set([...(CIRCLE_ID_MIGRATION_TARGETS.get(record.id) ?? []), record.circle.id])]);
});

export function circleSearchText(record: CircleViewRecord) {
  return [record.code, record.name, record.circle.pen, record.genre, record.circle.work, record.note, record.circle.saleInfo,
    ...record.tags, ...record.circle.creatorTypes, ...record.circle.ageRatings, ...record.circle.workTypes,
    ...record.circle.referencedWorks, ...record.circle.specialTags, ...record.circle.externalLinks.flatMap((link) => [link.provider, link.url])]
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
}
