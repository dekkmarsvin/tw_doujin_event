import assert from "node:assert/strict";
import test from "node:test";
import { planOrganizerAmendment } from "../app/organizer-amendment.mjs";
import { planCircleIdentityRegistryUpdate } from "../app/circle-identity-registry.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";

const event = {
  id: "event-alpha", dataUpdatedAt: "2026-09-15T00:00:00.000Z",
  days: [{ id: 1 }, { id: 2 }], areas: [{ id: "A" }, { id: "B" }],
  officialData: { boothListUrls: { 1: "https://organizer.invalid/day-1", 2: "https://organizer.invalid/day-2" } },
};
const at = () => "2026-09-15";
const to = (code, dayId = "1", areaId = "B") => ({ dayId, code, areaId });
const otherEvent = {
  circleId: "c-000001", currentName: "既有活動社团", aliases: [],
  sources: [{ eventId: "ff47", kind: "organizer-booth", value: "1:A01" }],
};
function baseline() {
  const official = { schemaVersion: 1, days: [
    { day: 1, url: event.officialData.boothListUrls[1], booths: [
      { codes: ["A01", "A02"], name: "甲社", areaId: "A" },
      { codes: ["B01"], name: "乙社", areaId: "B" },
    ] },
    { day: 2, url: event.officialData.boothListUrls[2], booths: [
      { codes: ["A01"], name: "甲社", areaId: "A" },
      { codes: ["B01"], name: "另一個乙社", areaId: "B" },
    ] },
  ] };
  const grouping = { schema: "circle-identity-groups/1", eventId: event.id, groups: [
    { sources: ["1:A01", "1:A02", "2:A01"], linkage: {
      kind: "organizer-stable-key", value: "application:42", reference: "https://organizer.invalid/application/42",
    } },
    { sources: ["1:B01"] }, { sources: ["2:B01"] },
  ] };
  const registry = planCircleIdentityRegistryUpdate({ eventId: event.id, official, grouping,
    allocations: { schema: "circle-id-allocations/1", nextSequence: 2,
      allocations: [{ id: "c-000001", allocatedAt: at(), reason: "fixture" }] },
    evidence: { schema: "circle-identity-evidence/1", entries: [otherEvent] }, today: at });
  return { event, official, grouping, allocations: registry.allocations, evidence: registry.evidence };
}
const amend = (changes, input = baseline()) => planOrganizerAmendment({ ...input, changes, today: at });
const catalog = (result) => buildOfficialCatalogPayload({ eventId: event.id, event, ...result });
const active = (result, circleId) => catalog(result).placements.filter((placement) => placement.circleId === circleId && placement.status === "active");

test("an empty declaration list preserves every booth, identity and other event", () => {
  const input = baseline();
  const before = structuredClone(input);
  const result = amend([], input);
  assert.deepEqual(result.official, input.official);
  assert.deepEqual(result.evidence, input.evidence);
  assert.deepEqual(result.allocations, input.allocations);
  assert.deepEqual(result.impact, []);
  assert.equal(result.summary.changed, false);
  assert.deepEqual(input, before);
});

test("withdrawal preserves the old circle for saved URLs and only retires selected booths", () => {
  const result = amend([{ kind: "withdrawn", sources: ["1:A01", "1:A02", "2:A01"] }]);
  const reader = catalog(result);
  assert.deepEqual(result.impact[0].before.map((placement) => placement.circleId), ["c-000002", "c-000002", "c-000002"]);
  assert.deepEqual(result.impact[0].after, []);
  assert.deepEqual(reader.circles.find((circle) => circle.id === "c-000002"), { id: "c-000002", name: "甲社" });
  assert.equal(reader.placements.filter((placement) => placement.status === "cancelled").length, 3);
  assert.deepEqual(active(result, "c-000003").map((placement) => placement.boothCode), ["B01"]);
  assert.deepEqual(result.evidence.entries[0], otherEvent);
  assert.equal(result.summary.newAllocationCount, 0);
});

