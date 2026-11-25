const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const SOURCE_KINDS = new Set(["organizer-official", "venue-official"]);

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

export function requireHttpsUrl(value, label) {
  requireString(value, label);
  if (!value.startsWith("https://")) fail(`${label} must use HTTPS.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is invalid.`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS.`);
}

export function requireTimestamp(value, label) {
  requireString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) fail(`${label} must be an ISO timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText ?? "0", offsetMinuteText ?? "0",
  ].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
    || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp.`);
}

export function validateReferenceSources(value, label, allowedKinds = SOURCE_KINDS) {
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
    requireTimestamp(source.retrievedAt, `${label}[${index}].retrievedAt`);
    if (source.note !== undefined) requireString(source.note, `${label}[${index}].note`);
  }
  return ids;
}

export function validateReferenceProvenance(value, sourceIds, requiredPointers, label) {
  const provenance = requireRecord(value, label);
  for (const [pointer, references] of Object.entries(provenance)) {
    if (!pointer.startsWith("/") || !Array.isArray(references) || references.length === 0) fail(`${label}.${pointer} is invalid.`);
    if (new Set(references).size !== references.length) fail(`${label}.${pointer} has duplicate source ids.`);
    for (const sourceId of references) if (!sourceIds.has(sourceId)) fail(`${label}.${pointer} references unknown source ${sourceId}.`);
  }
  for (const pointer of requiredPointers) if (!(pointer in provenance)) fail(`${label} is missing provenance for ${pointer}.`);
}
