import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { recoverInterruptedReplacement, replaceVerifiedTrees } from "./verified-tree-replace.mjs";

const CANONICAL_ID = /^c-\d{6}$/u;
const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/u;
const LINKAGE_KINDS = new Set(["organizer-stable-key", "manual-organizer-evidence"]);

const normalizedName = (value) => String(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
const sourceKey = (source) => `${source.eventId}\0${source.kind}\0${source.value}`;
const boothSource = (eventId, value) => ({ eventId, kind: "organizer-booth", value });

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}.`);
}

function validateRegistry(allocations, evidence) {
  if (!isRecord(allocations) || allocations.schema !== "circle-id-allocations/1"
    || !Number.isInteger(allocations.nextSequence) || !Array.isArray(allocations.allocations)) {
    throw new Error("Identity allocations have an unsupported schema.");
  }
  if (!isRecord(evidence) || evidence.schema !== "circle-identity-evidence/1" || !Array.isArray(evidence.entries)) {
    throw new Error("Identity evidence has an unsupported schema.");
  }

  const allocationIds = new Set();
  let maximumSequence = 0;
  for (const allocation of allocations.allocations) {
    if (!isRecord(allocation) || !CANONICAL_ID.test(allocation.id ?? "") || allocationIds.has(allocation.id)) {
      throw new Error(`Identity allocations contain an invalid or duplicate ID: ${allocation?.id ?? "<missing>"}.`);
    }
    allocationIds.add(allocation.id);
    maximumSequence = Math.max(maximumSequence, Number(allocation.id.slice(2)));
  }
  if (allocations.nextSequence !== maximumSequence + 1) {
    throw new Error(`Identity allocation nextSequence must be ${maximumSequence + 1}, got ${allocations.nextSequence}.`);
  }

  const entriesByCircleId = new Map();
  const entriesBySource = new Map();
  for (const entry of evidence.entries) {
    if (!isRecord(entry) || !allocationIds.has(entry.circleId) || entriesByCircleId.has(entry.circleId)
      || typeof entry.currentName !== "string" || normalizedName(entry.currentName) === ""
      || !Array.isArray(entry.aliases) || !entry.aliases.every((alias) => typeof alias === "string")
      || !Array.isArray(entry.sources) || entry.sources.length === 0) {
      throw new Error(`Identity evidence is invalid for ${entry?.circleId ?? "<missing>"}.`);
    }
    entriesByCircleId.set(entry.circleId, entry);
    for (const source of entry.sources) {
      if (!isRecord(source) || !EVENT_ID.test(source.eventId ?? "")
        || typeof source.kind !== "string" || source.kind === "" || typeof source.value !== "string" || source.value === "") {
        throw new Error(`Identity evidence has an invalid source for ${entry.circleId}.`);
      }
      const key = sourceKey(source);
      if (entriesBySource.has(key)) throw new Error(`One source is assigned to multiple circles: ${key}.`);
      entriesBySource.set(key, entry);
    }
  }
  return { allocationIds, entriesBySource };
}

function officialGroups(eventId, official) {
  const groups = [];
  const sourceToGroup = new Map();
  for (const day of official.days) {
    for (const [index, group] of day.booths.entries()) {
      if (typeof group.name !== "string" || normalizedName(group.name) === "") {
        throw new Error(`Official booth group ${day.day}/${index} has a blank circle name.`);
      }
      const id = `${day.day}/${index}`;
      const sources = group.codes.map((code) => `${day.day}:${code}`);
      for (const value of sources) {
        if (sourceToGroup.has(value)) throw new Error(`Official booth source ${value} is duplicated.`);
        sourceToGroup.set(value, id);
      }
      groups.push({ id, name: group.name, sources });
    }
  }
  if (groups.length === 0) throw new Error(`Official booth data for ${eventId} has no groups.`);
  return { groups, sourceToGroup };
}

function validateLinkage(linkage, label) {
  if (!isRecord(linkage)) throw new Error(`${label} needs organizer linkage evidence; a name alone is not grouping evidence.`);
  onlyKeys(linkage, ["kind", "value", "reference"], `${label} linkage`);
  let reference;
  try {
    reference = new URL(linkage.reference);
  } catch {
    reference = null;
  }
  if (!LINKAGE_KINDS.has(linkage.kind) || typeof linkage.value !== "string" || linkage.value.trim() === ""
    || !reference || reference.protocol !== "https:" || reference.hostname === "") {
    throw new Error(`${label} has invalid or untraceable organizer linkage evidence.`);
  }
}

export function parseCircleIdentityGrouping(value, eventId, official) {
  if (!EVENT_ID.test(eventId ?? "") || !isRecord(value) || value.schema !== "circle-identity-groups/1"
    || value.eventId !== eventId || !Array.isArray(value.groups) || value.groups.length === 0) {
    throw new Error("Circle identity grouping has an unsupported schema or event identity.");
  }
  onlyKeys(value, ["schema", "eventId", "groups"], "Circle identity grouping");
  const officialIndex = officialGroups(eventId, official);
  const officialById = new Map(officialIndex.groups.map((group) => [group.id, group]));
  const consumed = new Set();
  const parsed = value.groups.map((group, groupIndex) => {
    const label = `Circle identity group ${groupIndex}`;
    if (!isRecord(group)) throw new Error(`${label} is invalid.`);
    onlyKeys(group, ["sources", "linkage"], label);
    if (!Array.isArray(group.sources) || group.sources.length === 0
      || !group.sources.every((source) => typeof source === "string" && source !== "")) {
      throw new Error(`${label} must list organizer booth sources.`);
    }
    const officialGroupIds = new Set();
    const names = new Map();
    for (const source of group.sources) {
      if (consumed.has(source)) throw new Error(`Organizer booth source ${source} appears in more than one identity group.`);
      consumed.add(source);
      const officialGroupId = officialIndex.sourceToGroup.get(source);
      if (!officialGroupId) throw new Error(`${label} contains unknown organizer booth source ${source}.`);
      officialGroupIds.add(officialGroupId);
      const officialGroup = officialById.get(officialGroupId);
      names.set(normalizedName(officialGroup.name), officialGroup.name);
    }
    for (const officialGroupId of officialGroupIds) {
      const expected = officialById.get(officialGroupId).sources;
      if (expected.some((source) => !group.sources.includes(source))) {
        throw new Error(`${label} splits official booth group ${officialGroupId}.`);
      }
    }
    if (names.size !== 1) throw new Error(`${label} has organizer name drift across its sources.`);
    if (officialGroupIds.size > 1) validateLinkage(group.linkage, label);
    else if (group.linkage !== undefined) validateLinkage(group.linkage, label);
    return { name: [...names.values()][0], sources: [...group.sources], linkage: group.linkage ?? null };
  });

  const missing = [...officialIndex.sourceToGroup.keys()].filter((source) => !consumed.has(source));
  if (missing.length > 0) throw new Error(`Circle identity grouping does not cover organizer booth sources: ${missing.join(", ")}.`);
  return parsed;
}

export function planCircleIdentityRegistryUpdate({ eventId, official, grouping, allocations, evidence, today = () => new Date().toISOString().slice(0, 10) }) {
  if (!EVENT_ID.test(eventId ?? "")) throw new Error("Invalid circle identity event ID.");
  const nextAllocations = structuredClone(allocations);
  const nextEvidence = structuredClone(evidence);
  const { allocationIds, entriesBySource } = validateRegistry(nextAllocations, nextEvidence);
  const groups = parseCircleIdentityGrouping(grouping, eventId, official);
  const beforeSequence = nextAllocations.nextSequence;
  const summaryGroups = [];

  for (const group of groups) {
    const sources = group.sources.map((value) => boothSource(eventId, value));
    const matched = new Set(sources.map((source) => entriesBySource.get(sourceKey(source))).filter(Boolean));
    if (matched.size > 1) throw new Error(`Identity group ${group.sources.join(", ")} points to conflicting circle IDs.`);
    if (matched.size === 1) {
      const [entry] = matched;
      const foreignSources = entry.sources.filter((source) => source.eventId !== eventId);
      if (foreignSources.length > 0) {
        throw new Error(`Existing ${entry.circleId} contains cross-event evidence; ${eventId} requires a fresh event-local identity.`);
      }
      if (sources.some((source) => entriesBySource.get(sourceKey(source)) !== entry)) {
        throw new Error(`Identity group ${group.sources.join(", ")} has only partial existing evidence.`);
      }
      const groupKeys = new Set(sources.map(sourceKey));
      const extraForEvent = entry.sources.filter((source) => source.eventId === eventId && !groupKeys.has(sourceKey(source)));
      if (extraForEvent.length > 0) throw new Error(`Existing ${entry.circleId} conflicts with the reviewed grouping for ${eventId}.`);
      if (normalizedName(entry.currentName) !== normalizedName(group.name)) {
        throw new Error(`Organizer name drift for ${group.sources[0]}: evidence=${entry.currentName}, official=${group.name}.`);
      }
      summaryGroups.push({ circleId: entry.circleId, name: group.name, sources: group.sources, status: "existing" });
      continue;
    }

    const circleId = `c-${String(nextAllocations.nextSequence).padStart(6, "0")}`;
    if (!CANONICAL_ID.test(circleId) || allocationIds.has(circleId)) throw new Error(`Cannot allocate unique circle ID ${circleId}.`);
    nextAllocations.nextSequence += 1;
    nextAllocations.allocations.push({ id: circleId, allocatedAt: today(), reason: `New reviewed ${eventId} catalog evidence` });
    const entry = { circleId, currentName: group.name, aliases: [], sources };
    nextEvidence.entries.push(entry);
    allocationIds.add(circleId);
    for (const source of sources) entriesBySource.set(sourceKey(source), entry);
    summaryGroups.push({ circleId, name: group.name, sources: group.sources, status: "new" });
  }

  const officialSources = new Set(groups.flatMap((group) => group.sources));
  const registrySources = nextEvidence.entries.flatMap((entry) => entry.sources)
    .filter((source) => source.eventId === eventId && source.kind === "organizer-booth")
    .map((source) => source.value);
  const extra = registrySources.filter((source) => !officialSources.has(source));
  if (extra.length > 0) throw new Error(`Identity evidence has organizer booth sources outside the reviewed ${eventId} grouping: ${extra.join(", ")}.`);
  if (new Set(registrySources).size !== officialSources.size) throw new Error(`Identity evidence coverage for ${eventId} is not exact.`);

  const newGroups = summaryGroups.filter(({ status }) => status === "new").length;
  return {
    allocations: nextAllocations,
    evidence: nextEvidence,
    summary: {
      schema: "circle-identity-update-summary/1",
      eventId,
      changed: newGroups > 0,
      groupCount: summaryGroups.length,
      existingGroupCount: summaryGroups.length - newGroups,
      newAllocationCount: newGroups,
      newEvidenceEntryCount: newGroups,
      nextSequence: { before: beforeSequence, after: nextAllocations.nextSequence },
      groups: summaryGroups,
    },
  };
}

export function serializeCircleIdentityRegistry(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function recoverCircleIdentityRegistry(directory, fileSystemOverrides = {}) {
  await recoverInterruptedReplacement(path.resolve(directory), fileSystemOverrides);
}

export async function writeCircleIdentityRegistry({ directory, allocations, evidence, fileSystemOverrides = {} }) {
  const destinationDirectory = path.resolve(directory);
  await recoverCircleIdentityRegistry(destinationDirectory, fileSystemOverrides);
  await mkdir(destinationDirectory, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(path.dirname(destinationDirectory), ".tmp-circle-identities-"));
  const temporaryDirectory = path.join(temporaryRoot, path.basename(destinationDirectory));
  try {
    await cp(destinationDirectory, temporaryDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(temporaryDirectory, "allocations.json"), serializeCircleIdentityRegistry(allocations)),
      writeFile(path.join(temporaryDirectory, "evidence.json"), serializeCircleIdentityRegistry(evidence)),
    ]);
    await replaceVerifiedTrees([{ temporary: temporaryDirectory, destination: destinationDirectory }], fileSystemOverrides);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
