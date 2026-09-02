import { createHash } from "node:crypto";

export const EVENT_DATA_PIN_SCHEMA = "event-data-pin/2";

// ADR-0039 converged the per-event repositories and the reference repository
// into one. A pin names a commit in that repository and nothing else, so the
// name is a constant rather than a field a pin can point anywhere.
export const EVENT_DATA_REPOSITORY = "dekkmarsvin/tw_doujin_event-data";

// Existing pins carry these four files. New onboarding also pins the reviewed
// identity grouping consumed before catalog staging. Keeping the original four
// as the compatibility floor preserves immutable FF47 pins.
export const REQUIRED_EVENT_FILE_NAMES = Object.freeze([
  "event.json",
  "official-booths.json",
  "map.json",
  "reference-selection.json",
]);
export const CIRCLE_IDENTITY_GROUPS_FILE = "circle-identity-groups.json";
export const EVENT_FILE_NAMES = Object.freeze([
  ...REQUIRED_EVENT_FILE_NAMES,
  CIRCLE_IDENTITY_GROUPS_FILE,
]);

export const REFERENCE_SELECTION_FILE = "reference-selection.json";
export const MAP_MANIFEST_FILE = "map-manifest.json";

/**
 * The Node-side twin of `eventUsesScopedMaps` in `app/event-catalog.ts`. A map
 * artifact covers one day in one hall, so anything beyond a single such pair
 * may need its own layout -- two days in one hall included, because a hall can
 * be re-laid out overnight. It says a manifest is *allowed*, not that one
 * exists: whether an event actually ships one is decided by the file being
 * there, which is what the pin rules below already key off.
 */
export function eventUsesScopedMaps(event) {
  return Array.isArray(event?.days) && Array.isArray(event?.venueAssignments)
    && event.days.length * event.venueAssignments.length > 1;
}

