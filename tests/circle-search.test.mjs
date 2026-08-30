import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { advancedCircleSearchCount, buildWorkTopicSuggestions, circleIncludesGeneral, circleIncludesR18, describeCircleMatch, findWorkTopicSuggestions, matchesAdvancedCircleSearch, normalizeWorkTopics } = await environment.runner.import("/app/circle-search.ts");
after(() => vite.close());

function record(overrides = {}) {
  return {
    tags: [],
    circle: {
      id: "circle-1",
      creatorTypes: ["Vtuber"],
      work: "原神短篇集",
      referencedWorks: ["原神"],
      workTypes: ["二創"],
      ageRatings: ["一般"],
      specialTags: [],
      externalLinks: [],
      ...overrides,
    },
  };
}

const all = { creatorType: "ALL", workTopics: [], workTopicMode: "any", excludedWorkTopics: [], workType: "ALL", adultContent: "ALL" };

test("advanced circle search combines creator, work name, and work type", () => {
  const candidate = record();
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, creatorType: "Vtuber", workTopics: ["原神"], workType: "二創" }), true);
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, creatorType: "Coser" }), false);
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, workTopics: ["蔚藍檔案"] }), false);
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, workType: "原創" }), false);
});

test("R18 filtering distinguishes adult, R15, and general records", () => {
  const adult = record({ ageRatings: ["R18"] });
  const r15 = record({ ageRatings: ["R15"] });
  const general = record({ ageRatings: ["一般"] });
  const unknown = record({ ageRatings: [] });
  assert.equal(circleIncludesR18(adult), true);
  assert.equal(circleIncludesR18(r15), false);
  assert.equal(circleIncludesGeneral(general), true);
  assert.equal(circleIncludesGeneral(r15), false);
  assert.equal(matchesAdvancedCircleSearch(adult, { ...all, adultContent: "R18" }), true);
  assert.equal(matchesAdvancedCircleSearch(r15, { ...all, adultContent: "R18" }), false);
  assert.equal(matchesAdvancedCircleSearch(general, { ...all, adultContent: "GENERAL" }), true);
  assert.equal(matchesAdvancedCircleSearch(r15, { ...all, adultContent: "GENERAL" }), false);
  assert.equal(matchesAdvancedCircleSearch(unknown, { ...all, adultContent: "GENERAL" }), false);
});

test("advanced circle search normalizes full-width and case variants", () => {
  assert.equal(matchesAdvancedCircleSearch(record({ creatorTypes: ["ＶＴＵＢＥＲ"], work: "ＢＬＵＥ ＡＲＣＨＩＶＥ", referencedWorks: [] }), { ...all, creatorType: "Vtuber", workTopics: ["blue archive"] }), true);
});

test("work-topic aliases match the same title across languages", () => {
  const umaMusume = record({ work: "賽馬娘", referencedWorks: ["賽馬娘"] });
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workTopics: ["ウマ娘"] }), true);
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workTopics: ["ウマ娘Pretty Derby"] }), true);
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workTopics: ["Uma Musume Pretty Derby"] }), true);
});

test("work-topic suggestions use catalog topics and reviewed aliases", () => {
  const suggestions = buildWorkTopicSuggestions([
    record({ id: "uma", referencedWorks: ["賽馬娘 / ウマ娘"] }),
    record({ id: "mihoyo", referencedWorks: ["米哈遊"] }),
  ]);
  assert.deepEqual(findWorkTopicSuggestions(suggestions, "賽").map((item) => item.value), ["賽馬娘 Pretty Derby"]);
  assert.deepEqual(findWorkTopicSuggestions(suggestions, "ウマ娘").map((item) => item.value), ["賽馬娘 Pretty Derby"]);
  assert.deepEqual(findWorkTopicSuggestions(suggestions, "米").map((item) => item.value), ["米哈遊"]);
});

test("short source topics are not fuzzily rewritten as reviewed aliases", () => {
  const suggestions = buildWorkTopicSuggestions([record({ id: "rice", referencedWorks: ["米"] })]);
  assert.deepEqual(suggestions.map((item) => item.value), ["米"]);
});

test("multiple work topics combine as any or all", () => {
  const both = record({ work: "原神短篇集", referencedWorks: ["原神", "蔚藍檔案"] });
  const onlyGenshin = record({ work: "原神短篇集", referencedWorks: ["原神"] });
  const anyOf = { ...all, workTopics: ["原神", "蔚藍檔案"] };
  const allOf = { ...anyOf, workTopicMode: "all" };
  assert.equal(matchesAdvancedCircleSearch(both, anyOf), true);
  assert.equal(matchesAdvancedCircleSearch(onlyGenshin, anyOf), true);
  assert.equal(matchesAdvancedCircleSearch(both, allOf), true);
  assert.equal(matchesAdvancedCircleSearch(onlyGenshin, allOf), false);
});

test("an excluded topic removes a circle the included topics would have kept", () => {
  const both = record({ work: "原神短篇集", referencedWorks: ["原神", "蔚藍檔案"] });
  const onlyGenshin = record({ work: "原神短篇集", referencedWorks: ["原神"] });
  const search = { ...all, workTopics: ["原神"], excludedWorkTopics: ["蔚藍檔案"] };
  assert.equal(matchesAdvancedCircleSearch(both, search), false);
  assert.equal(matchesAdvancedCircleSearch(onlyGenshin, search), true);
});

test("exclusion follows the same reviewed aliases as inclusion", () => {
  const umaMusume = record({ work: "賽馬娘", referencedWorks: ["賽馬娘"] });
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, excludedWorkTopics: ["ウマ娘"] }), false);
});

test("topic lists drop blanks and collapse alias spellings of one work", () => {
  assert.deepEqual(normalizeWorkTopics(["原神", "  ", "原神", ""]), ["原神"]);
  assert.deepEqual(normalizeWorkTopics(["賽馬娘", "賽 馬 娘"]), ["賽馬娘"]);
});

test("each applied topic counts as one condition", () => {
  assert.equal(advancedCircleSearchCount(all), 0);
  assert.equal(advancedCircleSearchCount({ ...all, workTopics: ["原神", "蔚藍檔案"], excludedWorkTopics: ["米哈遊"] }), 3);
  assert.equal(advancedCircleSearchCount({ ...all, workTopics: ["原神", "原神"] }), 1);
});

test("match reasons name the field the keyword hit, not just that it hit", () => {
  const byWork = { ...record(), code: "A01", name: "社團甲", genre: "全部", note: "" };
  const byBlurb = { ...record({ work: "自創本", referencedWorks: [] }), code: "A02", name: "社團乙", genre: "全部", note: "偶爾畫原神" };
  assert.deepEqual(describeCircleMatch(byWork, { query: "原神", search: all }).map((reason) => reason.label), ["關鍵字命中作品"]);
  assert.deepEqual(describeCircleMatch(byBlurb, { query: "原神", search: all }).map((reason) => reason.label), ["關鍵字命中介紹"]);
});

test("match reasons list every applied topic the circle actually carries", () => {
  const both = { ...record({ work: "原神短篇集", referencedWorks: ["原神", "蔚藍檔案"] }), code: "A03", name: "社團丙", genre: "全部", note: "" };
  const reasons = describeCircleMatch(both, {
    query: "",
    search: { ...all, creatorType: "Vtuber", workTopics: ["原神", "蔚藍檔案", "米哈遊"] },
  });
  assert.deepEqual(reasons.map((reason) => reason.label), ["作品：原神", "作品：蔚藍檔案", "創作者：Vtuber"]);
});

