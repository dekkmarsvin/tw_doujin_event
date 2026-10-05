import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const locale = await environment.runner.import("/app/i18n/locale.ts");
const browser = await environment.runner.import("/app/i18n/locale-browser.ts");
const messages = await environment.runner.import("/app/i18n/messages.ts");
const format = await environment.runner.import("/app/i18n/format.ts");
const calendar = await environment.runner.import("/app/event-calendar.ts");
const presentation = await environment.runner.import("/app/circle-presentation.ts");
const categories = await environment.runner.import("/app/circle-categories.ts");
const overrides = await environment.runner.import("/app/circle-overrides.ts");
const records = await environment.runner.import("/app/circle-records.ts");
const search = await environment.runner.import("/app/circle-search.ts");
after(() => vite.close());

test("canonical choices and browser tags have different acceptance rules", () => {
  for (const [tag, expected] of [["zh", "zh-Hant"], ["zh-TW", "zh-Hant"], ["zh-HK", "zh-Hant"], ["zh-MO", "zh-Hant"], ["zh-Hant-TW", "zh-Hant"], ["zh-CN", null], ["zh-SG", null], ["zh-Hans-TW", null], ["en-US", "en"], ["JA-jp", "ja"], ["fr", null]]) assert.equal(locale.matchLanguageTag(tag), expected, tag);
  assert.equal(locale.canonicalLocale("EN"), "en");
  assert.equal(locale.canonicalLocale("zh-hant"), "zh-Hant");
  for (const value of ["EN", "en-US", null, 1]) assert.equal(locale.isLocale(value), false);
});

test("resolution gives URL then explicit storage then supported browser language priority", () => {
  assert.equal(locale.resolveLocale({ url: "ja", stored: "en", browser: ["zh-TW"] }), "ja");
  assert.equal(locale.resolveLocale({ url: locale.localeFromUrl("/?lang=fr"), stored: "en", browser: ["ja"] }), "en");
  assert.equal(locale.resolveLocale({ browser: ["zh-CN", "fr", "ja-JP", "en"] }), "ja");
  assert.equal(locale.resolveLocale({ url: "fr", stored: "EN", browser: [] }), "zh-Hant");
  assert.equal(locale.localeFromUrl(new URL("https://example.test/?lang=EN")), "en");
  assert.equal(locale.localeFromUrl("/?lang=en-US"), null);
});

test("language links keep URL shape, other parameter bytes and hashes", () => {
  for (const [href, chosen, expected] of [
    ["?event=x", "en", "?event=x&lang=en"], ["/events/a/", "ja", "/events/a/?lang=ja"],
    ["https://example.test/?event=x&lang=en&day=2#booth", "zh-Hant", "https://example.test/?event=x&day=2#booth"],
    ["?q=a%20b&lang=en&circle=c&lang=ja#x", "ja", "?q=a%20b&lang=ja&circle=c#x"],
    ["../circle?event=x#y", "en", "../circle?event=x&lang=en#y"], ["#panel", "ja", "?lang=ja#panel"],
    ["?lang=ja#x", "zh-Hant", "#x"], ["/events/a/?q=a+b&q=c%2Fd#x", "zh-Hant", "/events/a/?q=a+b&q=c%2Fd#x"],
  ]) assert.equal(locale.localizedHref(href, chosen), expected);
  assert.equal(browser.switchLocaleUrl("https://example.test/?event=x#panel", "ja"), "https://example.test/?event=x&lang=ja#panel");
});

