/**
 * One event's organizer-reviewed rows. Names link days only when the organizer
 * supplied no internal identifiers for that name. Explicit identifiers always
 * win; neither booth code, area nor venue space is a circle identity.
 *
 * @typedef {{ dayId: string, circleName: string, stableKey: string | null, codes: string[] }} CircleRow
 */
const nameKey = (name) => name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");

/** @param {readonly CircleRow[]} rows */
export function groupOrganizerCircles(rows, { mergeCrossDayNames = true } = {}) {
  /** @type {Map<string, { days: Set<string>, hasStableKey: boolean }>} */
  const names = new Map();
  for (const row of rows) {
    const name = nameKey(row.circleName);
    const facts = names.get(name) ?? { days: new Set(), hasStableKey: false };
    facts.days.add(row.dayId);
    facts.hasStableKey ||= !!row.stableKey;
    names.set(name, facts);
  }
  /** @type {Map<string, { key: string, name: string, kind: "stable" | "name" | "row", value: string, rowIndexes: number[], days: string[] }>} */
  const groups = new Map();
  rows.forEach((row, index) => {
    const name = nameKey(row.circleName);
    const facts = names.get(name);
    const byName = mergeCrossDayNames && name && !facts.hasStableKey && facts.days.size > 1;
    const kind = row.stableKey ? "stable" : byName ? "name" : "row";
    const value = row.stableKey || (byName ? name : String(index));
    const key = `${kind}:${value}`;
    const group = groups.get(key) ?? { key, name: row.circleName, kind, value, rowIndexes: [], days: [] };
    group.rowIndexes.push(index);
    if (!group.days.includes(row.dayId)) group.days.push(row.dayId);
    groups.set(key, group);
  });
  return [...groups.values()];
}

/**
 * The caller supplies the reviewed official source and scopes rows to one
 * event. The approval snapshot fixes the rows; name linkage is a declaration
 * by that organizer, never an invented organizer-stable-key.
 * @param {string} eventId
 * @param {readonly CircleRow[]} rows
 * @param {string} reference
 */
export function buildOrganizerCircleGrouping(eventId, rows, reference, options = {}) {
  return {
    schema: "circle-identity-groups/1", eventId,
    groups: groupOrganizerCircles(rows, options).map((group) => ({
      sources: group.rowIndexes.flatMap((index) => rows[index].codes.map((code) => `${rows[index].dayId}:${code}`)),
      ...(group.kind === "row" ? {} : { linkage: {
        kind: group.kind === "stable" ? "organizer-stable-key" : "manual-organizer-evidence",
        value: group.kind === "stable" ? group.value : `reviewed-cross-day-name:${group.value}`,
        reference,
      } }),
    })),
  };
}
