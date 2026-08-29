import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  planCircleIdentityRegistryUpdate,
  recoverCircleIdentityRegistry,
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

function grouping(groups) {
  return { schema: "circle-identity-groups/1", eventId, groups };
}

function plan({ officialValue = official(), groups = [{ sources: ["1:A01", "1:A02"] }], registryValue = registry() } = {}) {
  return planCircleIdentityRegistryUpdate({
    eventId,
    official: officialValue,
    grouping: grouping(groups),
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

test("registry recovery cannot consume an active onboarding transaction backup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "circle-identity-onboarding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "data", "circle-identities");
  const backup = `${directory}.previous`;
  const pinDirectory = path.join(root, "data", "event-data-pins");
  const lockDirectory = path.join(pinDirectory, ".onboard.lock");
  const transactionFile = path.join(pinDirectory, ".onboard.transaction.json");
  await mkdir(directory, { recursive: true });
  await mkdir(backup, { recursive: true });
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(path.join(directory, "allocations.json"), "candidate\n");
  await writeFile(path.join(backup, "allocations.json"), "previous\n");
  await writeFile(path.join(lockDirectory, "owner.json"), `${JSON.stringify({
    schema: "event-onboarding-lock/1",
    hostname: os.hostname(),
    pid: process.pid,
    token: "active-onboarding",
  })}\n`);
  await writeFile(transactionFile, `${JSON.stringify({
    schema: "verified-tree-transaction/1",
    destinations: [{ destination: directory, hadPrevious: true }],
  })}\n`);

  await assert.rejects(recoverCircleIdentityRegistry(directory), /unfinished event onboarding transaction/);
  assert.equal(await readFile(path.join(directory, "allocations.json"), "utf8"), "candidate\n");
  assert.equal(await readFile(path.join(backup, "allocations.json"), "utf8"), "previous\n");
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
