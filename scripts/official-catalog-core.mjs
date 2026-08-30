export function consumeOrganizerEvidenceKey(consumed, key) {
  if (consumed.has(key)) throw new Error(`Official booth ${key} appears more than once.`);
  consumed.add(key);
}

export function assertExactOrganizerEvidenceCoverage(expected, consumed) {
  const missing = [...expected].filter((key) => !consumed.has(key));
  const unexpected = [...consumed].filter((key) => !expected.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(`Organizer evidence coverage mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`);
  }
}

const normalize = (value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");

/**
 * The official-only catalog: what the organizer currently lists, plus the
 * booths this event allocated and has since retired.
 *
 * Retired booths are the whole reason this is a function rather than a loop
 * over the current list. A reader's favourite and a shared link both carry a
 * `c-xxxxxx`; a circle that withdrew and simply vanished from the catalog would
 * leave those pointing at nothing, which reads as a broken link rather than as
 * "this circle is not attending" (#139, #140).
 */
export function buildOfficialCatalogPayload({ eventId, event, official, evidence }) {
  const defaultArea = event.areas?.[0]?.id;
  if (typeof defaultArea !== "string" || !defaultArea) throw new Error("Event definition must declare a default area.");
  const dayId = (day) => event.days.find((candidate) => String(candidate.id) === String(day))?.id;

  const sourceIndex = new Map();
  /** Booths this event allocated and has since retired, in registry order. */
  const retiredForEvent = [];
  for (const entry of evidence.entries) {
    for (const source of entry.sources) {
      if (source.eventId !== eventId || source.kind !== "organizer-booth") continue;
      if (sourceIndex.has(source.value)) throw new Error(`Organizer source ${source.value} belongs to more than one circle.`);
      sourceIndex.set(source.value, entry);
    }
    for (const source of entry.retiredSources ?? []) {
      if (source.eventId !== eventId || source.kind !== "organizer-booth") continue;
      retiredForEvent.push({ entry, source });
    }
  }

  const circlesById = new Map();
  const placements = [];
  const consumedSources = new Set();
  for (const day of official.days) {
    if (dayId(day.day) === undefined) throw new Error(`Official data contains undeclared day ${day.day}.`);
    for (const group of day.booths) {
      const keys = group.codes.map((code) => `${day.day}:${code}`);
      keys.forEach((key) => consumeOrganizerEvidenceKey(consumedSources, key));
      const entries = keys.map((key) => sourceIndex.get(key));
      if (entries.some((entry) => !entry)) throw new Error(`Official group ${day.day}:${group.codes.join(",")} has no reviewed circle identity.`);
      const ids = new Set(entries.map((entry) => entry.circleId));
      if (ids.size !== 1) throw new Error(`Official group ${day.day}:${group.codes.join(",")} resolves to multiple circle identities.`);
      const [entry] = entries;
      if (normalize(entry.currentName) !== normalize(group.name)) {
        throw new Error(`Organizer name drift for ${day.day}:${group.codes[0]}: evidence=${entry.currentName}, official=${group.name}.`);
      }
      circlesById.set(entry.circleId, { id: entry.circleId, name: group.name });
      for (const code of group.codes) {
        placements.push({
          id: `${day.day}-${code.toLocaleLowerCase("en-US")}`,
          circleId: entry.circleId,
          day: day.day,
          area: defaultArea,
          boothCode: code,
          status: "active",
          tone: "mint",
        });
      }
    }
  }

  assertExactOrganizerEvidenceCoverage(new Set(sourceIndex.keys()), consumedSources);

  for (const { entry, source } of retiredForEvent) {
    const separator = source.value.indexOf(":");
    const day = source.value.slice(0, separator);
    const code = source.value.slice(separator + 1);
    if (dayId(day) === undefined) throw new Error(`Retired organizer source ${source.value} names a day the event does not declare.`);
    // The plain booth id belongs to whoever holds the booth now. After a
    // handover that is someone else, so the departed circle's record takes a
    // qualified id; a booth nobody took keeps the plain one, which is what a
    // link shared while it was still occupied carries.
    const plain = `${day}-${code.toLocaleLowerCase("en-US")}`;
    const id = placements.some((placement) => placement.id === plain) ? `${plain}-${entry.circleId}` : plain;
    if (placements.some((placement) => placement.id === id)) {
      throw new Error(`Retired organizer source ${source.value} cannot be given a unique placement id.`);
    }
    // The circle keeps the name it was published under: the organizer's list no
    // longer carries it, so evidence is the only remaining record of it. It has
    // to stay listed as a circle too — a placement whose circle is absent is not
    // a catalog the reader can project.
    if (!circlesById.has(entry.circleId)) circlesById.set(entry.circleId, { id: entry.circleId, name: entry.currentName });
    placements.push({
      id,
      circleId: entry.circleId,
      day: dayId(day),
      area: defaultArea,
      boothCode: code,
      // A move leaves the circle reachable at its new booth, so a reader can
      // follow it; a withdrawal or a handover leaves nowhere to go.
      status: source.retirement?.kind === "moved" ? "moved" : "cancelled",
      tone: "mint",
    });
  }

  return {
    schema: "circle-catalog/3",
    eventId,
    generatedAt: event.dataUpdatedAt,
    circles: [...circlesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    placements,
  };
}
