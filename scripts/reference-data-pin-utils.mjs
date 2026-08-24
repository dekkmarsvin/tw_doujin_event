import { createHash } from "node:crypto";

export const REFERENCE_DATA_PIN_SCHEMA = "reference-data-pin/1";
export const REFERENCE_DATA_REPOSITORY = "dekkmarsvin/tw_doujin_event-reference-data";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const REVISION = /^[a-z0-9][a-z0-9.-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const DATA_PATH = /^data\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.json$/;
const SOURCE_KINDS = new Set(["organizer-official", "venue-official"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function requireKeys(value, required, allowed, label) {
  for (const key of required) if (!(key in value)) fail(`${label} is missing ${key}.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown property ${key}.`);
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || value.trim() === "" || (pattern && !pattern.test(value))) fail(`${label} is invalid.`);
  return value;
}

function requireHttpsUrl(value, label) {
  requireString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is invalid.`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS.`);
}

function normalizeDataPath(value, label) {
  requireString(value, label);
  if (!DATA_PATH.test(value) || value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) fail(`${label} is invalid.`);
  return value;
}

function validateSources(value, label, allowedKinds = SOURCE_KINDS) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must list official sources.`);
  const ids = new Set();
  for (const [index, sourceValue] of value.entries()) {
    const source = requireRecord(sourceValue, `${label}[${index}]`);
    requireKeys(source, ["id", "kind", "url", "retrievedAt"], ["id", "kind", "url", "retrievedAt", "note"], `${label}[${index}]`);
    requireString(source.id, `${label}[${index}].id`, ID);
    if (ids.has(source.id)) fail(`${label} has duplicate source id ${source.id}.`);
    ids.add(source.id);
    if (!allowedKinds.has(source.kind)) fail(`${label}[${index}].kind is invalid.`);
    requireHttpsUrl(source.url, `${label}[${index}].url`);
    if (typeof source.retrievedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(source.retrievedAt)
      || Number.isNaN(Date.parse(source.retrievedAt))) fail(`${label}[${index}].retrievedAt is invalid.`);
    if (source.note !== undefined) requireString(source.note, `${label}[${index}].note`);
  }
  return ids;
}

function validateProvenance(value, sourceIds, requiredPointers, label) {
  const provenance = requireRecord(value, label);
  for (const [pointer, references] of Object.entries(provenance)) {
    if (!pointer.startsWith("/") || !Array.isArray(references) || references.length === 0) fail(`${label}.${pointer} is invalid.`);
    if (new Set(references).size !== references.length) fail(`${label}.${pointer} has duplicate source ids.`);
    for (const sourceId of references) if (!sourceIds.has(sourceId)) fail(`${label}.${pointer} references unknown source ${sourceId}.`);
  }
  for (const pointer of requiredPointers) if (!(pointer in provenance)) fail(`${label} is missing provenance for ${pointer}.`);
}

function parseReferenceRecord(value, relativePath) {
  const record = requireRecord(value, relativePath);
  if (record.schema === "organizer/1") {
    requireKeys(record, ["schema", "id", "name", "officialUrl", "sources", "provenance"], ["schema", "id", "name", "officialUrl", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.name, `${relativePath}.name`);
    requireHttpsUrl(record.officialUrl, `${relativePath}.officialUrl`);
    validateProvenance(record.provenance, validateSources(record.sources, `${relativePath}.sources`, new Set(["organizer-official"])), ["/name", "/officialUrl"], `${relativePath}.provenance`);
    if (relativePath !== `data/organizers/${record.id}.json`) fail(`${relativePath} does not match organizer stable ID ${record.id}.`);
    return record;
  }
  if (record.schema === "category-catalog/1") {
    requireKeys(record, ["schema", "id", "organizerId", "revision", "categories", "sources", "provenance"], ["schema", "id", "organizerId", "revision", "categories", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.organizerId, `${relativePath}.organizerId`, ID);
    requireString(record.revision, `${relativePath}.revision`, REVISION);
    if (!Array.isArray(record.categories) || record.categories.length === 0) fail(`${relativePath}.categories is invalid.`);
    const ids = new Set();
    const requiredPointers = [];
    for (const [index, categoryValue] of record.categories.entries()) {
      const category = requireRecord(categoryValue, `${relativePath}.categories[${index}]`);
      requireKeys(category, ["id", "label"], ["id", "label", "description"], `${relativePath}.categories[${index}]`);
      requireString(category.id, `${relativePath}.categories[${index}].id`, ID);
      requireString(category.label, `${relativePath}.categories[${index}].label`);
      if (ids.has(category.id)) fail(`${relativePath} has duplicate category id ${category.id}.`);
      ids.add(category.id);
      requiredPointers.push(`/categories/${index}/label`);
      if (category.description !== undefined) {
        requireString(category.description, `${relativePath}.categories[${index}].description`);
        requiredPointers.push(`/categories/${index}/description`);
      }
    }
    validateProvenance(record.provenance, validateSources(record.sources, `${relativePath}.sources`, new Set(["organizer-official"])), requiredPointers, `${relativePath}.provenance`);
    const expected = `data/category-catalogs/${record.organizerId}/${record.id}/${record.revision}.json`;
    if (relativePath !== expected) fail(`${relativePath} does not match category catalog identity.`);
    return record;
  }
  if (record.schema === "venue/1") {
    requireKeys(record, ["schema", "id", "name", "officialUrl", "sources", "provenance"], ["schema", "id", "name", "officialUrl", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.name, `${relativePath}.name`);
    requireHttpsUrl(record.officialUrl, `${relativePath}.officialUrl`);
    validateProvenance(record.provenance, validateSources(record.sources, `${relativePath}.sources`), ["/name", "/officialUrl"], `${relativePath}.provenance`);
    if (relativePath !== `data/venues/${record.id}.json`) fail(`${relativePath} does not match venue stable ID ${record.id}.`);
    return record;
  }
  if (record.schema === "venue-space/1") {
    requireKeys(record, ["schema", "id", "venueId", "name", "sources", "provenance"], ["schema", "id", "venueId", "name", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.venueId, `${relativePath}.venueId`, ID);
    requireString(record.name, `${relativePath}.name`);
    validateProvenance(record.provenance, validateSources(record.sources, `${relativePath}.sources`), ["/name"], `${relativePath}.provenance`);
    if (relativePath !== `data/venue-spaces/${record.id}.json`) fail(`${relativePath} does not match venue-space stable ID ${record.id}.`);
    return record;
  }
  fail(`${relativePath} uses unsupported reference schema ${record.schema ?? "(missing)"}.`);
}

function parseIdPath(value, label, category = false) {
  const selection = requireRecord(value, label);
  const keys = category ? ["id", "organizerId", "revision", "path"] : ["id", "path"];
  requireKeys(selection, keys, keys, label);
  requireString(selection.id, `${label}.id`, ID);
  normalizeDataPath(selection.path, `${label}.path`);
  if (category) {
    requireString(selection.organizerId, `${label}.organizerId`, ID);
    requireString(selection.revision, `${label}.revision`, REVISION);
  }
  return selection;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseReferenceDataPin(value) {
  const pin = requireRecord(value, "reference data pin");
  requireKeys(pin, ["schema", "eventId", "repository", "commit", "files", "selection"], ["schema", "eventId", "repository", "commit", "files", "selection"], "reference data pin");
  if (pin.schema !== REFERENCE_DATA_PIN_SCHEMA) fail("Unsupported reference data pin schema.");
  requireString(pin.eventId, "reference data pin eventId", EVENT_ID);
  if (pin.repository !== REFERENCE_DATA_REPOSITORY) fail(`Reference data repository must be ${REFERENCE_DATA_REPOSITORY}.`);
  requireString(pin.commit, "Reference data pin full commit SHA", COMMIT);
  if (!Array.isArray(pin.files) || pin.files.length === 0) fail("Reference data pin must list files.");
  const filePaths = new Set();
  for (const [index, fileValue] of pin.files.entries()) {
    const file = requireRecord(fileValue, `reference data pin files[${index}]`);
    requireKeys(file, ["path", "sha256"], ["path", "sha256"], `reference data pin files[${index}]`);
    normalizeDataPath(file.path, `reference data pin files[${index}].path`);
    requireString(file.sha256, `reference data pin files[${index}].sha256`, HASH);
    if (filePaths.has(file.path)) fail(`Duplicate reference data pin path ${file.path}.`);
    filePaths.add(file.path);
  }
  const selection = requireRecord(pin.selection, "reference data pin selection");
  requireKeys(selection, ["organizer", "categoryCatalog", "venue", "venueSpaces"], ["organizer", "categoryCatalog", "venue", "venueSpaces"], "reference data pin selection");
  parseIdPath(selection.organizer, "reference data pin organizer");
  parseIdPath(selection.categoryCatalog, "reference data pin categoryCatalog", true);
  parseIdPath(selection.venue, "reference data pin venue");
  if (!Array.isArray(selection.venueSpaces) || selection.venueSpaces.length === 0) fail("Reference data pin must select venue spaces.");
  const spaceIds = new Set();
  for (const [index, space] of selection.venueSpaces.entries()) {
    const parsed = parseIdPath(space, `reference data pin venueSpaces[${index}]`);
    if (spaceIds.has(parsed.id)) fail(`Duplicate venue-space stable ID ${parsed.id}.`);
    spaceIds.add(parsed.id);
  }
  for (const selected of [selection.organizer, selection.categoryCatalog, selection.venue, ...selection.venueSpaces]) {
    if (!filePaths.has(selected.path)) fail(`Selected reference path is not pinned: ${selected.path}.`);
  }
  return pin;
}

export function rawReferenceFileUrl(pin, file) {
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${file.path}`;
}