test("partial handover creates one new circle across selected booths and leaves old favorites intact", () => {
  const result = amend([{ kind: "released", sources: ["1:A01", "2:A01"], circleName: "丙社" }]);
  assert.equal(result.summary.newAllocationCount, 1);
  assert.deepEqual(result.impact[0].after.map((placement) => placement.circleId), ["c-000005", "c-000005"]);
  assert.deepEqual(active(result, "c-000002").map((placement) => placement.boothCode), ["A02"]);
  const reader = catalog(result);
  assert.equal(reader.placements.find((placement) => placement.id === "1-a01").circleId, "c-000005");
  assert.equal(reader.placements.find((placement) => placement.id === "1-a01-c-000002").status, "cancelled");
  assert.deepEqual(reader.circles.find((circle) => circle.id === "c-000002"), { id: "c-000002", name: "甲社" });
  assert.deepEqual(result.evidence.entries[0], otherEvent);
});

test("a partial move across days preserves the reviewed multi-booth circle identity", () => {
  const result = amend([{ kind: "moved", moves: [{ source: "1:A01", to: to("B09", "2") }] }]);
  assert.equal(result.summary.newAllocationCount, 0);
  assert.deepEqual(result.grouping.groups[0].linkage, baseline().grouping.groups[0].linkage);
  assert.deepEqual(result.impact[0].before.map((placement) => placement.source), ["1:A01"]);
  assert.deepEqual(result.impact[0].after.map((placement) => [placement.source, placement.circleId]), [["2:B09", "c-000002"]]);
  assert.equal(catalog(result).placements.find((placement) => placement.id === "1-a01").status, "moved");
  assert.deepEqual(active(result, "c-000002").map((placement) => [placement.day, placement.boothCode]), [[1, "A02"], [2, "A01"], [2, "B09"]]);
});

test("splitting a previously single row creates declaration linkage without splitting its circle", () => {
  const input = baseline();
  input.grouping.groups[0].sources = ["1:A01", "1:A02"];
  delete input.grouping.groups[0].linkage;
  input.grouping.groups.push({ sources: ["2:A01"] });
  const previous = input.evidence.entries[1];
  previous.sources.pop();
  input.allocations.allocations.push({ id: "c-000005", allocatedAt: at(), reason: "fixture" });
  input.allocations.nextSequence = 6;
  input.evidence.entries.push({ ...structuredClone(previous), circleId: "c-000005", sources: [{ eventId: event.id, kind: "organizer-booth", value: "2:A01" }] });
  const result = amend([{ kind: "moved", moves: [{ source: "1:A01", to: to("B09") }] }], input);
  assert.equal(result.grouping.groups[0].linkage.kind, "manual-organizer-evidence");
  assert.equal(active(result, "c-000002").length, 2);
});

test("an added multi-day circle has one fresh identity even when its name matches an existing circle", () => {
  const result = amend([{ kind: "added", circleName: "甲社", placements: [to("B09"), to("B10", "2")] }]);
  assert.equal(result.summary.newAllocationCount, 1);
  assert.equal(result.impact[0].before.length, 0);
  assert.deepEqual(result.impact[0].after.map((placement) => placement.circleId), ["c-000005", "c-000005"]);
  assert.equal(active(result, "c-000002").length, 3);
  assert.equal(active(result, "c-000005").length, 2);
});

test("a published handover is a valid baseline for another handover, without replaying old transitions", () => {
  const first = amend([{ kind: "released", sources: ["1:A01"], circleName: "丙社" }]);
  const second = amend([{ kind: "released", sources: ["1:A01"], circleName: "丁社" }], { ...first, event });
  const third = amend([], { ...second, event });
  assert.equal(second.impact[0].before[0].circleId, "c-000005");
  assert.equal(second.impact[0].after[0].circleId, "c-000006");
  assert.deepEqual(third.evidence, second.evidence);
  assert.equal(third.summary.changed, false);
  const booths = catalog(second).placements.filter((placement) => placement.day === 1 && placement.boothCode === "A01");
  assert.deepEqual(booths.map((placement) => [placement.circleId, placement.status]), [
    ["c-000006", "active"], ["c-000002", "cancelled"], ["c-000005", "cancelled"],
  ]);
});

