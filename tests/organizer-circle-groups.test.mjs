import assert from "node:assert/strict";
import test from "node:test";
import { buildOrganizerCircleGrouping, groupOrganizerCircles } from "../app/organizer-circle-groups.mjs";
import { planCircleIdentityRegistryUpdate } from "../app/circle-identity-registry.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";

const row = (dayId, circleName, codes, stableKey = null) => ({ dayId, circleName, codes, stableKey });

test("reviewed cross-day names share one identity across changed booths and multiple rows per day", () => {
  const rows = [row("fri", " Ａ社 ", ["A01", "A02"]), row("sat", "A社", ["B07"]),
    row("fri", "Ａ社", ["C10"]), row("sat", "單日社團", ["A01"])];
  const before = structuredClone(rows);
  const groups = groupOrganizerCircles(rows);
  assert.deepEqual(groups.map(group => group.rowIndexes), [[0, 1, 2], [3]]);
  const grouping = buildOrganizerCircleGrouping("test-event", rows, "https://organizer.example/accepted");
  assert.equal(grouping.groups[0].linkage.kind, "manual-organizer-evidence");
  assert.deepEqual(grouping.groups[0].sources, ["fri:A01", "fri:A02", "sat:B07", "fri:C10"]);
  const official = { schemaVersion: 1, days: ["fri", "sat"].map(day => ({ day,
    booths: rows.filter(row => row.dayId === day).map(row => ({ codes: row.codes, name: row.circleName })) })) };
  const input = { eventId: "test-event", official, grouping,
    allocations: { schema: "circle-id-allocations/1", nextSequence: 1, allocations: [] },
    evidence: { schema: "circle-identity-evidence/1", entries: [] }, today: () => "2026-09-27" };
  const result = planCircleIdentityRegistryUpdate(input);
  assert.equal(result.summary.newAllocationCount, 2);
  assert.equal(planCircleIdentityRegistryUpdate({ ...input, ...result }).summary.changed, false);
  const catalog = buildOfficialCatalogPayload({ eventId: "test-event", official, evidence: result.evidence,
    event: { days: [{ id: "fri" }, { id: "sat" }], areas: [{ id: "ALL" }], dataUpdatedAt: "2026-09-27" } });
  assert.equal(catalog.circles.length, 2);
  assert.equal(catalog.placements.length, 5);
  assert.equal(new Set(catalog.placements.filter(p => p.boothCode !== "A01" || p.day !== "sat").map(p => p.circleId)).size, 1);
  assert.deepEqual(rows, before);
});

test("internal identifiers override names and partial identifiers never acquire inferred members", () => {
  const rows = [row("1", "同名", ["A01"], "one"), row("2", "同名", ["B01"], "two"),
    row("3", "同名", ["C01"]), row("4", "同名", ["D01"]), row("2", "同名", ["B02"], "one")];
  assert.deepEqual(groupOrganizerCircles(rows).map(g => g.rowIndexes), [[0, 4], [1], [2], [3]]);
  assert.equal(buildOrganizerCircleGrouping("event-a", rows, "https://example.test").groups[0].linkage.kind, "organizer-stable-key");
});

test("single-day names, similar names and another event do not create cross-day identity", () => {
  assert.equal(groupOrganizerCircles([row("1", "同名", ["A01"]), row("1", "同名", ["A02"])]).length, 2);
  assert.equal(groupOrganizerCircles([row("1", "同名", ["A01"]), row("2", "同名社", ["A01"])]).length, 2);
  const rows = [row("1", "同名", ["A01"]), row("2", "同名", ["A01"])];
  assert.equal(groupOrganizerCircles(rows, { mergeCrossDayNames: false }).length, 2);
  assert.equal(buildOrganizerCircleGrouping("event-b", [rows[0]], "https://example.test").groups.length, 1);
});
