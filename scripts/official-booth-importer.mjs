import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { replaceVerifiedTrees } from "./verified-tree-replace.mjs";

const FORMATS = new Set(["csv", "tsv", "html"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}.`);
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function parseDelimited(text, delimiter) {
  const input = String(text ?? "").replace(/^\uFEFF/u, "");
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  function finishRow() {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
    rowLine = line;
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (character === '"' && cell === "") quoted = true;
    else if (character === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      line += 1;
      finishRow();
      rowLine = line;
    } else cell += character;
  }
  if (quoted) throw new Error(`Delimited input has an unterminated quoted field starting on line ${rowLine}.`);
  if (cell !== "" || cells.length > 0 || (input.length > 0 && !/[\r\n]$/u.test(input))) finishRow();
  return rows;
}

function decodeHtml(value) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "],
  ]);
  return value
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
      if (entity[0] === "#") {
        const hexadecimal = entity[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        try { return String.fromCodePoint(codePoint); } catch { return match; }
      }
      return named.get(entity.toLowerCase()) ?? match;
    });
}

function positiveSpan(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:["'](\\d+)["']|(\\d+))`, "iu").exec(attributes);
  if (!match) return 1;
  const value = Number(match[1] ?? match[2]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`HTML table has an invalid ${name}.`);
  return value;
}

function parseHtml(text) {
  const input = String(text ?? "");
  const tables = [...input.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)];
  if (tables.length !== 1) throw new Error(`HTML input must contain exactly one table; found ${tables.length}.`);
  const table = tables[0];
  const rows = [];
  const spans = new Map();
  for (const rowMatch of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [];
    for (const [column, span] of spans) {
      cells[column] = span.value;
      span.remaining -= 1;
      if (span.remaining === 0) spans.delete(column);
    }
    let column = 0;
    const cellMatches = [...rowMatch[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/giu)];
    if (cellMatches.length === 0) continue;
    for (const cellMatch of cellMatches) {
      while (cells[column] !== undefined) column += 1;
      const value = normalizedText(decodeHtml(cellMatch[3]));
      const colspan = positiveSpan(cellMatch[2], "colspan");
      const rowspan = positiveSpan(cellMatch[2], "rowspan");
      for (let offset = 0; offset < colspan; offset += 1) {
        if (cells[column + offset] !== undefined) throw new Error("HTML table has overlapping spans.");
        cells[column + offset] = value;
        if (rowspan > 1) spans.set(column + offset, { value, remaining: rowspan - 1 });
      }
      column += colspan;
    }
    const absoluteIndex = (table.index ?? 0) + (rowMatch.index ?? 0);
    rows.push({ line: input.slice(0, absoluteIndex).split(/\r\n|\r|\n/u).length, cells });
  }
  if (spans.size > 0) throw new Error("HTML table rowspan extends beyond the last row.");
  return rows;
}

export function parseOfficialBoothImportTable(text, format) {
  if (!FORMATS.has(format)) throw new Error(`Unsupported official booth import format ${format}.`);
  const parsed = format === "html" ? parseHtml(text) : parseDelimited(text, format === "csv" ? "," : "\t");
  const rows = parsed.filter((row) => row.cells.some((cell) => normalizedText(cell) !== ""));
  if (rows.length < 2) throw new Error("Official booth input must contain a header and at least one data row.");
  return { format, rows };
}

