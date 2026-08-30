import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  planCircleIdentityRegistryUpdate,
  serializeCircleIdentityRegistry,
  writeCircleIdentityRegistry,
} from "../scripts/circle-identity-registry.mjs";
import { assertExactOrganizerEvidenceCoverage, consumeOrganizerEvidenceKey } from "../scripts/official-catalog-core.mjs";

const eventId = "event-alpha";

function registry(extraEntries = []) {
  return {
    allocations: {
      schema: "circle-id-allocations/1",
      nextSequence: 2 + extraEntries.length,
      allocations: [
        { id: "c-000001", allocatedAt: "2026-08-14", reason: "fixture" },
        ...extraEntries.map((_, index) => ({ id: `c-${String(index + 2).padStart(6, "0")}`, allocatedAt: "2026-08-14", reason: "fixture" })),
      ],
    },
    evidence: {
      schema: "circle-identity-evidence/1",
      entries: [{
        circleId: "c-000001",
        currentName: "同名社團",
        aliases: [],
        sources: [{ eventId: "old-event", kind: "organizer-booth", value: "1:A01" }],
      }, ...extraEntries],
    },
  };
}

function official(days = [
  { day: 1, booths: [{ codes: ["A01", "A02"], name: "同名社團" }] },
]) {
  return { schemaVersion: 1, days: days.map((day) => ({ url: `https://example.invalid/day-${day.day}`, ...day })) };
}

function grouping(groups, transitions) {
  return transitions
    ? { schema: "circle-identity-groups/2", eventId, groups, transitions }
    : { schema: "circle-identity-groups/1", eventId, groups };
}

function plan({ officialValue = official(), groups = [{ sources: ["1:A01", "1:A02"] }], registryValue = registry(), transitions } = {}) {
  return planCircleIdentityRegistryUpdate({
    eventId,
    official: officialValue,
    grouping: grouping(groups, transitions),
    ...registryValue,
    today: () => "2026-08-29",
  });
}

test("a cross-event name match receives a fresh globally unique ID without candidates", () => {
  const result = plan();
  assert.equal(result.summary.newAllocationCount, 1);
  assert.deepEqual(result.summary.nextSequence, { before: 2, after: 3 });
  assert.equal(result.evidence.entries.at(-1).circleId, "c-000002");
  assert.deepEqual(result.evidence.entries.at(-1).sources, [
    { eventId, kind: "organizer-booth", value: "1:A01" },
    { eventId, kind: "organizer-booth", value: "1:A02" },
  ]);
});

test("rerunning reviewed sources in the same event is a no-op", () => {
  const first = plan();
  const second = plan({ registryValue: { allocations: first.allocations, evidence: first.evidence } });
  assert.equal(second.summary.changed, false);
  assert.equal(second.summary.existingGroupCount, 1);
  assert.equal(serializeCircleIdentityRegistry(second.allocations), serializeCircleIdentityRegistry(first.allocations));
  assert.equal(serializeCircleIdentityRegistry(second.evidence), serializeCircleIdentityRegistry(first.evidence));
});

test("an existing entry shared with another event is rejected instead of reused", () => {
  const shared = registry([{
    circleId: "c-000002",
    currentName: "同名社團",
    aliases: [],
    sources: [
      { eventId, kind: "organizer-booth", value: "1:A01" },
      { eventId, kind: "organizer-booth", value: "1:A02" },
      { eventId: "event-older", kind: "organizer-booth", value: "1:Z99" },
    ],
  }]);
  assert.throws(() => plan({ registryValue: shared }), /contains cross-event evidence/);
});

test("traceable organizer evidence joins multi-day and multi-booth sources under one ID", () => {
  const result = plan({
    officialValue: official([
      { day: 1, booths: [{ codes: ["A01", "A02"], name: "跨日社團" }] },
      { day: 2, booths: [{ codes: ["B01", "B02"], name: "跨日社團" }] },
    ]),
    groups: [{
      sources: ["1:A01", "1:A02", "2:B01", "2:B02"],
      linkage: {
        kind: "organizer-stable-key",
        value: "application:1234",
        reference: "https://organizer.example.invalid/applications/1234",
      },
    }],
  });
  assert.equal(result.summary.newAllocationCount, 1);
  assert.equal(result.evidence.entries.at(-1).sources.length, 4);
  assert.equal(new Set(result.evidence.entries.at(-1).sources.map(({ eventId: id }) => id)).size, 1);
});

