export type EventDayDefinition<TDay extends string | number = string | number> = {
  id: TDay;
  label: string;
  dateLabel: string;
};

export type EventAreaDefinition<TArea extends string = string> = {
  id: TArea;
  label: string;
  shortLabel: string;
};

export type EventDefinition<TDay extends string | number = string | number, TArea extends string = string> = {
  id: string;
  name: string;
  venue: string;
  dateRangeLabel: string;
  dataUpdatedAt: string;
  dataLastUpdatedLabel: string;
  mapTemplate: string;
  areaMode: "single" | "switchable";
  days: readonly EventDayDefinition<TDay>[];
  areas: readonly EventAreaDefinition<TArea>[];
  /** Creator-category filter vocabulary. The first entry is the unfiltered option. */
  genres: readonly string[];
};

export const FF47_DATA_UPDATED_AT = "2026-08-11T00:00:00.000+08:00";

/**
 * When the event is over for publication purposes. A circle that opted out has
 * its self-written content withdrawn from the public overlay after this instant;
 * the reviewed organizer data is unaffected.
 */
export const FF47_ENDS_AT = "2026-08-23T23:59:59.999+08:00";

/** Organizer daily booth lists. Placement authority for the catalog snapshot. */
export const FF47_OFFICIAL_BOOTH_LIST_URLS = {
  1: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%80%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
  2: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%BA%8C%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
  3: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%89%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
} as const;

export const FF47_OFFICIAL_EVENT_URL = "https://www.f-2.com.tw/ff47%E4%B8%89%E6%97%A5%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F%E5%85%AC%E4%BD%88/";

function dataDateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

export const FF47_EVENT = {
  id: "ff47",
  name: "Fancy Frontier 47",
  venue: "花博公園爭豔館",
  dateRangeLabel: "8.21–23",
  dataUpdatedAt: FF47_DATA_UPDATED_AT,
  dataLastUpdatedLabel: dataDateLabel(FF47_DATA_UPDATED_AT),
  mapTemplate: "FF47",
  areaMode: "single",
  days: [
    { id: 1, label: "DAY 1", dateLabel: "8月21日・五" },
    { id: 2, label: "DAY 2", dateLabel: "8月22日・六" },
    { id: 3, label: "DAY 3", dateLabel: "8月23日・日" },
  ],
  areas: [
    { id: "ALL", label: "全館", shortLabel: "全部" },
    { id: "A", label: "A–K 區", shortLabel: "A–K" },
    { id: "B", label: "L–W 區", shortLabel: "L–W" },
  ],
  genres: ["全部類別", "繪圖・創作", "Cosplay", "VTuber", "手作・模型", "學生社團", "代理社團"],
} as const satisfies EventDefinition;

export function eventUsesAreaSwitcher(event: EventDefinition) {
  return event.areaMode === "switchable" && event.areas.length > 1;
}

export type FF47Day = (typeof FF47_EVENT.days)[number]["id"];
export type FF47Area = (typeof FF47_EVENT.areas)[number]["id"];