test("moving back and moving again preserves declaration history and projects only the latest location state", () => {
  const move = (source, code, input) => amend([{ kind: "moved", moves: [{ source, to: to(code) }] }], input);
  const first = move("1:A01", "B09", baseline());
  const second = move("1:B09", "A01", { ...first, event });
  assert.equal(catalog(second).placements.filter((placement) => placement.circleId === "c-000002" && placement.boothCode === "A01" && placement.day === 1).length, 1);
  assert.equal(catalog(second).placements.find((placement) => placement.id === "1-a01").status, "active");
  const third = move("1:A01", "B10", { ...second, event });
  assert.equal(third.evidence.entries[1].retiredSources.length, 3);
  const reader = catalog(third);
  assert.equal(new Set(reader.placements.map((placement) => placement.id)).size, reader.placements.length);
  assert.equal(reader.placements.find((placement) => placement.id === "1-a01").status, "moved");
  assert.equal(reader.placements.find((placement) => placement.id === "1-b10").circleId, "c-000002");
  assert.deepEqual(amend([], { ...third, event }).evidence, third.evidence);
});

test("mixed declarations are deterministic and never mutate the published baseline or input", () => {
  const input = baseline();
  const changes = [
    { kind: "withdrawn", sources: ["1:A02"] },
    { kind: "released", sources: ["1:B01"], circleName: "丙社" },
    { kind: "moved", moves: [{ source: "2:A01", to: to("B09", "2") }] },
    { kind: "added", circleName: "新社", placements: [to("B10")] },
  ];
  const before = structuredClone({ input, changes });
  const result = amend(changes, input);
  assert.deepEqual(result, amend(changes, input));
  assert.deepEqual({ input, changes }, before);
  assert.equal(result.summary.retirementCount, 3);
  assert.equal(result.summary.newAllocationCount, 2);
  assert.equal(result.impact.length, 4);
  assert.deepEqual(result.evidence.entries[0], otherEvent);
  assert.equal(catalog(result).circles.length, 5);
});

test("invalid declarations fail closed without changing baseline data", () => {
  const cases = [
    [null, /list of explicit/],
    [[{ kind: "replace", booths: [] }], /Unknown amendment kind/],
    [[{ kind: "withdrawn", sources: [] }], /select at least one/],
    [[{ kind: "withdrawn", sources: ["1:Z99"] }], /Unknown published booth/],
    [[{ kind: "withdrawn", sources: ["1:A01", "1:A01"] }], /more than once/],
    [[{ kind: "withdrawn", sources: ["1:A01"] }, { kind: "released", sources: ["1:A01"], circleName: "新社" }], /more than once/],
    [[{ kind: "released", sources: ["1:A01", "1:B01"], circleName: "新社" }], /same circle/],
    [[{ kind: "released", sources: ["1:A01"], circleName: "甲社" }], /nothing was released/],
    [[{ kind: "added", circleName: "  ", placements: [to("B09")] }], /circle name/],
    [[{ kind: "added", circleName: "新社", placements: [to("a01")] }], /already occupied/],
    [[{ kind: "added", circleName: "新社", placements: [to("B09"), to("b09")] }], /already occupied/],
    [[{ kind: "moved", moves: [{ source: "1:A01", to: to("B01") }] }], /already occupied/],
    [[{ kind: "moved", moves: [{ source: "1:A01", to: to("B09", "3") }] }], /declared day/],
    [[{ kind: "added", circleName: "新社", placements: [to("B09", "1", "Z")] }], /declared day/],
    [[{ kind: "withdrawn", sources: ["1:A01"], official: {} }], /unknown field official/],
    [[{ kind: "withdrawn", sources: ["1:A01"], reference: "http://organizer.invalid/notice" }], /HTTPS/],
    [[{ kind: "withdrawn", sources: ["1:A01", "1:A02"] }, { kind: "withdrawn", sources: ["1:B01"] }], /has no booths/],
  ];
  for (const [changes, error] of cases) {
    const input = baseline();
    const before = structuredClone(input);
    assert.throws(() => amend(changes, input), error, JSON.stringify(changes));
    assert.deepEqual(input, before);
  }
});

test("unpublished or conflicting baseline identities and missing rows cannot silently become amendments", () => {
  const unpublished = baseline();
  unpublished.evidence.entries.pop();
  assert.throws(() => amend([], unpublished), /already have published/);
  const conflicting = baseline();
  conflicting.evidence.entries[2].sources.push({ eventId: event.id, kind: "organizer-booth", value: "1:A01" });
  assert.throws(() => amend([], conflicting), /assigned to multiple circles/);
  const truncated = baseline();
  truncated.official.days[0].booths.shift();
  assert.throws(() => amend([], truncated), /unknown organizer booth source/);
});
