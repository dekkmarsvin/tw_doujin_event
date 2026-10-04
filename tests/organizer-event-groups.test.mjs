import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { groupOrganizerEvents, latestOrganizerEdition } = await vite.environments.ssr.runner.import("/app/organizer-event-groups.ts");
const { groupAdminEvents, candidateCalendar, activityTime, candidateHref, editionStandings } = await vite.environments.ssr.runner.import("/app/admin/admin-event-groups.ts");
after(() => vite.close());
const event = (id, eventId, edition, createdAt, updatedAt = createdAt) => ({ id, eventId, edition, createdAt, updatedAt, tentativeName: id, version: 20, role: "owner", status: "draft", workspaceMode: "binder" });
test("groups by event identity, picks newest edition rather than last edited candidate", () => {
  const events = [event("initial", "a", 1, 1, 100), event("amend", "a", 2, 2, 2), event("other", "b", 1, 3)];
  const groups = groupOrganizerEvents(events);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].editions.map(e => e.id), ["amend", "initial"]);
  assert.equal(latestOrganizerEdition(events, "initial"), "amend");
  assert.equal(latestOrganizerEdition(events), "amend");
  assert.equal(latestOrganizerEdition(events, "missing"), null);
});
test("unnamed event identities never merge by matching tentative names", () => {
  const events = [event("first", null, 1, 1), { ...event("second", null, 1, 2), tentativeName: "first" }];
  assert.equal(groupOrganizerEvents(events).length, 2);
  assert.deepEqual(events.map(e => e.id), ["first", "second"]);
});

test("Admin index preserves public dates beside exact workspace editions and published-only activities", () => {
  const published = id => ({ id, name: "同名活動", dateRangeLabel: "舊日期", eventEndsAt: "2026-09-02T23:59:59+08:00",
    days: [{ dateLabel: "2026-09-01" }, { dateLabel: "2026-09-02" }] });
  const amend = { ...event("amend-old", "a", 2, 2), status: "failed", dateRange: { start: "2026-11-01", end: "2026-11-03" } };
  const newer = { ...event("amend-new", "a", 3, 3), status: "draft", dateRange: null };
  const unlinked = { ...event("unlinked", null, 1, 4), tentativeName: "同名活動", dateRange: null };
  const groups = groupAdminEvents([event("initial", "a", 1, 1), amend, newer, unlinked], [published("a"), published("b")], "2026-10-04");
  assert.equal(groups.length, 3, "amendments share identity, matching names do not");
  const known = groups.find(group => group.eventId === "a");
  assert.deepEqual(known.editions.map(candidate => [candidate.id, candidate.edition]), [["amend-new", 3], ["amend-old", 2], ["initial", 1]]);
  assert.equal(known.calendar.label, "2026.09.01–02", "an unpublished date correction cannot replace public dates");
  assert.equal(activityTime(known.calendar, "2026-10-04"), "已結束");
  assert.ok(known.published, "an ended activity remains public even with a failed amendment");
  assert.equal(candidateCalendar(amend).start, "2026-11-01");
  assert.equal(candidateCalendar(unlinked).label, "日期未定");
  assert.equal(groups.find(group => group.eventId === "b").editions.length, 0);
  assert.equal(candidateHref(amend.id, true), "/organizer?candidate=amend-old&section=review", "a selected older edition is not rewritten to the newest one");
  assert.equal(candidateHref(amend.id), "/organizer?candidate=amend-old");
});

test("Admin index marks only the newest published edition of a public activity as served", () => {
  const editions = [{ ...event("draft", "a", 4, 4), status: "draft" }, { ...event("served", "a", 3, 3), status: "published" },
    { ...event("abandoned", "a", 2, 2), status: "abandoned" }, { ...event("old", "a", 1, 1), status: "published" }];
  const standings = group => Object.fromEntries(editionStandings(group));
  const [publicGroup] = groupAdminEvents(editions, [{ id: "a", name: "a", eventEndsAt: "2026-12-01T23:59:59+08:00", days: [{ dateLabel: "2026-12-01" }] }], "2026-10-04");
  assert.deepEqual(standings(publicGroup), { draft: "pending", served: "live", abandoned: "earlier", old: "earlier" });
  const [unlisted] = groupAdminEvents(editions, [], "2026-10-04");
  assert.equal(standings(unlisted).served, "current", "without a public page the newest published edition is not claimed as served");
});

test("Admin activity timing uses Taipei calendar dates without inventing an empty draft date", () => {
  assert.equal(activityTime({ start: "2026-10-04", end: "2026-10-05" }, "2026-10-04"), "進行中");
  assert.equal(activityTime({ start: "2026-10-05", end: "2026-10-05" }, "2026-10-04"), "尚未開始");
  assert.equal(activityTime({ start: null, end: null }, "2026-10-04"), "日期未定");
});
