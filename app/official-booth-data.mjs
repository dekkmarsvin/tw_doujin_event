export function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function onlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}.`);
}

export function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function eventImportDefinition(event) {
  if (!isRecord(event) || !Array.isArray(event.days) || event.days.length === 0
    || !isRecord(event.officialData) || !isRecord(event.officialData.boothListUrls)) {
    throw new Error("A validated event definition is required for official booth import.");
  }
  const dayIds = event.days.map(({ id }) => String(id));
  if (new Set(dayIds).size !== dayIds.length) throw new Error("Event day ids must be unique.");
  for (const day of dayIds) {
    const url = event.officialData.boothListUrls[day];
    if (typeof url !== "string" || !url.startsWith("https://")) throw new Error(`Event is missing an official booth URL for day ${day}.`);
  }
  return { event, dayIds, daySet: new Set(dayIds) };
}

export function placementCodeKey(value) {
  return value.toLocaleLowerCase("en-US");
}

export function parseOfficialBoothData(value, event) {
  const { event: validatedEvent, dayIds } = eventImportDefinition(event);
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.days)) throw new Error("Unsupported official booth data schema.");
  onlyKeys(value, ["schemaVersion", "days"], "Official booth data");
  if (value.days.length !== dayIds.length) throw new Error("Official booth data must cover every event day exactly once.");
  const seenDays = new Set();
  for (const [dayIndex, day] of value.days.entries()) {
    if (!isRecord(day)) throw new Error(`Official booth day ${dayIndex} is invalid.`);
    onlyKeys(day, ["day", "url", "booths"], `Official booth day ${dayIndex}`);
    const id = String(day.day);
    if (!dayIds.includes(id) || seenDays.has(id)) throw new Error(`Official booth day ${id} is unknown or duplicated.`);
    seenDays.add(id);
    if (day.url !== validatedEvent.officialData.boothListUrls[id]) throw new Error(`Official booth day ${id} does not use the event's official URL.`);
    if (!Array.isArray(day.booths) || day.booths.length === 0) throw new Error(`Official booth day ${id} has no booths.`);
    const seenCodes = new Set();
    for (const [groupIndex, group] of day.booths.entries()) {
      if (!isRecord(group)) throw new Error(`Official booth group ${id}/${groupIndex} is invalid.`);
      onlyKeys(group, ["codes", "name", "areaId"], `Official booth group ${id}/${groupIndex}`);
      if (group.areaId !== undefined && !validatedEvent.areas?.some((area) => area.id === group.areaId)) {
        throw new Error(`Official booth group ${id}/${groupIndex} has an undeclared area.`);
      }
      if (!Array.isArray(group.codes) || group.codes.length === 0 || !group.codes.every((code) => normalizedText(code) === code && code !== "")) {
        throw new Error(`Official booth group ${id}/${groupIndex} has invalid codes.`);
      }
      if (normalizedText(group.name) !== group.name || group.name === "") throw new Error(`Official booth group ${id}/${groupIndex} has an invalid circle name.`);
      for (const code of group.codes) {
        const placementKey = placementCodeKey(code);
        if (seenCodes.has(placementKey)) throw new Error(`Official booth day ${id} has booth ${code} that collapses to a duplicate placement ID.`);
        seenCodes.add(placementKey);
      }
    }
  }
  return value;
}
