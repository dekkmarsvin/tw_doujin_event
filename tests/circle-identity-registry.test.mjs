import assert from "node:assert/strict";
import test from "node:test";
import { assertExactOrganizerEvidenceCoverage, consumeOrganizerEvidenceKey } from "../scripts/official-catalog-core.mjs";
import { CircleIdentityAdjudicationError, createCircleIdentityRegistry } from "../scripts/circle-identity-registry.mjs";

function fixture(extraSources = []) {
  return {
    allocations: {
      schema: "circle-id-allocations/1",
      nextSequence: 2,
      allocations: [{ id: "c-000001", allocatedAt: "2026-08-14", reason: "fixture" }],
    },
    evidence: {
      schema: "circle-identity-evidence/1",
      entries: [{
        circleId: "c-000001",
        currentName: "原社團",
        aliases: [],
        sources: [{ eventId: "ff47", kind: "organizer-booth", value: "1:A10" }, ...extraSources],
      }],
    },
  };
}

test("a rename keeps the allocated ID and records the previous name as evidence", () => {
  const registry = createCircleIdentityRegistry(fixture());
  assert.equal(registry.resolve({ eventId: "ff47", kind: "organizer-booth", value: "1:A10" }, "新社團"), "c-000001");
  assert.equal(registry.evidence.entries[0].currentName, "新社團");
  assert.deepEqual(registry.evidence.entries[0].aliases, ["原社團"]);
});

test("an unreviewed booth with only a name match fails with an adjudication report", () => {
  const registry = createCircleIdentityRegistry(fixture());
  assert.throws(
    () => registry.resolve({ eventId: "ff47", kind: "organizer-booth", value: "1:A11" }, "原社團"),
    (error) => error instanceof CircleIdentityAdjudicationError
      && error.report.reason === "name-only-match"
      && error.report.candidates[0] === "c-000001",
  );
});

test("cross-event identity requires reviewed source evidence and then reuses the same ID", () => {
  const reviewed = createCircleIdentityRegistry(fixture([{ eventId: "ff48", kind: "application", value: "A-20" }]));
  assert.equal(reviewed.resolve({ eventId: "ff48", kind: "application", value: "A-20" }, "原社團"), "c-000001");

  const unreviewed = createCircleIdentityRegistry(fixture());
  assert.throws(
    () => unreviewed.resolve({ eventId: "ff48", kind: "application", value: "A-20" }, "原社團"),
    CircleIdentityAdjudicationError,
  );
});

test("new unique evidence appends one never-reused allocation and check mode refuses writes", () => {
  const registry = createCircleIdentityRegistry({ ...fixture(), today: () => "2026-08-15" });
  assert.equal(registry.resolve({ eventId: "ff48", kind: "application", value: "B-30" }, "全新社團"), "c-000002");
  assert.equal(registry.allocations.nextSequence, 3);
  assert.equal(registry.allocations.allocations.at(-1).id, "c-000002");

  const checking = createCircleIdentityRegistry({ ...fixture(), check: true });
  assert.throws(() => checking.resolve({ eventId: "ff48", kind: "application", value: "B-30" }, "全新社團"), /needs a permanent circle ID/);
});

test("the allocation cursor must follow the immutable ledger tail", () => {
  const invalid = fixture();
  invalid.allocations.nextSequence = 1;
  assert.throws(() => createCircleIdentityRegistry(invalid), /nextSequence must be 2/);
});
test("official organizer evidence rejects duplicate consumption even when counts match", () => {
  const consumed = new Set();
  consumeOrganizerEvidenceKey(consumed, "1:A01");
  assert.throws(() => consumeOrganizerEvidenceKey(consumed, "1:A01"), /more than once/);
  assert.throws(() => assertExactOrganizerEvidenceCoverage(new Set(["1:A01", "1:A02"]), consumed), /missing: 1:A02/);
});