test("a name alone cannot join separate official groups", () => {
  assert.throws(() => plan({
    officialValue: official([
      { day: 1, booths: [{ codes: ["A01"], name: "同名社團" }] },
      { day: 2, booths: [{ codes: ["B01"], name: "同名社團" }] },
    ]),
    groups: [{ sources: ["1:A01", "2:B01"] }],
  }), /name alone is not grouping evidence/);
});

test("organizer linkage requires a parsed HTTPS URL with a hostname", () => {
  const officialValue = official([
    { day: 1, booths: [{ codes: ["A01"], name: "同名社團" }] },
    { day: 2, booths: [{ codes: ["B01"], name: "同名社團" }] },
  ]);
  for (const reference of ["https://", "https://#evidence", "http://organizer.example.invalid/evidence"]) {
    assert.throws(() => plan({
      officialValue,
      groups: [{
        sources: ["1:A01", "2:B01"],
        linkage: { kind: "organizer-stable-key", value: "application:1234", reference },
      }],
    }), /invalid or untraceable organizer linkage evidence/);
  }
});

test("grouping must cover every booth exactly once and may not split an official group", () => {
  assert.throws(() => plan({ groups: [{ sources: ["1:A01"] }] }), /splits official booth group/);
  assert.throws(() => plan({ groups: [{ sources: ["1:A01", "1:A02"] }, { sources: ["1:A02"] }] }), /more than one identity group/);
});

test("the catalog coverage gate still rejects duplicate or missing organizer evidence", () => {
  const consumed = new Set();
  consumeOrganizerEvidenceKey(consumed, "1:A01");
  assert.throws(() => consumeOrganizerEvidenceKey(consumed, "1:A01"), /more than once/);
  assert.throws(() => assertExactOrganizerEvidenceCoverage(new Set(["1:A01", "1:A02"]), consumed), /missing: 1:A02/);
});

test("partial and conflicting existing groups fail closed without mutating caller values", () => {
  const partial = registry([{
    circleId: "c-000002",
    currentName: "同名社團",
    aliases: [],
    sources: [{ eventId, kind: "organizer-booth", value: "1:A01" }],
  }]);
  const partialBefore = structuredClone(partial);
  assert.throws(() => plan({ registryValue: partial }), /partial existing evidence/);
  assert.deepEqual(partial, partialBefore);

  const conflicting = registry([
    {
      circleId: "c-000002", currentName: "同名社團", aliases: [],
      sources: [{ eventId, kind: "organizer-booth", value: "1:A01" }],
    },
    {
      circleId: "c-000003", currentName: "同名社團", aliases: [],
      sources: [{ eventId, kind: "organizer-booth", value: "1:A02" }],
    },
  ]);
  const conflictBefore = structuredClone(conflicting);
  assert.throws(() => plan({ registryValue: conflicting }), /conflicting circle IDs/);
  assert.deepEqual(conflicting, conflictBefore);
});

/*
 * What happens after publication, when the organizer changes the list.
 *
 * ADR-0044 decision 6 lists four transitions and records that three of them
 * fail closed with no documented recovery, and that none of them is covered by
 * a test. These pin today's behaviour — including the exact message an
 * organizer would hit — so that when #139 lands a correction path, the change
 * is visible in this diff instead of being silent.
 *
 * The shared guarantee underneath all four: a `c-xxxxxx` that has been
 * published never quietly starts pointing at a different circle.
 */

/** Two circles published, so a later run can drop one without emptying the list. */
const twoPublished = () => {
  const first = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "甲社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }],
  });
  return { allocations: first.allocations, evidence: first.evidence };
};

const idFor = (registryValue, value) => registryValue.evidence.entries
  .find((entry) => entry.sources.some((source) => source.eventId === eventId && source.value === value))?.circleId;

test("a circle that withdraws after publication fails closed rather than vanishing", () => {
  const published = twoPublished();
  assert.equal(idFor(published, "1:A01"), "c-000002");
  const before = structuredClone(published);

  // 甲社 is gone from the organizer's list. Its allocated booth source is still
  // in the registry, so the coverage gate refuses the whole update.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    registryValue: published,
  }), /organizer booth sources outside the reviewed event-alpha grouping: 1:A01/);
  assert.deepEqual(published, before, "a refused update leaves the registry untouched");
});

test("a booth handed to another circle cannot inherit the previous circle's ID", () => {
  const published = twoPublished();
  const before = structuredClone(published);

  // Same booth, different circle. Silently accepting this would repoint an
  // already published ID — every favourite and shared link for 甲社 would land
  // on whoever took the booth.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "丙社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }],
    registryValue: published,
  }), /Organizer name drift for 1:A01: evidence=甲社, official=丙社/);
  assert.deepEqual(published, before);
});

