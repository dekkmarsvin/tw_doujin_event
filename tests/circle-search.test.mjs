import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { buildWorkTopicSuggestions, circleIncludesGeneral, circleIncludesR18, findWorkTopicSuggestions, matchesAdvancedCircleSearch } = await environment.runner.import("/app/circle-search.ts");
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
      ...overrides,
    },
  };
}

const all = { creatorType: "ALL", workQuery: "", workType: "ALL", adultContent: "ALL" };

test("advanced circle search combines creator, work name, and work type", () => {
  const candidate = record();
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, creatorType: "Vtuber", workQuery: "原神", workType: "二創" }), true);
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, creatorType: "Coser" }), false);
  assert.equal(matchesAdvancedCircleSearch(candidate, { ...all, workQuery: "蔚藍檔案" }), false);
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
  assert.equal(matchesAdvancedCircleSearch(record({ creatorTypes: ["ＶＴＵＢＥＲ"], work: "ＢＬＵＥ ＡＲＣＨＩＶＥ", referencedWorks: [] }), { ...all, creatorType: "Vtuber", workQuery: "blue archive" }), true);
});

test("work-topic aliases match the same title across languages", () => {
  const umaMusume = record({ work: "賽馬娘", referencedWorks: ["賽馬娘"] });
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workQuery: "ウマ娘" }), true);
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workQuery: "ウマ娘Pretty Derby" }), true);
  assert.equal(matchesAdvancedCircleSearch(umaMusume, { ...all, workQuery: "Uma Musume Pretty Derby" }), true);
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
