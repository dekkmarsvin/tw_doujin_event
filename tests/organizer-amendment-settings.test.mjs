import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { AmendmentSettingsError, amendmentSettingsImpact, applyAmendmentSettings, approvedEventDraft, normalizeAmendmentSettings } = await environment.runner.import("/app/organizer-amendment-settings.ts");
const { parseOrganizerEventDraft } = await environment.runner.import("/app/organizer-event.ts");
const { eventDateFields } = await environment.runner.import("/app/event-calendar.ts");
after(async () => { await vite.close(); });

const baseline = parseOrganizerEventDraft({
  schema: "organizer-event-draft/1",
  event: { id: "event-alpha", name: "測試活動", aliases: ["TA"], days: [
    { id: "1", label: "第一天", date: "2026-11-07" }, { id: "2", label: "第二天", date: "2026-11-08" }] },
  venue: { assignments: [{ venueId: "hall", venueSpaceId: "hall-all", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported" }] },
  officialSource: { label: "主辦名單", url: "https://organizer.example/event" },
});
const rejects = (input, pattern) => assert.throws(() => normalizeAmendmentSettings(baseline, input),
  (error) => error instanceof AmendmentSettingsError && pattern.test(error.message), JSON.stringify(input));

test("an absent or unchanged declaration is stored as none", () => {
  assert.equal(normalizeAmendmentSettings(baseline, undefined), null);
  assert.equal(normalizeAmendmentSettings(baseline, null), null);
  assert.equal(normalizeAmendmentSettings(baseline, { name: " 測試活動 ", aliases: ["TA", ""],
    days: [{ id: "1", date: "2026-11-07" }, { id: "2", date: "2026-11-08" }] }), null);
});

test("only changed values are kept, in one canonical form", () => {
  assert.deepEqual(normalizeAmendmentSettings(baseline, {
    days: [{ id: "2", date: "2026-11-15" }, { id: "1", date: "2026-11-07" }], aliases: ["ＴＡ ", "測試"], name: "新名稱",
  }), { name: "新名稱", aliases: ["TA", "測試"], days: [{ id: "2", date: "2026-11-15" }] });
  assert.deepEqual(normalizeAmendmentSettings(baseline, { aliases: [] }), { aliases: [] }, "removing every alias is a declaration");
});

test("anything outside the allow-list, or that a first publication would refuse, is rejected", () => {
  rejects({ mapTemplate: "OTHER" }, /只能更正活動名稱/);
  rejects({ days: [{ id: "3", date: "2026-11-09" }] }, /不能新增或刪除活動日/);
  rejects({ days: [{ id: "1", date: "2026-11-07" }, { id: "1", date: "2026-11-08" }] }, /不能新增或刪除活動日/);
  rejects({ days: [{ id: "1", label: "改名", date: "2026-11-07" }] }, /只接受活動日代號與日期/);
  rejects({ days: [{ id: "1", date: "2026/11/07" }] }, /活動日需要/);
  rejects({ name: "" }, /活動名稱為必填/);
  rejects({ aliases: ["測試活動"] }, /重複/);
  rejects({ aliases: "TA" }, /文字清單/);
  rejects(["name"], /只能更正活動名稱/);
});

test("a declaration whose corrected draft a first save would refuse as too large is 413", () => {
  assert.throws(() => normalizeAmendmentSettings(baseline, { name: "名".repeat(400_000) }),
    (error) => error instanceof AmendmentSettingsError && error.status === 413 && /超過 1 MB/.test(error.message));
  assert.throws(() => normalizeAmendmentSettings(baseline, { name: "" }), (error) => error.status === 422);
});

test("applying a declaration yields the draft a first save would have produced", () => {
  const settings = normalizeAmendmentSettings(baseline, { name: "新名稱", aliases: [], days: [{ id: "2", date: "2026-11-15" }] });
  const draft = applyAmendmentSettings(baseline, settings);
  assert.equal(draft.event.name, "新名稱");
  assert.equal(Object.hasOwn(draft.event, "aliases"), false);
  assert.deepEqual(draft.event.days.map((day) => [day.id, day.label, day.date]), [["1", "第一天", "2026-11-07"], ["2", "第二天", "2026-11-15"]]);
  assert.deepEqual(draft.venue, baseline.venue);
  assert.equal(applyAmendmentSettings(baseline, null), baseline);
  assert.deepEqual(eventDateFields(draft.event.days.map((day) => day.date).sort()),
    { dateRangeLabel: "2026-11-07–2026-11-15", eventEndsAt: "2026-11-15T23:59:59+08:00" });
});

test("impact names each field with its before and after values", () => {
  const settings = normalizeAmendmentSettings(baseline, { name: "新名稱", aliases: ["TA", "測試"], days: [{ id: "2", date: "2026-11-15" }] });
  assert.deepEqual(amendmentSettingsImpact(baseline, settings), [
    { field: "name", before: "測試活動", after: "新名稱" },
    { field: "aliases", before: ["TA"], after: ["TA", "測試"] },
    { field: "day", dayId: "2", label: "第二天", before: "2026-11-08", after: "2026-11-15" },
  ]);
  assert.deepEqual(amendmentSettingsImpact(baseline, null), []);
});

test("an approved snapshot's published draft includes its declared settings", () => {
  const settings = { days: [{ id: "2", date: "2026-11-15" }] };
  assert.equal(approvedEventDraft({ draft: baseline, amendment: { settings } }).event.days[1].date, "2026-11-15");
  assert.equal(approvedEventDraft({ draft: baseline }).event.days[1].date, "2026-11-08");
  assert.equal(approvedEventDraft({}), null);
});