test("a booth that moves is not yet expressible, and fails closed both ways", () => {
  const published = twoPublished();
  const before = structuredClone(published);

  // 甲社 moved from A01 to C09. There is no way to say so, so the run is
  // refused — which is the safe outcome, because the alternative the generator
  // would otherwise reach is worse: C09 has no evidence, so it would allocate a
  // *second* ID for a circle that already has one.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["C09"], name: "甲社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:C09"] }, { sources: ["1:B01"] }],
    registryValue: published,
  }), /organizer booth sources outside the reviewed event-alpha grouping: 1:A01/);
  assert.deepEqual(published, before);
});

test("a full renumbering fails closed as one refusal, not a partial rewrite", () => {
  const published = twoPublished();
  const before = structuredClone(published);

  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["D01"], name: "甲社" }, { codes: ["D02"], name: "乙社" }] }]),
    groups: [{ sources: ["1:D01"] }, { sources: ["1:D02"] }],
    registryValue: published,
  }), /organizer booth sources outside the reviewed event-alpha grouping: 1:A01, 1:B01/);
  assert.deepEqual(published, before, "no half-renumbered registry is left behind");
});

test("adding a circle after publication is the one transition that already works", () => {
  const published = twoPublished();

  const result = plan({
    officialValue: official([{ day: 1, booths: [
      { codes: ["A01"], name: "甲社" }, { codes: ["B01"], name: "乙社" }, { codes: ["C01"], name: "丁社" },
    ] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }, { sources: ["1:C01"] }],
    registryValue: published,
  });

  assert.equal(result.summary.newAllocationCount, 1);
  assert.equal(idFor(result, "1:C01"), "c-000004");
  // The point of the transition being cheap: nothing already published moved.
  assert.equal(idFor(result, "1:A01"), "c-000002");
  assert.equal(idFor(result, "1:B01"), "c-000003");
});

test("blank names and allocation cursor mismatches fail closed", () => {
  assert.throws(() => plan({ officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "" }] }]), groups: [{ sources: ["1:A01"] }] }), /blank circle name/);
  const invalid = registry();
  invalid.allocations.nextSequence = 1;
  assert.throws(() => plan({ registryValue: invalid }), /nextSequence must be 2/);
});

test("registry directory replacement restores the complete previous pair when install fails", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "circle-identity-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, "allocations.json"), "previous allocations\n"),
    writeFile(path.join(directory, "evidence.json"), "previous evidence\n"),
    writeFile(path.join(directory, "audit.json"), "preserved audit\n"),
  ]);
  const candidate = plan();
  const renameWithFailure = async (source, destination) => {
    if (source.includes(".tmp-circle-identities-") && destination === directory) {
      throw new Error("simulated registry directory install failure");
    }
    return rename(source, destination);
  };
  await assert.rejects(writeCircleIdentityRegistry({
    directory,
    allocations: candidate.allocations,
    evidence: candidate.evidence,
    fileSystemOverrides: { rename: renameWithFailure },
  }), /simulated registry directory install failure/);
  assert.equal(await readFile(path.join(directory, "allocations.json"), "utf8"), "previous allocations\n");
  assert.equal(await readFile(path.join(directory, "evidence.json"), "utf8"), "previous evidence\n");
  assert.equal(await readFile(path.join(directory, "audit.json"), "utf8"), "preserved audit\n");
});

