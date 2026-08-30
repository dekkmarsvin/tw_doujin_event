import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { recoverInterruptedReplacement, replaceVerifiedTrees } from "./verified-tree-replace.mjs";

const CANONICAL_ID = /^c-\d{6}$/u;
const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/u;
const LINKAGE_KINDS = new Set(["organizer-stable-key", "manual-organizer-evidence"]);

const GROUPING_SCHEMAS = new Set(["circle-identity-groups/1", "circle-identity-groups/2"]);
const EVIDENCE_SCHEMAS = new Set(["circle-identity-evidence/1", "circle-identity-evidence/2"]);
const EVIDENCE_SCHEMA = "circle-identity-evidence/2";
/**
 * What an organizer can do to an already published booth source.
 *
 * `withdrawn` and `released` differ only in what happens to the booth, and that
 * difference is the whole point: `released` says another circle now has it, so
 * seeing a new circle at that code is expected rather than a name drift. Both
 * leave the original circle's ID exactly where it was — a published ID never
 * follows a booth to a new occupant.
 */
const TRANSITION_KINDS = new Set(["withdrawn", "moved", "released"]);

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
  if (!isRecord(evidence) || !EVIDENCE_SCHEMAS.has(evidence.schema) || !Array.isArray(evidence.entries)) {
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
  const entriesByRetiredSource = new Map();
  for (const entry of evidence.entries) {
    // A circle whose every booth was withdrawn keeps its entry: the ID stays
    // allocated and still has to resolve, or a reader's saved link would land
    // on nothing instead of on "this circle is no longer attending".
    const retired = entry?.retiredSources ?? [];
    if (!isRecord(entry) || !allocationIds.has(entry.circleId) || entriesByCircleId.has(entry.circleId)
      || typeof entry.currentName !== "string" || normalizedName(entry.currentName) === ""
      || !Array.isArray(entry.aliases) || !entry.aliases.every((alias) => typeof alias === "string")
      || !Array.isArray(entry.sources) || !Array.isArray(retired)
      || entry.sources.length + retired.length === 0) {
      throw new Error(`Identity evidence is invalid for ${entry?.circleId ?? "<missing>"}.`);
    }
    entriesByCircleId.set(entry.circleId, entry);
    const claim = (source, target, label) => {
      if (!isRecord(source) || !EVENT_ID.test(source.eventId ?? "")
        || typeof source.kind !== "string" || source.kind === "" || typeof source.value !== "string" || source.value === "") {
        throw new Error(`Identity evidence has an invalid ${label} for ${entry.circleId}.`);
      }
      const key = sourceKey(source);
      if (entriesBySource.has(key) || entriesByRetiredSource.has(key)) {
        throw new Error(`One source is assigned to multiple circles: ${key}.`);
      }
      target.set(key, entry);
    };
    for (const source of entry.sources) claim(source, entriesBySource, "source");
    for (const source of retired) {
      if (!isRecord(source.retirement) || !TRANSITION_KINDS.has(source.retirement.kind)) {
        throw new Error(`Identity evidence has an unrecognised retirement for ${entry.circleId}.`);
      }
      claim(source, entriesByRetiredSource, "retired source");
    }
  }
  return { allocationIds, entriesBySource, entriesByRetiredSource };
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

/**
 * Declared changes to booth sources this event already allocated.
 *
 * These are declarations, never inferences. A booth that simply stops appearing
 * in the organizer's list is refused, because the same shape — sources missing
 * from the list — is also what a truncated page or a half-finished import looks
 * like, and inferring from it would cancel real circles on bad input.
 */
function parseTransitions(value, eventId, officialIndex) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Circle identity transitions must be a list.");
  const declared = new Set();
  return value.map((transition, index) => {
    const label = `Circle identity transition ${index}`;
    if (!isRecord(transition)) throw new Error(`${label} is invalid.`);
    onlyKeys(transition, ["source", "kind", "to", "reference"], label);
    const { source, kind } = transition;
    if (typeof source !== "string" || source === "" || !TRANSITION_KINDS.has(kind)) {
      throw new Error(`${label} must name a booth source and one of withdrawn, moved or released.`);
    }
    if (declared.has(source)) throw new Error(`${label} declares ${source} twice.`);
    declared.add(source);

    // Each kind expects the organizer's list to say something different, and
    // checking that is what stops a declaration from drifting away from the
    // data it describes.
    const listed = officialIndex.sourceToGroup.has(source);
    if (kind === "released") {
      // A handover leaves the booth in the list under someone else.
      if (!listed) throw new Error(`${label} releases ${source}, but the organizer no longer lists that booth; it withdrew.`);
    } else if (listed) {
      throw new Error(`${label} declares ${source}, but the organizer still lists that booth.`);
    }
    if (kind === "moved") {
      if (typeof transition.to !== "string" || !officialIndex.sourceToGroup.has(transition.to)) {
        throw new Error(`${label} must move ${source} to a booth the organizer currently lists.`);
      }
    } else if (transition.to !== undefined) {
      throw new Error(`${label} may only name a destination when it is a move.`);
    }
    const officialGroupId = officialIndex.sourceToGroup.get(source);
    return {
      source, kind, to: kind === "moved" ? transition.to : null,
      reference: transition.reference ?? null, eventId,
      officialName: officialGroupId ? officialIndex.groups.find(({ id }) => id === officialGroupId).name : null,
    };
  });
}

