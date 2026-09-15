import { parseCircleIdentityGrouping, planCircleIdentityRegistryUpdate } from "./circle-identity-registry.mjs";
import { isRecord, normalizedText, onlyKeys, parseOfficialBoothData, placementCodeKey } from "./official-booth-data.mjs";

const sourceOf = (placement) => `${placement.dayId}:${placement.code}`;
const locationKey = (placement) => `${placement.dayId}:${placementCodeKey(placement.code)}`;

function referenceUrl(value) {
  if (value === undefined) return undefined;
  let parsed;
  try { parsed = new URL(value); } catch { /* Invalid declarations fail below. */ }
  if (typeof value !== "string" || parsed?.protocol !== "https:" || !parsed.hostname) {
    throw new Error("Amendment reference must be an HTTPS URL.");
  }
  return value;
}

function circleName(value) {
  if (typeof value !== "string" || !normalizedText(value)) throw new Error("Amendment needs a circle name.");
  return normalizedText(value);
}

/**
 * Derive an amendment from a published baseline and explicit declarations.
 * The caller binds the baseline to a published pin and approval snapshot;
 * this pure planner never reads or writes a candidate or public data.
 *
 * withdrawn: { sources, reference? }
 * released:  { sources, circleName, reference? } (one new circle)
 * moved:     { moves: [{ source, to: { dayId, code, areaId } }], reference? }
 * added:     { placements: [{ dayId, code, areaId }], circleName, reference? }
 * Each object also has its explicit `kind`. Sources use `<day>:<code>`.
 */
