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
  mapTemplate: string;
  days: readonly EventDayDefinition<TDay>[];
  areas: readonly EventAreaDefinition<TArea>[];
};

export const FF47_EVENT = {
  id: "ff47",
  name: "Fancy Frontier 47",
  venue: "花博公園爭艷館",
  dateRangeLabel: "8.21–23",
  mapTemplate: "FF47",
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
} as const satisfies EventDefinition;

export type FF47Day = (typeof FF47_EVENT.days)[number]["id"];
export type FF47Area = (typeof FF47_EVENT.areas)[number]["id"];