test("browser storage failures do not block language selection or persist incoming links", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(browser.readStoredLocale(throwing), null);
  assert.equal(browser.storeLocale("en", throwing), false);
  assert.equal(browser.initialLocale("/?lang=ja", throwing, { languages: ["en-US"] }), "ja");
  const writes = [];
  const storage = { getItem: key => key === "ui-locale" ? "en" : null, setItem: (...args) => writes.push(args) };
  assert.equal(browser.initialLocale("/?lang=ja", storage, null), "ja");
  assert.deepEqual(writes, []);
  assert.equal(browser.storeLocale("zh-Hant", storage), true);
  assert.deepEqual(writes, [["ui-locale", "zh-Hant"]]);
  assert.deepEqual(browser.browserLanguages({ languages: [], language: "ja" }), ["ja"]);
  assert.deepEqual(browser.browserLanguages(null), []);
  assert.equal(browser.readStoredLocale(null), null);
  assert.equal(browser.storeLocale("ja", null), false);
  assert.equal(browser.readStoredLocale({ getItem: () => "EN" }), null);
});

test("message catalogs support fallback, interpolation and locale-aware functions", () => {
  const catalog = messages.defineMessages({ "zh-Hant": { greeting: "你好 {name} {missing}", count: "{count} 個" }, en: { count: (params, chosen) => `${params.count} ${chosen}:${params.count === 1 ? "item" : "items"}` }, ja: {} });
  assert.equal(messages.translate(catalog, "en", "greeting", { name: "A" }), "你好 A {missing}");
  assert.equal(messages.translate(catalog, "en", "count", { count: 1 }), "1 en:item");
  assert.equal(messages.translate(catalog, "en", "count", { count: 2 }), "2 en:items");
  assert.deepEqual(messages.missingMessageKeys(catalog, "en"), ["greeting"]);
  assert.deepEqual(messages.missingMessageKeys(catalog, "zh-Hant"), []);
  assert.deepEqual(messages.missingMessageKeys({ ...catalog, ja: { greeting: "", count: undefined } }, "ja"), ["count"]);
});

test("money preserves Reader's NT$ prefix and grouping without conversion", () => {
  for (const chosen of locale.LOCALES) {
    assert.equal(format.formatCount(12345, chosen), new Intl.NumberFormat(chosen).format(12345));
    assert.equal(format.formatTwd(12345.67, chosen), `NT$ ${new Intl.NumberFormat(chosen).format(12345.67)}`);
  }
  assert.equal(format.formatTwd(12345.67, "zh-Hant"), `NT$ ${new Intl.NumberFormat("zh-TW").format(12345.67)}`);
});