export function verifyReferenceDataFiles(value, filesByPath) {
  const pin = parseReferenceDataPin(value);
  const records = new Map();
  for (const file of pin.files) {
    const bytes = filesByPath.get(file.path);
    if (!bytes) fail(`Pinned reference file is missing: ${file.path}.`);
    const actual = sha256(bytes);
    if (actual !== file.sha256) fail(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}.`);
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      fail(`Pinned reference file is not valid JSON: ${file.path}.`);
    }
    records.set(file.path, parseReferenceRecord(parsed, file.path));
  }
  const { organizer, categoryCatalog, venue, venueSpaces } = pin.selection;
  const organizerRecord = records.get(organizer.path);
  const catalogRecord = records.get(categoryCatalog.path);
  const venueRecord = records.get(venue.path);
  if (organizerRecord?.schema !== "organizer/1" || organizerRecord.id !== organizer.id) fail(`Unknown organizer stable ID ${organizer.id}.`);
  if (catalogRecord?.schema !== "category-catalog/1" || catalogRecord.id !== categoryCatalog.id
    || catalogRecord.organizerId !== categoryCatalog.organizerId || catalogRecord.revision !== categoryCatalog.revision) {
    fail(`Unknown category catalog ${categoryCatalog.organizerId}/${categoryCatalog.id}@${categoryCatalog.revision}.`);
  }
  if (catalogRecord.organizerId !== organizerRecord.id) fail("Category catalog does not belong to the selected organizer.");
  if (venueRecord?.schema !== "venue/1" || venueRecord.id !== venue.id) fail(`Unknown venue stable ID ${venue.id}.`);
  for (const selected of venueSpaces) {
    const record = records.get(selected.path);
    if (record?.schema !== "venue-space/1" || record.id !== selected.id) fail(`Unknown venue-space stable ID ${selected.id}.`);
    if (record.venueId !== venueRecord.id) fail(`Venue-space ${selected.id} does not belong to venue ${venueRecord.id}.`);
  }
  return { pin, records };
}
