/**
 * Parsing and comparison for the organizer's daily booth lists (ADR-0012).
 * Kept separate from the two scripts that use it so the failure modes can be
 * tested without a network fetch: a theme change upstream must stop the
 * pipeline, and that is only true if the stopping is covered.
 */

const ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "]]);
const BOOTH_CODE = /^[A-W]\d{2}$/;

export const MINIMUM_ROWS_PER_DAY = 600;

export function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES.get(entity.toLowerCase()) ?? match;
  });
}

/** Names are compared, never rewritten: NFKC and whitespace only. */
export const normalizeName = (value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim();

const cellText = (html) => normalizeName(decodeEntities(html.replace(/<[^>]+>/g, "")));

export const compareBoothKeys = (a, b) => a.localeCompare(b, "en", { numeric: true });

/**
 * Fail closed on every shape the page could take that is not a booth list.
 * Half a booth list published as a full one is worse than no update at all.
 */
export function parseOfficialBoothTable(html, { day, minimumRows = MINIMUM_ROWS_PER_DAY } = {}) {
  const [table] = html.match(/<table[\s\S]*?<\/table>/) ?? [];
  if (!table) throw new Error(`Day ${day} has no booth table; the page layout changed.`);

  const booths = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((match) => cellText(match[1]));
    if (cells.length !== 2) throw new Error(`Day ${day} has a ${cells.length}-column row; expected 攤位編號 and 攤位名稱.`);
    const [rawCodes, name] = cells;
    if (rawCodes === "攤位編號") continue;
    const codes = rawCodes.split(/[,，、\s]+/).map((code) => code.toUpperCase()).filter(Boolean);
    if (!codes.length || !codes.every((code) => BOOTH_CODE.test(code))) {
      throw new Error(`Day ${day} row has an unreadable booth code: ${JSON.stringify(rawCodes)}`);
    }
    if (!name) throw new Error(`Day ${day} booth ${codes.join(",")} has no circle name.`);
    booths.push({ codes, name });
  }

  if (booths.length < minimumRows) {
    throw new Error(`Day ${day} returned only ${booths.length} booth rows; expected at least ${minimumRows}.`);
  }

  const seen = new Map();
  for (const { codes, name } of booths) {
    for (const code of codes) {
      const previous = seen.get(code);
      if (previous && previous !== name) throw new Error(`Day ${day} lists booth ${code} twice with different names: ${previous} / ${name}`);
      seen.set(code, name);
    }
  }

  return booths;
}

/** `${day}:${code}` → circle name, the one key both sides can be compared on. */
export function indexOfficialBooths(snapshot) {
  const index = new Map();
  for (const { day, booths } of snapshot.days) {
    for (const { codes, name } of booths) {
      for (const code of codes) index.set(`${day}:${code}`, normalizeName(name));
    }
  }
  return index;
}

export function indexCatalogBooths(catalog) {
  const index = new Map();
  for (const booth of catalog.booths) index.set(`${booth.day}:${booth.code}`, normalizeName(booth.name));
  return index;
}

export function diffOfficialSnapshots(before, after) {
  const previous = indexOfficialBooths(before);
  const current = indexOfficialBooths(after);
  return {
    added: [...current.keys()].filter((key) => !previous.has(key)).sort(compareBoothKeys),
    removed: [...previous.keys()].filter((key) => !current.has(key)).sort(compareBoothKeys),
    renamed: [...current.entries()]
      .filter(([key, name]) => previous.has(key) && previous.get(key) !== name)
      .map(([key, name]) => ({ key, before: previous.get(key), after: name }))
      .sort((a, b) => compareBoothKeys(a.key, b.key)),
    previous,
    current,
  };
}

/**
 * The official lists own which circle is at which booth; the catalog still owns
 * booth geometry. So agreement, not replacement, is what can be enforced today.
 *
 * A conflict the adjudication file has never seen is drift and stops the build.
 * One already on record does not — blocking on a known backlog only gets the
 * check deleted.
 */
export function compareOfficialWithCatalog({ official, catalog, adjudications }) {
  const officialNames = indexOfficialBooths(official);
  const catalogNames = indexCatalogBooths(catalog);
  const recorded = new Map(adjudications.conflicts.map((entry) => [entry.key, entry]));

  const conflicts = [...officialNames.entries()]
    .filter(([key, name]) => catalogNames.has(key) && catalogNames.get(key) !== name)
    .map(([key, official]) => ({ key, official, catalog: catalogNames.get(key) }))
    .sort((a, b) => compareBoothKeys(a.key, b.key));

  const present = new Set(conflicts.map((conflict) => conflict.key));

  return {
    officialNames,
    catalogNames,
    conflicts,
    missingFromCatalog: [...officialNames.keys()].filter((key) => !catalogNames.has(key)).sort(compareBoothKeys),
    missingFromOfficial: [...catalogNames.keys()].filter((key) => !officialNames.has(key)).sort(compareBoothKeys),
    unrecorded: conflicts.filter(({ key, official, catalog }) => {
      const entry = recorded.get(key);
      return !entry || entry.official !== official || entry.catalog !== catalog;
    }),
    stale: adjudications.conflicts.filter((entry) => !present.has(entry.key)),
    unadjudicated: adjudications.conflicts.filter((entry) => entry.decision === "unadjudicated"),
  };
}