function eventImportDefinition(event) {
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

function mappedDay(mapping, row, daySet) {
  if (mapping.fixedDay !== undefined && mapping.fixedDay !== null && String(mapping.fixedDay).trim() !== "") {
    const fixed = String(mapping.fixedDay);
    return daySet.has(fixed) ? fixed : null;
  }
  const raw = normalizedText(row.cells[mapping.dayColumn]);
  const mapped = mapping.dayValues instanceof Map ? mapping.dayValues.get(raw) : mapping.dayValues?.[raw];
  const value = mapped === undefined || mapped === null ? null : String(mapped);
  return value && daySet.has(value) ? value : null;
}

function boothCodes(value) {
  return normalizedText(value).split(/[\s,，、;；/]+/u).filter(Boolean);
}

function placementCodeKey(value) {
  return value.toLocaleLowerCase("en-US");
}

export function prepareOfficialBoothImport({ table, event, mapping, headerRow = 1, requireEveryDay = true }) {
  const { event: validatedEvent, dayIds, daySet } = eventImportDefinition(event);
  if (!isRecord(table) || !Array.isArray(table.rows)) throw new Error("Parsed official booth table is required.");
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow >= table.rows.length) {
    throw new Error("Header row must select a row before the imported data.");
  }
  if (!isRecord(mapping) || !Number.isInteger(mapping.boothColumn) || !Number.isInteger(mapping.circleColumn)
    || ((mapping.fixedDay === undefined || mapping.fixedDay === null) && !Number.isInteger(mapping.dayColumn))) {
    throw new Error("Official booth column mapping is incomplete.");
  }
  const usesDayColumn = mapping.fixedDay === undefined || mapping.fixedDay === null;
  const mappedColumns = [mapping.boothColumn, mapping.circleColumn, ...(usesDayColumn ? [mapping.dayColumn] : [])];
  if (mappedColumns.some((column) => column < 0) || new Set(mappedColumns).size !== mappedColumns.length) {
    throw new Error("Official booth column mapping must use distinct non-negative columns.");
  }

  const errors = [];
  const candidates = [];
  const groups = new Map(dayIds.map((day) => [day, []]));
  const usedCodes = new Map(dayIds.map((day) => [day, new Map()]));
  for (const row of table.rows.slice(headerRow)) {
    const day = mappedDay(mapping, row, daySet);
    const codes = boothCodes(row.cells[mapping.boothColumn]);
    const name = normalizedText(row.cells[mapping.circleColumn]);
    if (!day) errors.push({ row: row.line, code: "unmapped_day", message: "day/period is missing or not explicitly mapped to this event" });
    if (codes.length === 0) errors.push({ row: row.line, code: "missing_booth", message: "booth code is missing" });
    if (!name) errors.push({ row: row.line, code: "missing_circle", message: "circle name is missing" });
    if (!day || codes.length === 0 || !name) continue;
    const rowCodeKeys = codes.map(placementCodeKey);
    if (new Set(rowCodeKeys).size !== codes.length) {
      const duplicateIndex = rowCodeKeys.findIndex((key, index) => rowCodeKeys.indexOf(key) !== index);
      errors.push({ row: row.line, code: "duplicate_booth", message: `booth ${codes[duplicateIndex]} collapses to a repeated placement ID in the same row` });
      continue;
    }
    let duplicate = false;
    for (const code of codes) {
      const previous = usedCodes.get(day).get(placementCodeKey(code));
      if (previous !== undefined) {
        errors.push({ row: row.line, code: "duplicate_booth", message: `booth ${code} for day ${day} collapses to the same placement ID as ${previous.code} from row ${previous.row}` });
        duplicate = true;
      }
    }
    if (duplicate) continue;
    codes.forEach((code) => usedCodes.get(day).set(placementCodeKey(code), { code, row: row.line }));
    groups.get(day).push({ codes, name });
    candidates.push({ day, codes, name, sourceRow: row.line });
  }
  if (requireEveryDay) {
    for (const day of dayIds) {
      if (groups.get(day).length === 0) errors.push({ row: null, code: "missing_day", message: `no booth rows were imported for event day ${day}` });
    }
  }
  const payload = {
    schemaVersion: 1,
    days: validatedEvent.days.map(({ id }) => ({
      day: id,
      url: validatedEvent.officialData.boothListUrls[String(id)],
      booths: groups.get(String(id)),
    })).filter((day) => requireEveryDay || day.booths.length > 0),
  };
  if (errors.length === 0 && requireEveryDay) parseOfficialBoothData(payload, validatedEvent);
  return {
    header: table.rows[headerRow - 1].cells.map(normalizedText),
    importedRows: [...groups.values()].reduce((count, booths) => count + booths.length, 0),
    boothCount: [...usedCodes.values()].reduce((count, codes) => count + codes.size, 0),
    candidates,
    errors,
    payload: errors.length === 0 ? payload : null,
  };
}

