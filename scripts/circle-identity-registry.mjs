const CANONICAL_ID = /^c-\d{6}$/;

const normalizeName = (value) => String(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
const sourceKey = (source) => `${source.eventId}\0${source.kind}\0${source.value}`;

export class CircleIdentityAdjudicationError extends Error {
  constructor(report) {
    super(`Circle identity needs human adjudication for ${report.eventId}:${report.source.kind}:${report.source.value}.`);
    this.name = "CircleIdentityAdjudicationError";
    this.report = report;
  }
}

/**
 * The single lifecycle seam for allocation, evidence matching and legacy map
 * validation. Callers provide parsed version-controlled files and receive a
 * canonical ID or a structured adjudication report; they never guess by name.
 */
export function createCircleIdentityRegistry({ allocations, evidence, legacyIdMap, check = false, today = () => new Date().toISOString().slice(0, 10) }) {
  if (allocations?.schema !== "circle-id-allocations/1" || !Array.isArray(allocations.allocations)) {
    throw new Error("Identity allocations have an unsupported schema.");
  }
  if (evidence?.schema !== "circle-identity-evidence/1" || !Array.isArray(evidence.entries)) {
    throw new Error("Identity evidence has an unsupported schema.");
  }
  if (legacyIdMap?.schema !== "legacy-circle-id-map/1" || !legacyIdMap.mappings || typeof legacyIdMap.mappings !== "object") {
    throw new Error("Legacy circle ID map has an unsupported schema.");
  }

  const allocationIds = new Set();
  let maximumSequence = 0;
  for (const allocation of allocations.allocations) {
    if (!CANONICAL_ID.test(allocation?.id) || allocationIds.has(allocation.id)) {
      throw new Error(`Identity allocations contain an invalid or duplicate ID: ${allocation?.id ?? "<missing>"}.`);
    }
    allocationIds.add(allocation.id);
    maximumSequence = Math.max(maximumSequence, Number(allocation.id.slice(2)));
  }
  if (allocations.nextSequence !== maximumSequence + 1) {
    throw new Error(`Identity allocation nextSequence must be ${maximumSequence + 1}, got ${allocations.nextSequence}.`);
  }

  const evidenceBySource = new Map();
  const entriesByName = new Map();
  for (const entry of evidence.entries) {
    if (!allocationIds.has(entry?.circleId) || typeof entry.currentName !== "string" || !Array.isArray(entry.aliases) || !Array.isArray(entry.sources)) {
      throw new Error(`Identity evidence is invalid for ${entry?.circleId ?? "<missing>"}.`);
    }
    for (const source of entry.sources) {
      if (typeof source?.eventId !== "string" || typeof source.kind !== "string" || typeof source.value !== "string") {
        throw new Error(`Identity evidence has an invalid source for ${entry.circleId}.`);
      }
      const key = sourceKey(source);
      if (evidenceBySource.has(key)) throw new Error(`One source is assigned to multiple circles: ${key}.`);
      evidenceBySource.set(key, entry);
    }
    for (const name of [entry.currentName, ...entry.aliases]) {
      const key = normalizeName(name);
      entriesByName.set(key, [...(entriesByName.get(key) ?? []), entry]);
    }
  }
  for (const [legacyId, circleId] of Object.entries(legacyIdMap.mappings)) {
    if (!legacyId.startsWith("ff47-") || !allocationIds.has(circleId)) {
      throw new Error(`Legacy circle ID mapping is invalid: ${legacyId} -> ${circleId}.`);
    }
  }

  let changed = false;
  function resolve(source, name) {
    const existing = evidenceBySource.get(sourceKey(source));
    if (existing) {
      if (existing.currentName !== name) {
        existing.aliases = [...new Set([...existing.aliases, existing.currentName])];
        existing.currentName = name;
        changed = true;
      }
      return existing.circleId;
    }

    const candidates = [...new Set((entriesByName.get(normalizeName(name)) ?? []).map((entry) => entry.circleId))];
    if (candidates.length > 0) {
      throw new CircleIdentityAdjudicationError({
        schema: "circle-identity-ambiguity/1",
        eventId: source.eventId,
        source: { kind: source.kind, value: source.value },
        name,
        candidates,
        reason: "name-only-match",
        resolution: "Review the identity evidence registry; never merge from name alone.",
      });
    }
    if (check) throw new Error(`New evidence ${sourceKey(source)} needs a permanent circle ID; run the generator and review the registry diff.`);

    const circleId = `c-${String(allocations.nextSequence).padStart(6, "0")}`;
    if (!CANONICAL_ID.test(circleId) || allocationIds.has(circleId)) throw new Error(`Cannot allocate unique circle ID ${circleId}.`);
    allocations.nextSequence += 1;
    allocations.allocations.push({ id: circleId, allocatedAt: today(), reason: "New reviewed catalog evidence" });
    const entry = { circleId, currentName: name, aliases: [], sources: [source] };
    evidence.entries.push(entry);
    allocationIds.add(circleId);
    evidenceBySource.set(sourceKey(source), entry);
    entriesByName.set(normalizeName(name), [entry]);
    changed = true;
    return circleId;
  }

  return {
    resolve,
    get changed() { return changed; },
    allocations,
    evidence,
    legacyMappings: legacyIdMap.mappings,
  };
}