test("calendar formatting is localized while Taipei boundaries and ordering stay unchanged", () => {
  const event = { id: "sample", days: [{ dateLabel: "2026-11-07" }], eventEndsAt: "2026-11-07T23:59:59+08:00", dateRangeLabel: "original" };
  const baseline = calendar.eventsByProximity([event], "2026-11-06");
  for (const chosen of locale.LOCALES) {
    assert.equal(calendar.shortDate("2026-11-07", chosen), "11/7");
    const entry = calendar.eventsByProximity([event], "2026-11-06", chosen)[0];
    assert.deepEqual([entry.start, entry.end, entry.group], [baseline[0].start, baseline[0].end, baseline[0].group]);
    assert.equal(calendar.groupCalendarEvents([event], "2026-11-06", chosen)[0].label, calendar.eventGroupLabel("upcoming", chosen));
    assert.equal(calendar.eventCalendar(event, chosen).label, entry.label);
  }
  assert.equal(calendar.dayDateLabel("2026-11-07"), "11月7日（六）");
  assert.equal(calendar.dayDateLabel("2026-11-07", "en"), "Sat, Nov 7");
  assert.equal(calendar.dayDateLabel("2026-11-07", "ja"), "11月7日(土)");
  assert.equal(calendar.fullDateRange("2026-08-21", "2026-08-23"), "2026年8月21日至23日");
  const english = new Intl.DateTimeFormat("en", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
  assert.equal(calendar.fullDateRange("2026-08-21", "2026-08-23", "en"), english.formatRange(new Date("2026-08-21T00:00:00Z"), new Date("2026-08-23T00:00:00Z")));
  assert.equal(calendar.fullDateRange("2026-08-21", undefined, "en"), "Aug 21, 2026");
  // Written by hand: browser ICU renders the long Japanese range as 2026/08/21～2026/08/23.
  assert.equal(calendar.fullDateRange("2026-08-21", "2026-08-23", "ja"), "2026年8月21日～23日");
  assert.equal(calendar.fullDateRange("2026-08-30", "2026-09-01", "ja"), "2026年8月30日～9月1日");
  for (const chosen of ["en", "ja"]) assert.notEqual(calendar.eventGroupLabel("past", chosen), calendar.eventGroupLabel("past"));
  assert.equal(calendar.taipeiDate(Date.parse("2026-11-06T16:00:00Z")), "2026-11-07");
});

test("fixed circle labels translate without changing official category values", () => {
  for (const key of Object.keys(presentation.LINK_KIND_LABEL)) {
    assert.equal(presentation.linkKindLabel(key), presentation.LINK_KIND_LABEL[key]);
    for (const chosen of ["en", "ja"]) assert.ok(presentation.linkKindLabel(key, chosen).length);
  }
  const source = { contentType: "circle", fetchedAt: "2026-09-23T00:00:00Z" };
  assert.equal(presentation.sourceDateLabel(source), "最後更新 2026.09.23");
  assert.equal(presentation.sourceDateLabel(source, "en"), "Updated 2026.09.23");
  assert.equal(presentation.sourceDateLabel({ ...source, contentType: "official" }, "ja"), "取込 2026.09.23");
  assert.equal(presentation.sourceDateLabel({ ...source, fetchedAt: "" }), "最後更新 時間不明");
  assert.equal(presentation.sourceDateLabel({ ...source, fetchedAt: "" }, "en"), "Date unknown");
  assert.equal(presentation.sourceDateLabel({ ...source, fetchedAt: "" }, "ja"), "日付不明");
  const catalog = { categories: [{ id: "official", label: "原始分類", description: "" }] };
  assert.deepEqual(categories.circleCategoryLabels(catalog), ["全部類別", "原始分類"]);
  assert.equal(categories.allCircleCategoriesLabel("en"), "All categories");
  assert.equal(categories.allCircleCategoriesLabel("ja"), "すべてのカテゴリ");
  assert.equal(categories.findCircleCategory(catalog, "原始分類").id, "official");
  for (const value of [...overrides.CREATOR_TYPE_OPTIONS, ...overrides.WORK_TYPE_OPTIONS, ...overrides.AGE_RATING_OPTIONS]) {
    assert.equal(overrides.circleOptionLabel(value), value);
    for (const chosen of ["en", "ja"]) assert.ok(overrides.circleOptionLabel(value, chosen), value);
  }
  assert.equal(overrides.circleOptionLabel("繪師", "en"), "Illustrator");
  assert.equal(overrides.circleOptionLabel("舊選項", "ja"), "舊選項", "an old or self-written value stays as written");
  assert.equal(records.placementStatusLabel("active", "en"), "");
  assert.equal(records.placementStatusLabel("moved"), "已移動攤位");
  assert.equal(records.placementStatusLabel("cancelled", "ja"), "参加取り消し");
  assert.equal(search.ageRatingFilterLabel("R18"), "只看 R18");
  assert.equal(search.ageRatingFilterLabel("R18", "en"), "R18 only");
});

test("calendar labels do not depend on the host time zone", () => {
  const previous = process.env.TZ;
  try {
    const labels = zone => {
      process.env.TZ = zone;
      return locale.LOCALES.flatMap(chosen => [calendar.shortDate("2026-11-07", chosen), calendar.dayDateLabel("2026-11-07", chosen), calendar.fullDateRange("2026-08-21", "2026-08-23", chosen)]);
    };
    assert.deepEqual(labels("Pacific/Honolulu"), labels("Asia/Tokyo"));
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("pure i18n modules have no browser-global dependency", async () => {
  for (const name of ["locale", "messages", "format", "api-error", "api-contract"]) {
    assert.doesNotMatch(await readFile(`app/i18n/${name}.ts`, "utf8"), /\b(?:window|document)\b/, name);
  }
});