function runGenerator(workspace, ...arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve("scripts/generate-circle-identities.mjs"),
      eventId,
      "--workspace",
      workspace,
      ...arguments_,
    ], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function runStaging(workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve("scripts/stage-event-data.mjs"),
      eventId,
      "--workspace",
      workspace,
    ], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("the CLI defaults to dry-run, --write updates both files, and --check proves a no-op", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "circle-identity-cli-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const eventDirectory = path.join(workspace, ".event-data", eventId);
  const registryDirectory = path.join(workspace, "data", "circle-identities");
  await Promise.all([mkdir(eventDirectory, { recursive: true }), mkdir(registryDirectory, { recursive: true })]);
  const registryValue = registry();
  const event = {
    id: eventId,
    days: [{ id: 1 }],
    officialData: { boothListUrls: { 1: "https://example.invalid/day-1" } },
  };
  const officialValue = official();
  const groupingValue = grouping([{ sources: ["1:A01", "1:A02"] }]);
  await Promise.all([
    writeFile(path.join(eventDirectory, "event.json"), serializeCircleIdentityRegistry(event)),
    writeFile(path.join(eventDirectory, "official-booths.json"), serializeCircleIdentityRegistry(officialValue)),
    writeFile(path.join(eventDirectory, "circle-identity-groups.json"), serializeCircleIdentityRegistry(groupingValue)),
    writeFile(path.join(registryDirectory, "allocations.json"), serializeCircleIdentityRegistry(registryValue.allocations)),
    writeFile(path.join(registryDirectory, "evidence.json"), serializeCircleIdentityRegistry(registryValue.evidence)),
    writeFile(path.join(registryDirectory, "audit.json"), "preserved audit\n"),
  ]);
  const before = await Promise.all([
    readFile(path.join(registryDirectory, "allocations.json"), "utf8"),
    readFile(path.join(registryDirectory, "evidence.json"), "utf8"),
  ]);

  await rename(registryDirectory, `${registryDirectory}.previous`);
  const dryRun = await runGenerator(workspace);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).mode, "dry-run");
  await assert.rejects(readFile(path.join(`${registryDirectory}.previous`, "allocations.json"), "utf8"), /ENOENT/);
  assert.deepEqual(await Promise.all([
    readFile(path.join(registryDirectory, "allocations.json"), "utf8"),
    readFile(path.join(registryDirectory, "evidence.json"), "utf8"),
  ]), before);

  const staleStage = await runStaging(workspace);
  assert.notEqual(staleStage.code, 0);
  assert.match(staleStage.stderr, /Identity registry is missing 1 reviewed/);
  const staleCheck = await runGenerator(workspace, "--check");
  assert.notEqual(staleCheck.code, 0);
  assert.match(staleCheck.stderr, /missing 1 reviewed/);
  const written = await runGenerator(workspace, "--write");
  assert.equal(written.code, 0, written.stderr);
  assert.equal(JSON.parse(written.stdout).mode, "write");
  assert.equal(await readFile(path.join(registryDirectory, "audit.json"), "utf8"), "preserved audit\n");

  const afterWrite = await Promise.all([
    readFile(path.join(registryDirectory, "allocations.json"), "utf8"),
    readFile(path.join(registryDirectory, "evidence.json"), "utf8"),
  ]);
  const checked = await runGenerator(workspace, "--check");
  assert.equal(checked.code, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).changed, false);
  assert.deepEqual(await Promise.all([
    readFile(path.join(registryDirectory, "allocations.json"), "utf8"),
    readFile(path.join(registryDirectory, "evidence.json"), "utf8"),
  ]), afterWrite);
});

/*
 * Declared transitions: the correction path for #139.
 *
 * These are declarations, not inferences. The tests above prove that an
 * undeclared change is still refused; these prove that a declared one is
 * applied without any published ID changing what it points at.
 */

const retired = (registryValue, circleId) => registryValue.evidence.entries
  .find((entry) => entry.circleId === circleId)?.retiredSources ?? [];
const activeSources = (registryValue, circleId) => registryValue.evidence.entries
  .find((entry) => entry.circleId === circleId).sources.map((source) => source.value);

test("a declared withdrawal retires the booth and keeps the circle's identity", () => {
  const published = twoPublished();

  const result = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "withdrawn", reference: "https://organizer.invalid/notice" }],
    registryValue: published,
  });

  // The ID survives the withdrawal. A reader's saved link still resolves — to a
  // circle that is no longer attending, rather than to nothing or to someone else.
  assert.equal(idFor(result, "1:B01"), "c-000003");
  assert.deepEqual(activeSources(result, "c-000002"), []);
  assert.deepEqual(retired(result, "c-000002"), [{
    eventId, kind: "organizer-booth", value: "1:A01",
    retirement: { kind: "withdrawn", at: "2026-08-29", reference: "https://organizer.invalid/notice" },
  }]);
  assert.equal(result.evidence.schema, "circle-identity-evidence/2");
  assert.equal(result.summary.newAllocationCount, 0, "a withdrawal allocates nothing");
  assert.equal(result.summary.changed, true, "retiring a booth is a change even with no new IDs");
  assert.deepEqual(result.summary.retirements, [
    { circleId: "c-000002", name: "甲社", source: "1:A01", kind: "withdrawn", to: null },
  ]);
});

test("a declared move keeps the ID on the circle, not on the booth it left", () => {
  const published = twoPublished();

  const result = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["C09"], name: "甲社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:C09"] }, { sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "moved", to: "1:C09" }],
    registryValue: published,
  });

  assert.equal(idFor(result, "1:C09"), "c-000002", "the circle took its ID to the new booth");
  assert.equal(result.summary.newAllocationCount, 0, "a move must not allocate a second ID for the same circle");
  assert.deepEqual(activeSources(result, "c-000002"), ["1:C09"]);
  assert.deepEqual(retired(result, "c-000002")[0].retirement, { kind: "moved", to: "1:C09", at: "2026-08-29" });
});