export function parseCircleIdentityGrouping(value, eventId, official) {
  if (!EVENT_ID.test(eventId ?? "") || !isRecord(value) || !GROUPING_SCHEMAS.has(value.schema)
    || value.eventId !== eventId || !Array.isArray(value.groups) || value.groups.length === 0) {
    throw new Error("Circle identity grouping has an unsupported schema or event identity.");
  }
  onlyKeys(value, ["schema", "eventId", "groups", "transitions"], "Circle identity grouping");
  if (value.schema === "circle-identity-groups/1" && value.transitions !== undefined) {
    throw new Error("Circle identity grouping must declare circle-identity-groups/2 to carry transitions.");
  }
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
  return { groups: parsed, transitions: parseTransitions(value.transitions, eventId, officialIndex) };
}

export function planCircleIdentityRegistryUpdate({ eventId, official, grouping, allocations, evidence, today = () => new Date().toISOString().slice(0, 10) }) {
  if (!EVENT_ID.test(eventId ?? "")) throw new Error("Invalid circle identity event ID.");
  const nextAllocations = structuredClone(allocations);
  const nextEvidence = structuredClone(evidence);
  const { allocationIds, entriesBySource, entriesByRetiredSource } = validateRegistry(nextAllocations, nextEvidence);
  const { groups, transitions } = parseCircleIdentityGrouping(grouping, eventId, official);
  const beforeSequence = nextAllocations.nextSequence;
  const summaryGroups = [];

  // Applied before any group is matched, so the rest of this function sees the
  // registry as the organizer's current list describes it. A move re-points the
  // source in place, which is what keeps the circle's ID on the circle rather
  // than on the booth it used to occupy.
  const retirements = transitions.map((transition) => {
    const source = boothSource(eventId, transition.source);
    const entry = entriesBySource.get(sourceKey(source));
    if (!entry) {
      const alreadyRetired = entriesByRetiredSource.get(sourceKey(source));
      throw new Error(alreadyRetired
        ? `Booth source ${transition.source} was already retired from ${alreadyRetired.circleId}.`
        : `Booth source ${transition.source} has no allocated identity to ${transition.kind === "moved" ? "move" : "retire"}.`);
    }
    // A release is only a release if someone else actually has the booth now.
    // The same name means the organizer's list did not change hands, so the
    // declaration is describing something that did not happen.
    if (transition.kind === "released" && normalizedName(transition.officialName) === normalizedName(entry.currentName)) {
      throw new Error(`Booth source ${transition.source} is still listed under ${entry.currentName}; nothing was released.`);
    }
    entry.sources = entry.sources.filter((candidate) => sourceKey(candidate) !== sourceKey(source));
    entriesBySource.delete(sourceKey(source));
    entry.retiredSources = [...(entry.retiredSources ?? []), {
      ...source,
      retirement: {
        kind: transition.kind,
        ...(transition.to ? { to: transition.to } : {}),
        at: today(),
        ...(transition.reference ? { reference: transition.reference } : {}),
      },
    }];
    if (transition.to) {
      const moved = boothSource(eventId, transition.to);
      if (entriesBySource.has(sourceKey(moved))) {
        throw new Error(`Booth source ${transition.to} already belongs to another circle; ${transition.source} cannot move onto it.`);
      }
      entry.sources.push(moved);
      entriesBySource.set(sourceKey(moved), entry);
    }
    return { circleId: entry.circleId, name: entry.currentName, source: transition.source, kind: transition.kind, to: transition.to };
  });

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
  // Only stamped once something is actually retired, so an event that never had
  // a change keeps the file it was reviewed with byte-for-byte.
  if (nextEvidence.entries.some((entry) => (entry.retiredSources ?? []).length > 0)) {
    nextEvidence.schema = EVIDENCE_SCHEMA;
  }
  return {
    allocations: nextAllocations,
    evidence: nextEvidence,
    summary: {
      schema: "circle-identity-update-summary/1",
      eventId,
      changed: newGroups > 0 || retirements.length > 0,
      groupCount: summaryGroups.length,
      existingGroupCount: summaryGroups.length - newGroups,
      newAllocationCount: newGroups,
      newEvidenceEntryCount: newGroups,
      nextSequence: { before: beforeSequence, after: nextAllocations.nextSequence },
      groups: summaryGroups,
      // What an organizer has to read before applying: every already published
      // placement this run changes, named with the circle it belongs to.
      retirementCount: retirements.length,
      retirements,
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