export function planOrganizerAmendment({ event, official, grouping, allocations, evidence, changes, today }) {
  parseOfficialBoothData(official, event);
  parseCircleIdentityGrouping(grouping, event.id, official);
  // The baseline's declarations are already published. Only new declarations
  // may be applied against its current ownership; old transitions are history.
  const baselineGrouping = { ...structuredClone(grouping), transitions: [], schema: "circle-identity-groups/2" };
  const baseline = planCircleIdentityRegistryUpdate({ eventId: event.id, official, grouping: baselineGrouping, allocations, evidence, today });
  if (baseline.summary.changed) throw new Error("Amendment baseline must already have published circle identities.");
  if (!Array.isArray(changes)) throw new Error("Amendment changes must be a list of explicit declarations.");

  const groups = baselineGrouping.groups.map((group) => ({ ...group }));
  const sourceGroup = new Map(groups.flatMap((group, index) => group.sources.map((source) => [source, index])));
  const owners = new Map(baseline.summary.groups.flatMap((group) => group.sources.map((source) => [source, group])));
  const original = new Map();
  const next = new Map();
  for (const day of official.days) {
    for (const [row, booth] of day.booths.entries()) {
      for (const code of booth.codes) {
        const placement = {
          dayId: String(day.day), code, name: booth.name, areaId: booth.areaId,
          row: `${day.day}/${row}`, group: sourceGroup.get(`${day.day}:${code}`),
        };
        original.set(sourceOf(placement), placement);
        next.set(sourceOf(placement), { ...placement });
      }
    }
  }
  const occupied = new Set([...original.values()].map(locationKey));
  const selected = new Set();
  const transitions = [];
  const impacts = [];
  const select = (sources) => {
    if (!Array.isArray(sources) || sources.length === 0) throw new Error("Amendment must select at least one published booth.");
    const placements = sources.map((source) => {
      if (typeof source !== "string" || !original.has(source)) throw new Error(`Unknown published booth ${source}.`);
      if (selected.has(source)) throw new Error(`Published booth ${source} is declared more than once.`);
      selected.add(source);
      return original.get(source);
    });
    if (new Set(placements.map((placement) => placement.group)).size !== 1) {
      throw new Error("One amendment declaration must select booths belonging to the same circle.");
    }
    return placements;
  };
  const destination = (value) => {
    if (!isRecord(value)) throw new Error("Amendment needs a destination booth.");
    onlyKeys(value, ["dayId", "code", "areaId"], "Amendment destination");
    if (!event.days.some((day) => String(day.id) === value.dayId)
      || typeof value.code !== "string" || normalizedText(value.code) !== value.code || !value.code
      || !event.areas?.some((area) => area.id === value.areaId)) {
      throw new Error("Amendment destination needs a declared day, area and normalized booth code.");
    }
    if (occupied.has(locationKey(value))) throw new Error(`Destination booth ${sourceOf(value)} is already occupied or declared.`);
    occupied.add(locationKey(value));
    return { ...value };
  };
  const view = (placement, circleId) => ({
    source: sourceOf(placement), dayId: placement.dayId, code: placement.code,
    areaId: placement.areaId ?? event.areas[0].id, circleId, name: placement.name,
  });

  changes.forEach((change, index) => {
    if (!isRecord(change)) throw new Error(`Amendment declaration ${index} is invalid.`);
    const allowed = {
      withdrawn: ["sources"], released: ["sources", "circleName"],
      moved: ["moves"], added: ["placements", "circleName"],
    };
    if (!Object.hasOwn(allowed, change.kind)) throw new Error(`Unknown amendment kind ${change.kind}.`);
    onlyKeys(change, ["kind", "reference", ...allowed[change.kind]], "Amendment declaration");
    const reference = referenceUrl(change.reference);
    const before = change.kind === "added" ? [] : select(change.kind === "moved"
      ? (Array.isArray(change.moves) ? change.moves.map((move) => move?.source) : null)
      : change.sources);
    const after = [];
    const group = ["added", "released"].includes(change.kind) ? groups.push({ sources: [] }) - 1 : before[0].group;
    const name = ["added", "released"].includes(change.kind) ? circleName(change.circleName) : before[0].name;

    if (change.kind === "added") {
      if (!Array.isArray(change.placements) || change.placements.length === 0) throw new Error("Added circle must declare at least one booth.");
      for (const value of change.placements) after.push({ ...destination(value), name, group, row: `added/${index}` });
    } else {
      before.forEach((placement, moveIndex) => {
        const source = sourceOf(placement);
        next.delete(source);
        const transition = { source, kind: change.kind, areaId: placement.areaId ?? event.areas[0].id,
          ...(reference ? { reference } : {}) };
        if (change.kind === "released") after.push({ ...placement, name, group, row: `released/${index}` });
        if (change.kind === "moved") {
          const move = change.moves[moveIndex];
          onlyKeys(move, ["source", "to"], "Amendment move");
          const to = destination(move.to);
          transition.to = sourceOf(to);
          after.push({ ...to, name, group, row: `moved/${index}` });
        }
        transitions.push(transition);
      });
    }
    for (const placement of after) next.set(sourceOf(placement), placement);
    // Splitting an official row (partial handover/move) must retain the already
    // reviewed identity grouping. The declaration supplies traceable linkage
    // when that group now spans multiple rows or days.
    const touched = new Set([...before, ...after].map((placement) => placement.group));
    for (const id of touched) {
      if (!groups[id].linkage) groups[id].linkage = {
        kind: "manual-organizer-evidence",
        value: `amendment:${index}:${[...before, ...after].map(sourceOf).join(",")}`,
        reference: reference ?? event.officialData.boothListUrls[(before[0] ?? after[0]).dayId],
      };
    }
    impacts.push({ kind: change.kind, ...(reference ? { reference } : {}),
      before: before.map((placement) => view(placement, owners.get(sourceOf(placement)).circleId)), after });
  });

  const nextOfficial = { schemaVersion: 1, days: official.days.map((day) => {
    const rows = new Map();
    for (const placement of next.values()) {
      if (placement.dayId !== String(day.day)) continue;
      const key = `${placement.row}\0${placement.group}\0${placement.areaId ?? ""}`;
      if (!rows.has(key)) rows.set(key, { codes: [], name: placement.name,
        ...(placement.areaId === undefined ? {} : { areaId: placement.areaId }) });
      rows.get(key).codes.push(placement.code);
    }
    return { ...day, booths: [...rows.values()] };
  }) };
  const nextGrouping = { schema: "circle-identity-groups/2", eventId: event.id,
    groups: groups.map((group, index) => ({ ...group,
      sources: [...next.values()].filter((placement) => placement.group === index).map(sourceOf),
    })).filter((group) => group.sources.length), transitions };
  parseOfficialBoothData(nextOfficial, event);
  const registry = planCircleIdentityRegistryUpdate({ eventId: event.id, official: nextOfficial, grouping: nextGrouping, allocations, evidence, today });
  const nextOwners = new Map(registry.summary.groups.flatMap((group) => group.sources.map((source) => [source, group.circleId])));
  return {
    official: nextOfficial, grouping: nextGrouping, allocations: registry.allocations, evidence: registry.evidence,
    impact: impacts.map((impact) => ({ ...impact, after: impact.after.map((placement) => view(placement, nextOwners.get(sourceOf(placement)))) })),
    summary: registry.summary,
  };
}
