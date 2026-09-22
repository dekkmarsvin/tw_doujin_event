import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { default: EventChooser } = await environment.runner.import("/app/event-chooser.tsx");
const { eventCalendar, groupCalendarEvents, taipeiDate } = await environment.runner.import("/app/event-calendar.ts");
after(() => vite.close());

const events = [
  { id: "event-a", name: "第一場活動", venue: "北部展館", dateRangeLabel: "2026-11-07 – 08", eventEndsAt: "2026-11-08T23:59:59+08:00", days: [{ dateLabel: "11月7日" }, { dateLabel: "11月8日" }] },
  { id: "event-b", name: "第二場活動", venue: "南部展館", dateRangeLabel: "2027-02-14", eventEndsAt: "2027-02-14T23:59:59+08:00", days: [{ dateLabel: "2027-02-14" }] },
];

const render = (properties) => renderToStaticMarkup(
  React.createElement(EventChooser, { events, onSelect: () => undefined, ...properties }),
);

test("every published event is offered with what a reader needs to tell them apart", () => {
  const html = render({});
  for (const event of events) {
    assert.match(html, new RegExp(event.name), `${event.id} must be offered`);
    assert.match(html, new RegExp(event.venue), `${event.id} must show where it is`);
  }
  assert.ok(html.includes("26.11.07-08"));
  assert.ok(html.includes("27.02.14"));
  assert.equal(html.match(/<a\b[^>]*href=/g).length, events.length * 2, "each event offers its map and static introduction");
  // Entries are addressable without running the bundle: the markup alone has to
  // name where each event lives, or nothing off-site can reach one.
  for (const event of events) assert.ok(html.includes(`href="?event=${event.id}"`), `${event.id} must be linked, not just pressable`);
});

test("a link to an event this build does not serve says so instead of opening another one", () => {
  const html = render({ unresolved: "event-c" });
  assert.match(html, /目前無法開啟/);
  // Status, not colour: the reason has to survive a reader who cannot see the
  // amber panel at all.
  assert.match(html, /role="status"/);
  // Naming the missing event would invite reading it as a real event.
  assert.doesNotMatch(html, /event-c/);
  // The way forward is still the list.
  assert.equal(html.match(/<a\b[^>]*href=/g).length, events.length * 2);
});

test("nothing is offered that was not published", () => {
  const html = render({});
  assert.doesNotMatch(html, /event-c|sample-two/);
});

const dated = (id, dates, end = dates.at(-1)) => ({ ...events[0], id, days: dates.map((dateLabel) => ({ dateLabel })), eventEndsAt: `${end}T23:59:59+08:00` });

test("calendar labels cover single days, month/year changes and legacy dates", () => {
  for (const [dates, end, expected] of [
    [["2026-10-09"], "2026-10-09", "26.10.09"],
    [["8月21日・五", "8月23日・日"], "2026-08-23", "26.08.21-23"],
    [["2026-09-02", "2026-08-30"], "2026-09-02", "26.08.30-09.02"],
    [["2026-12-31", "2027-01-02"], "2027-01-02", "26.12.31-27.01.02"],
    [["12月31日", "1月2日"], "2027-01-02", "26.12.31-27.01.02"],
    [["2月29日"], "2028-02-29", "28.02.29"],
  ]) assert.equal(eventCalendar(dated("test", dates, end)).label, expected);
});

test("lifecycle groups and descending start dates are independent of publication order", () => {
  const source = [dated("old", ["2025-09-01"]), events[0], dated("ongoing", ["2026-09-14", "2026-09-16"]), events[1], dated("recent", ["2026-09-13"])];
  const ids = source.map((event) => event.id);
  const groups = groupCalendarEvents(source, "2026-09-15");
  assert.deepEqual(groups.map((group) => [group.id, group.entries.map((entry) => entry.event.id)]), [
    ["upcoming", ["event-b", "event-a"]], ["ongoing", ["ongoing"]], ["past", ["recent", "old"]],
  ]);
  assert.deepEqual(source.map((event) => event.id), ids, "source collection is unchanged");
});

test("Taiwan calendar boundaries include first/last days and nights between event days", () => {
  const event = dated("three-days", ["2026-09-15", "2026-09-17"]);
  for (const [instant, expected] of [
    ["2026-09-14T15:59:59Z", "upcoming"], ["2026-09-14T16:00:00Z", "ongoing"],
    ["2026-09-15T18:00:00Z", "ongoing"], ["2026-09-17T15:59:59Z", "ongoing"],
    ["2026-09-17T16:00:00Z", "past"],
  ]) assert.equal(groupCalendarEvents([event], taipeiDate(Date.parse(instant)))[0].id, expected);
});

test("unreadable dates remain available without invented dates or lifecycle claims", () => {
  for (const label of ["開幕日", "2026-02-30", "2月30日"]) {
    const event = dated("unknown", [label], "2026-11-08");
    assert.equal(eventCalendar(event).label, event.dateRangeLabel);
    assert.equal(groupCalendarEvents([event], "2026-09-15")[0].id, "undated");
    assert.equal(groupCalendarEvents([event], "2026-11-09")[0].id, "past");
  }
});

test("an empty published collection has a readable empty state and no empty groups", () => {
  const html = render({ events: [] });
  assert.match(html, /目前沒有公開活動/);
  assert.doesNotMatch(html, /<a href|data-event-group/);
});