export function mergeOfficialBoothImports(previews, event) {
  const { event: validatedEvent, dayIds } = eventImportDefinition(event);
  if (!Array.isArray(previews) || previews.length === 0) throw new Error("At least one official booth import preview is required.");
  const errors = [];
  const groups = new Map(dayIds.map((day) => [day, []]));
  const seenCodes = new Map(dayIds.map((day) => [day, new Map()]));
  for (const [previewIndex, preview] of previews.entries()) {
    if (!isRecord(preview) || preview.errors?.length > 0 || !isRecord(preview.payload)) {
      errors.push({ row: null, code: "invalid_batch", message: `import batch ${previewIndex + 1} has unresolved errors` });
      continue;
    }
    for (const day of preview.payload.days ?? []) {
      const dayId = String(day.day);
      if (!groups.has(dayId) || day.url !== validatedEvent.officialData.boothListUrls[dayId] || !Array.isArray(day.booths)) {
        errors.push({ row: null, code: "invalid_batch", message: `import batch ${previewIndex + 1} does not match the event` });
        continue;
      }
      for (const group of day.booths) {
        let duplicate = false;
        for (const code of group.codes) {
          const previous = seenCodes.get(dayId).get(placementCodeKey(code));
          if (previous !== undefined) {
            errors.push({ row: null, code: "duplicate_booth", message: `booth ${code} for day ${dayId} collapses to the same placement ID as ${previous.code} from import batch ${previous.batch}` });
            duplicate = true;
          }
        }
        if (duplicate) continue;
        group.codes.forEach((code) => seenCodes.get(dayId).set(placementCodeKey(code), { code, batch: previewIndex + 1 }));
        groups.get(dayId).push(group);
      }
    }
  }
  for (const day of dayIds) {
    if (groups.get(day).length === 0) errors.push({ row: null, code: "missing_day", message: `no booth rows were imported for event day ${day}` });
  }
  const payload = {
    schemaVersion: 1,
    days: validatedEvent.days.map(({ id }) => ({
      day: id,
      url: validatedEvent.officialData.boothListUrls[String(id)],
      booths: groups.get(String(id)),
    })),
  };
  if (errors.length === 0) parseOfficialBoothData(payload, validatedEvent);
  return {
    errors,
    payload: errors.length === 0 ? payload : null,
    importedRows: [...groups.values()].reduce((count, booths) => count + booths.length, 0),
    boothCount: [...seenCodes.values()].reduce((count, codes) => count + codes.size, 0),
  };
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
      onlyKeys(group, ["codes", "name"], `Official booth group ${id}/${groupIndex}`);
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

async function exists(target) {
  try { return await lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function writeOfficialBoothCandidate({ workspace, eventId, payload, event, confirmed, fileSystemOverrides = {} }) {
  if (confirmed !== true) throw new Error("Official booth candidate was not confirmed; nothing was written.");
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(eventId ?? "") || event?.id !== eventId) {
    throw new Error("Official booth candidate event identity does not match its destination.");
  }
  parseOfficialBoothData(payload, event);
  const eventDirectory = path.join(path.resolve(workspace), "events", eventId);
  const directoryStat = await exists(eventDirectory);
  if (!directoryStat?.isDirectory()) throw new Error(`Event directory does not exist: ${eventDirectory}.`);
  const destination = path.join(eventDirectory, "official-booths.json");
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    if (await readFile(destination, "utf8") === serialized) return { changed: false, destination };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryRoot = await mkdtemp(path.join(eventDirectory, ".tmp-official-booths-"));
  try {
    const temporary = path.join(temporaryRoot, "official-booths.json");
    await mkdir(path.dirname(temporary), { recursive: true });
    await writeFile(temporary, serialized);
    await replaceVerifiedTrees([{ temporary, destination }], fileSystemOverrides);
    return { changed: true, destination };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