test("a declared handover gives the booth a new circle and a new ID", () => {
  const published = twoPublished();

  const result = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "丙社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "released" }],
    registryValue: published,
  });

  // The whole point: the booth changed hands, the identity did not follow it.
  assert.equal(idFor(result, "1:A01"), "c-000004");
  assert.equal(result.evidence.entries.find((entry) => entry.circleId === "c-000004").currentName, "丙社");
  assert.equal(result.evidence.entries.find((entry) => entry.circleId === "c-000002").currentName, "甲社");
  assert.deepEqual(activeSources(result, "c-000002"), []);
  assert.equal(result.summary.newAllocationCount, 1);
});

test("a declared renumbering moves every circle without reallocating any of them", () => {
  const published = twoPublished();

  const result = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["D01"], name: "甲社" }, { codes: ["D02"], name: "乙社" }] }]),
    groups: [{ sources: ["1:D01"] }, { sources: ["1:D02"] }],
    transitions: [
      { source: "1:A01", kind: "moved", to: "1:D01" },
      { source: "1:B01", kind: "moved", to: "1:D02" },
    ],
    registryValue: published,
  });

  assert.equal(result.summary.newAllocationCount, 0);
  assert.equal(idFor(result, "1:D01"), "c-000002");
  assert.equal(idFor(result, "1:D02"), "c-000003");
  assert.equal(result.summary.retirementCount, 2);
});

test("a transition that contradicts the organizer's list is refused", () => {
  const published = twoPublished();
  const before = structuredClone(published);

  // Retiring a booth the organizer still lists would leave a line in the file
  // that nothing checks and nobody re-reads.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "甲社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "withdrawn" }],
    registryValue: published,
  }), /still lists that booth/);

  // Moving to a booth that is not in the list would point the circle at nothing.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "moved", to: "1:ZZ9" }],
    registryValue: published,
  }), /move 1:A01 to a booth the organizer currently lists/);

  // Retiring something that was never allocated is a typo, not a correction.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:Z99", kind: "withdrawn" }, { source: "1:A01", kind: "withdrawn" }],
    registryValue: published,
  }), /1:Z99 has no allocated identity to retire/);

  // A release names a handover. If the organizer still lists the same circle at
  // that booth, nothing changed hands and the declaration is describing a
  // handover that did not happen.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["A01"], name: "甲社" }, { codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:A01"] }, { sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "released" }],
    registryValue: published,
  }), /still listed under 甲社; nothing was released/);

  // And a withdrawal cannot stand in for a handover: the booth is still listed.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "released" }],
    registryValue: published,
  }), /no longer lists that booth; it withdrew/);

  assert.deepEqual(published, before, "every refusal leaves the registry untouched");
});

test("transitions need the schema that declares them, and cannot repeat a source", () => {
  const published = twoPublished();
  assert.throws(() => planCircleIdentityRegistryUpdate({
    eventId,
    official: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    grouping: { schema: "circle-identity-groups/1", eventId, groups: [{ sources: ["1:B01"] }], transitions: [] },
    ...published,
    today: () => "2026-08-29",
  }), /must declare circle-identity-groups\/2/);

  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "withdrawn" }, { source: "1:A01", kind: "withdrawn" }],
    registryValue: published,
  }), /declares 1:A01 twice/);
});

test("a retired booth stays retired on a rerun", () => {
  const published = twoPublished();
  const afterWithdrawal = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "withdrawn" }],
    registryValue: published,
  });
  const settled = { allocations: afterWithdrawal.allocations, evidence: afterWithdrawal.evidence };

  // The declaration has already been applied, so repeating it is a mistake, not
  // an idempotent no-op — the line should be dropped once it has landed.
  assert.throws(() => plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    transitions: [{ source: "1:A01", kind: "withdrawn" }],
    registryValue: settled,
  }), /already retired from c-000002/);

  // Without the declaration the rerun is a clean no-op: the retired booth is no
  // longer expected in the organizer's list.
  const rerun = plan({
    officialValue: official([{ day: 1, booths: [{ codes: ["B01"], name: "乙社" }] }]),
    groups: [{ sources: ["1:B01"] }],
    registryValue: settled,
  });
  assert.equal(rerun.summary.changed, false);
  assert.equal(serializeCircleIdentityRegistry(rerun.evidence), serializeCircleIdentityRegistry(settled.evidence));
});
