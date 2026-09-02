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
] as const;

/** `all` narrows to circles carrying every listed topic; `any` widens. The
 * mode only reaches the URL and the UI once a second topic exists, because a
 * single topic reads the same either way. */
type WorkTopicMode = "any" | "all";

export type AdvancedCircleSearch = {
  creatorType: string;
  workTopics: string[];
  workTopicMode: WorkTopicMode;
  excludedWorkTopics: string[];
  workType: "ALL" | "原創" | "二創";
  adultContent: "ALL" | "R18" | "GENERAL";
};

export const DEFAULT_ADVANCED_CIRCLE_SEARCH: AdvancedCircleSearch = {
  creatorType: "ALL",
  workTopics: [],
  workTopicMode: "any",
  excludedWorkTopics: [],
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

/** The topic list is a set of conditions, not a string. Two spellings of one
 * work would otherwise become two conditions, and under `all` that turns a
 * reasonable query into an empty result. */
export function normalizeWorkTopics(values: readonly string[]) {
  const seen = new Set<string>();
  return values.reduce<string[]>((topics, raw) => {
    const value = raw.trim();
    const key = normalizeAlias(value);
    if (!value || !key || seen.has(key)) return topics;
    seen.add(key);
    return [...topics, value];
  }, []);
}

function workTopicHaystack(record: CircleViewRecord) {
  return normalize([record.circle.work, ...record.circle.referencedWorks].join("\n"));
}

function workTopicHits(haystack: string, topic: string) {
  const needles = workQueryNeedles(topic);
  return needles.length > 0 && needles.some((needle) => haystack.includes(needle));
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
  const workHaystack = workTopicHaystack(record);
  const includedTopics = normalizeWorkTopics(search.workTopics);
  const workNameMatches = includedTopics.length === 0
    || (search.workTopicMode === "all"
      ? includedTopics.every((topic) => workTopicHits(workHaystack, topic))
      : includedTopics.some((topic) => workTopicHits(workHaystack, topic)));
  // Exclusion wins over inclusion: a circle listed under both a wanted and an
  // unwanted topic is one the reader asked not to see.
  const notExcluded = !normalizeWorkTopics(search.excludedWorkTopics)
    .some((topic) => workTopicHits(workHaystack, topic));
  const workTypeMatches = search.workType === "ALL"
    || record.circle.workTypes.some((type) => normalize(type) === normalize(search.workType));
  const includesR18 = circleIncludesR18(record);
  const includesGeneral = circleIncludesGeneral(record);
  const adultMatches = search.adultContent === "ALL"
    || (search.adultContent === "R18" ? includesR18 : includesGeneral);

  return creatorMatches && workNameMatches && notExcluded && workTypeMatches && adultMatches;
}

export function advancedCircleSearchCount(search: AdvancedCircleSearch) {
  return Number(search.creatorType !== "ALL")
    + normalizeWorkTopics(search.workTopics).length
    + normalizeWorkTopics(search.excludedWorkTopics).length
    + Number(search.workType !== "ALL")
    + Number(search.adultContent !== "ALL");
}

export type CircleMatchReason = { id: string; label: string };

/** Which text the keyword actually hit. A circle that surfaced because its
 * blurb happens to mention a work reads very differently from one whose listed
 * work is that work, and the card alone cannot tell the two apart. */
const KEYWORD_FIELDS: ReadonlyArray<{ label: string; values: (record: CircleViewRecord) => (string | undefined)[] }> = [
  { label: "攤位代碼", values: (record) => [record.code] },
  { label: "社團名", values: (record) => [record.name, record.circle.pen] },
  { label: "作品", values: (record) => [record.circle.work, ...record.circle.referencedWorks] },
  { label: "類別", values: (record) => [record.genre, ...record.circle.creatorTypes, ...record.circle.workTypes, ...record.circle.ageRatings] },
  { label: "標籤", values: (record) => [...record.tags, ...record.circle.specialTags] },
  { label: "介紹", values: (record) => [record.note, record.circle.saleInfo] },
  { label: "連結", values: (record) => record.circle.externalLinks.flatMap((link) => [link.provider, link.url]) },
];

export function describeCircleMatch(record: CircleViewRecord, input: { query: string; search: AdvancedCircleSearch }) {
  const reasons: CircleMatchReason[] = [];
  const needle = normalize(input.query);
  if (needle) {
    const fields = KEYWORD_FIELDS
      .filter(({ values }) => values(record).some((value) => value && normalize(value).includes(needle)))
      .map(({ label }) => label);
    if (fields.length > 0) reasons.push({ id: "keyword", label: `關鍵字命中${fields.join("、")}` });
  }
  const workHaystack = workTopicHaystack(record);
  normalizeWorkTopics(input.search.workTopics)
    .filter((topic) => workTopicHits(workHaystack, topic))
    .forEach((topic) => reasons.push({ id: `topic:${topic}`, label: `作品：${topic}` }));
  if (input.search.creatorType !== "ALL") reasons.push({ id: "creator", label: `創作者：${input.search.creatorType}` });
  return reasons;
}