const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const REFERENCE_PATH = /^references\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.json$/;
const MAP_ARTIFACT_PATH = /^maps\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.json$/;
const GROUPINGLESS_LEGACY_PINS = new Set([
  "ff47@8c645303fa6838383549fbe8433ece081c514e1e",
]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The identity and revision checks a pin makes, available before a pin exists.
 * Onboarding derives its file list from the fetched data, so it has to reject a
 * branch, a tag or a short SHA here rather than after the first request.
 */
export function assertEventDataLocator(eventId, commit) {
  if (!EVENT_ID.test(eventId ?? "")) throw new Error("Invalid event data pin eventId.");
  if (!COMMIT.test(commit ?? "")) throw new Error("Event data pin must use a full commit SHA.");
}

export function eventFilePath(eventId, name) {
  return `events/${eventId}/${name}`;
}

export function isReferencePath(filePath) {
  return filePath.startsWith("references/");
}

/** The pinned `events/<eventId>/` entries, in pin order. */
export function eventDataFiles(pin) {
  return pin.files.filter((file) => !isReferencePath(file.path));
}

/**
 * The pinned `references/` entries, in pin order. `reference-records.json` is
 * written in this order, so the order is part of the published artifact.
 */
export function referenceDataFiles(pin) {
  return pin.files.filter((file) => isReferencePath(file.path));
}

export function parseEventDataPin(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== EVENT_DATA_PIN_SCHEMA) {
    throw new Error("Unsupported event data pin schema.");
  }
  if (!EVENT_ID.test(value.eventId ?? "")) throw new Error("Invalid event data pin eventId.");
  if (value.repository !== EVENT_DATA_REPOSITORY) {
    throw new Error(`Event data pin repository must be ${EVENT_DATA_REPOSITORY}.`);
  }
  if (!COMMIT.test(value.commit ?? "")) throw new Error("Event data pin must use a full commit SHA.");
  if (!Array.isArray(value.files) || value.files.length === 0) throw new Error("Event data pin must list files.");

  const eventPrefix = `events/${value.eventId}/`;
  const seen = new Set();
  const eventNames = new Set();
  let referenceCount = 0;
  for (const file of value.files) {
    if (!file || typeof file !== "object" || Array.isArray(file) || typeof file.path !== "string"
      || !HASH.test(file.sha256 ?? "")) {
      throw new Error("Invalid event data pin file entry.");
    }
    if (file.path.includes("..") || file.path.includes("\\") || file.path.startsWith("/")) {
      throw new Error(`Invalid event data pin path: ${file.path}.`);
    }
    if (isReferencePath(file.path)) {
      if (!REFERENCE_PATH.test(file.path)) throw new Error(`Invalid event data pin reference path: ${file.path}.`);
      referenceCount += 1;
    } else if (file.path.startsWith(eventPrefix)) {
      const name = file.path.slice(eventPrefix.length);
      if (!EVENT_FILE_NAMES.includes(name) && name !== MAP_MANIFEST_FILE && !MAP_ARTIFACT_PATH.test(name)) {
        throw new Error(`Unexpected event data pin file: ${file.path}.`);
      }
      eventNames.add(name);
    } else {
      throw new Error(`Event data pin path must start with ${eventPrefix} or references/: ${file.path}.`);
    }
    if (seen.has(file.path)) throw new Error(`Duplicate event data pin path: ${file.path}`);
    seen.add(file.path);
  }
  for (const name of REQUIRED_EVENT_FILE_NAMES) {
    if (name === "map.json" && eventNames.has(MAP_MANIFEST_FILE)) continue;
    if (!eventNames.has(name)) throw new Error(`Event data pin is missing ${eventPrefix}${name}.`);
  }
  const mapArtifacts = [...eventNames].filter((name) => MAP_ARTIFACT_PATH.test(name));
  if (eventNames.has(MAP_MANIFEST_FILE) && mapArtifacts.length === 0) {
    throw new Error(`Event data pin has ${eventPrefix}${MAP_MANIFEST_FILE} without map artifacts.`);
  }
  if (!eventNames.has(MAP_MANIFEST_FILE) && mapArtifacts.length > 0) {
    throw new Error(`Event data pin has scoped map artifacts without ${eventPrefix}${MAP_MANIFEST_FILE}.`);
  }
  if (!eventNames.has(CIRCLE_IDENTITY_GROUPS_FILE)
    && !GROUPINGLESS_LEGACY_PINS.has(`${value.eventId}@${value.commit}`)) {
    throw new Error(`Event data pin is missing ${eventPrefix}${CIRCLE_IDENTITY_GROUPS_FILE}.`);
  }
  if (referenceCount === 0) throw new Error("Event data pin must list the references/ files the event resolves.");
  return value;
}

export function parsePinnedMapManifest(value, eventId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== "event-map-manifest/1" || value.eventId !== eventId
    || !Array.isArray(value.maps) || value.maps.length === 0) {
    throw new Error("Invalid event map manifest.");
  }
  const seen = new Set();
  return value.maps.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.periodKey !== "string" || typeof entry.venueSpaceId !== "string"
      || !/^[A-Za-z0-9_-]+$/.test(entry.periodKey) || !/^[A-Za-z0-9_-]+$/.test(entry.venueSpaceId)) {
      throw new Error("Invalid event map manifest scope.");
    }
    const expected = `maps/${entry.periodKey}/${entry.venueSpaceId}.json`;
    if (entry.path !== expected) throw new Error(`Event map manifest path must be ${expected}.`);
    const key = `${entry.periodKey}\0${entry.venueSpaceId}`;
    if (seen.has(key)) throw new Error("Duplicate event map manifest scope.");
    seen.add(key);
    return { periodKey: entry.periodKey, venueSpaceId: entry.venueSpaceId, path: expected };
  });
}

export function rawFileUrl(pin, file) {
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${file.path}`;
}

export function assertEventDataPinIdentity(pin, eventId) {
  if (pin.eventId !== eventId) throw new Error(`Event data pin identity mismatch: expected ${eventId}, got ${pin.eventId}.`);
  return pin;
}
