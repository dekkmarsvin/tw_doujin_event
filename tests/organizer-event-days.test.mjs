import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { nextOrganizerEventDay, organizerPendingVenueSelections, validateOrganizerEventDraft } = await environment.runner.import("/app/organizer-event.ts");
after(async () => { await vite.close(); });

// #221: the first day is a question, not an assumption. Defaulting it to
// today made an unanswered field look answered and counted the step complete
// on a date nobody had chosen.
test("the first day is left for the organizer to answer", () => {
  const now = new Date(2026, 7, 31, 23, 30);
  assert.deepEqual(nextOrganizerEventDay([], now), { id: "1", label: "第一天", date: "" });
});

test("each further day defaults to the day after the last dated day", () => {
  // The first day has to be answered before a later one can follow it, which
  // is how the organizer reads these fields anyway.
  const first = { ...nextOrganizerEventDay([], new Date(2026, 10, 7, 9, 0)), date: "2026-11-07" };
  const second = nextOrganizerEventDay([first], new Date(2026, 10, 7, 9, 0));
  const third = nextOrganizerEventDay([first, second], new Date(2026, 10, 7, 9, 0));
  assert.deepEqual([second.date, third.date], ["2026-11-08", "2026-11-09"]);
  assert.deepEqual([second.id, third.label], ["2", "第三天"]);
});

test("a month boundary rolls over instead of overflowing the day number", () => {
  const day = nextOrganizerEventDay([{ id: "1", label: "第一天", date: "2026-11-30" }], new Date(2026, 0, 1));
  assert.equal(day.date, "2026-12-01");
});

test("an undated day falls back to today and never reuses an existing day id", () => {
  const now = new Date(2026, 7, 31, 6, 0);
  const day = nextOrganizerEventDay([{ id: "1", label: "第一天", date: "" }], now);
  assert.deepEqual(day, { id: "2", label: "第二天", date: "2026-08-31" });
});

// Once the first date is answered the rest need no further editing: the
// second follows it, and nothing else about a day has to be understood.
test("only the first date is asked for; the rest of a day needs no editing", () => {
  const days = [];
  days.push({ ...nextOrganizerEventDay(days, new Date(2026, 10, 7)), date: "2026-11-07" });
  days.push(nextOrganizerEventDay(days, new Date(2026, 10, 7)));
  const draft = {
    schema: "organizer-event-draft/1",
    event: { id: "pf45-rf14", name: "PF45 x RF14", days },
    venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
  };
  assert.deepEqual(validateOrganizerEventDraft(draft).filter((issue) => issue.step === "event"), []);
});

// #222: 「新增場地」 used to choose a venue and a space on the owner's
// behalf, so 請選擇場館 was an option the list could never show as chosen and
// the event carried a space nobody had picked. A new row is now empty, which
// means an unfilled row has to name itself rather than be read as a deletion.
test("an unchosen venue row names itself and is never read as a deleted one", () => {
  const draft = (assignments) => ({
    schema: "organizer-event-draft/1",
    event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第 1 日", date: "2026-11-07" }] },
    venue: { assignments },
    officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
  });
  const blank = { venueId: "", venueSpaceId: "", areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1" };

  const pending = organizerPendingVenueSelections(draft([blank]));
  assert.deepEqual(pending.map((issue) => issue.code), ["missing_venue_selection", "missing_venue_space_selection"]);
  assert.equal(pending[0].message, "場地 1：尚未選擇場館，請從清單選擇或建立新場館。");
  assert.equal(pending[1].message, "場地 1：尚未選擇場館內的場地，請從清單選擇或新增場地。");
  // The row is named, so a second pending row is telling apart from the first.
  assert.deepEqual(organizerPendingVenueSelections(draft([{ ...blank, venueId: "expo", venueSpaceId: "hall-a" }, blank]))
    .map((issue) => issue.row), [2, 2]);

  // Two rows waiting on a choice are two pending items, not one space chosen
  // twice -- blank collides only with blank.
  assert.equal(validateOrganizerEventDraft(draft([blank, blank])).some((issue) => issue.code === "duplicate_space"), false);
  const twice = [{ ...blank, venueId: "expo", venueSpaceId: "hall-a" }, { ...blank, venueId: "expo", venueSpaceId: "hall-a" }];
  assert.equal(validateOrganizerEventDraft(draft(twice)).some((issue) => issue.code === "duplicate_space"), true);

  // A filled row raises nothing, so the pending list is empty once both
  // choices are made and saving stops being refused.
  assert.deepEqual(organizerPendingVenueSelections(draft([{ ...blank, venueId: "expo", venueSpaceId: "hall-a" }])), []);
});