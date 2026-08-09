import type { CircleViewRecord } from "./circle-records";
import { WORK_TOPIC_ALIAS_GROUPS, type WorkTopicAliasGroup } from "./work-topic-aliases";

export const CREATOR_TYPE_OPTIONS = [
  "繪師",
  "Coser",
  "Vtuber",
  "寫手",
  "音聲作品",
  "手工藝品",
  "模型",
  "攝影",
  "學生社團",
  "代理社團",
] as const;

export type AdvancedCircleSearch = {
  creatorType: string;
  workQuery: string;
  workType: "ALL" | "原創" | "二創";
  adultContent: "ALL" | "R18" | "GENERAL";
};

export const DEFAULT_ADVANCED_CIRCLE_SEARCH: AdvancedCircleSearch = {
  creatorType: "ALL",
  workQuery: "",
  workType: "ALL",
  adultContent: "ALL",
};

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeAlias(value: string) {
  return normalize(value).replace(/[\s・:：/／_-]+/g, "");
}

export type WorkTopicSuggestion = {
  value: string;
  aliases: readonly string[];
  count: number;
};

function aliasGroupFor(value: string): WorkTopicAliasGroup | undefined {
  const candidates = [value, ...value.split(/[、,，/／\n]+/)].map(normalizeAlias).filter(Boolean);
  return WORK_TOPIC_ALIAS_GROUPS.find((group) => [group.canonical, ...group.aliases]
    .some((alias) => candidates.includes(normalizeAlias(alias))));
}

export function buildWorkTopicSuggestions(records: CircleViewRecord[]): WorkTopicSuggestion[] {
  const topics = new Map<string, { value: string; aliases: readonly string[]; circleIds: Set<string> }>();

  records.forEach((record) => {
    record.circle.referencedWorks.forEach((sourceValue) => {
      const value = sourceValue.trim();
      if (!value) return;
      const aliasGroup = aliasGroupFor(value);
      const displayValue = aliasGroup?.canonical ?? value;
      const key = normalizeAlias(displayValue);
      const current = topics.get(key) ?? { value: displayValue, aliases: aliasGroup?.aliases ?? [], circleIds: new Set<string>() };
      current.circleIds.add(record.circle.id);
      topics.set(key, current);
    });
  });

  return [...topics.values()]
    .map(({ value, aliases, circleIds }) => ({ value, aliases, count: circleIds.size }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "zh-Hant"));
}

export function findWorkTopicSuggestions(suggestions: WorkTopicSuggestion[], query: string, limit = 6) {
  const needle = normalizeAlias(query);
  if (!needle) return [];

  return suggestions
    .filter((suggestion) => [suggestion.value, ...suggestion.aliases].some((value) => normalizeAlias(value).includes(needle)))
    .sort((left, right) => {
      const leftStarts = Number([left.value, ...left.aliases].some((value) => normalizeAlias(value).startsWith(needle)));
      const rightStarts = Number([right.value, ...right.aliases].some((value) => normalizeAlias(value).startsWith(needle)));
      return rightStarts - leftStarts || right.count - left.count || left.value.localeCompare(right.value, "zh-Hant");
    })
    .slice(0, limit);
}

function workQueryNeedles(value: string) {
  const normalized = normalize(value);
  if (!normalized) return [];
  const aliasNeedle = normalizeAlias(value);
  const group = WORK_TOPIC_ALIAS_GROUPS.find((candidate) => [candidate.canonical, ...candidate.aliases]
    .some((alias) => normalizeAlias(alias) === aliasNeedle));
  return group ? [group.canonical, ...group.aliases].map(normalize) : [normalized];
}

export function circleIncludesR18(record: CircleViewRecord) {
  return record.circle.ageRatings
    .some((value) => /(^|\W)r\s*-?\s*18($|\W)/i.test(value.normalize("NFKC")));
}

export function circleIncludesGeneral(record: CircleViewRecord) {
  return record.circle.ageRatings.some((value) => /(^|[\s,，、/／])(?:一般|general)(?=$|[\s,，、/／])/i.test(value.normalize("NFKC")));
}

export function matchesAdvancedCircleSearch(record: CircleViewRecord, search: AdvancedCircleSearch) {
  const creatorNeedle = normalize(search.creatorType);
  const creatorMatches = search.creatorType === "ALL"
    || record.circle.creatorTypes.some((type) => normalize(type).includes(creatorNeedle));
  const workNeedles = workQueryNeedles(search.workQuery);
  const workHaystack = normalize([record.circle.work, ...record.circle.referencedWorks].join("\n"));
  const workNameMatches = workNeedles.length === 0 || workNeedles.some((needle) => workHaystack.includes(needle));
  const workTypeMatches = search.workType === "ALL"
    || record.circle.workTypes.some((type) => normalize(type) === normalize(search.workType));
  const includesR18 = circleIncludesR18(record);
  const includesGeneral = circleIncludesGeneral(record);
  const adultMatches = search.adultContent === "ALL"
    || (search.adultContent === "R18" ? includesR18 : includesGeneral);

  return creatorMatches && workNameMatches && workTypeMatches && adultMatches;
}

export function advancedCircleSearchCount(search: AdvancedCircleSearch) {
  return Number(search.creatorType !== "ALL")
    + Number(Boolean(search.workQuery.trim()))
    + Number(search.workType !== "ALL")
    + Number(search.adultContent !== "ALL");
}
