import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EVENT_DATA_PIN_SCHEMA,
  parseEventDataPin,
  rawFileUrl,
  sha256,
} from "./event-data-pin-utils.mjs";
import { replaceVerifiedTrees } from "./reference-data-fetcher.mjs";
import {
  parseReferenceDataPin,
  rawReferenceFileUrl,
  selectEventReferenceRecords,
  verifyReferenceDataFiles,
} from "./reference-data-pin-utils.mjs";
import { parseJsonBytesStrict } from "./strict-json-file.mjs";

export const EVENT_DATA_FILES = Object.freeze([
  "event.json",
  "official-booths.json",
  "map.json",
  "reference-data-pin.json",
]);

function repositoryFor(eventId) {
  return `dekkmarsvin/tw_doujin_event-data-${eventId}`;
}

async function fetchBytes(url, label, fetchImpl) {
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response.ok) throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export function serializeEventDataPin(value) {
  const pin = parseEventDataPin(value);
  const files = pin.files.map(
    (file) => `    { "path": ${JSON.stringify(file.path)}, "sha256": ${JSON.stringify(file.sha256)} }`,
  );
  return [
    "{",
    `  "schema": ${JSON.stringify(pin.schema)},`,
    `  "eventId": ${JSON.stringify(pin.eventId)},`,
    `  "repository": ${JSON.stringify(pin.repository)},`,
    `  "commit": ${JSON.stringify(pin.commit)},`,
    "  \"files\": [",
    files.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

export async function prepareEventOnboarding({ eventId, commit, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const seedPin = parseEventDataPin({
    schema: EVENT_DATA_PIN_SCHEMA,
    eventId,
    repository: repositoryFor(eventId),
    commit,
    files: EVENT_DATA_FILES.map((filePath) => ({ path: filePath, sha256: "0".repeat(64) })),
  });
  const eventFiles = new Map();
  for (const file of seedPin.files) {
    eventFiles.set(file.path, await fetchBytes(rawFileUrl(seedPin, file), file.path, fetchImpl));
  }
  const pin = parseEventDataPin({
    ...seedPin,
    files: seedPin.files.map((file) => ({ path: file.path, sha256: sha256(eventFiles.get(file.path)) })),
  });

  const referencePin = parseReferenceDataPin(parseJsonBytesStrict(
    eventFiles.get("reference-data-pin.json"),
    "Pinned reference-data-pin.json",
  ));
  if (referencePin.eventId !== eventId) {
    throw new Error(`Reference data pin identity mismatch: expected ${eventId}, got ${referencePin.eventId}.`);
  }
  const referenceFiles = new Map();
  for (const file of referencePin.files) {
    referenceFiles.set(
      file.path,
      await fetchBytes(rawReferenceFileUrl(referencePin, file), `reference data ${file.path}`, fetchImpl),
    );
  }
  const verified = verifyReferenceDataFiles(referencePin, referenceFiles);
  const event = parseJsonBytesStrict(eventFiles.get("event.json"), "Pinned event.json");
  selectEventReferenceRecords(referencePin, verified.records, event);
  return { pin, serialized: serializeEventDataPin(pin) };
}

export async function onboardEvent({
  eventId,
  commit,
  root,
  fetchImpl = globalThis.fetch,
  validate = async () => {},
  fileSystemOverrides = {},
}) {
  const prepared = await prepareEventOnboarding({ eventId, commit, fetchImpl });
  const pinDirectory = path.join(root, "data", "event-data-pins");
  await mkdir(pinDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(pinDirectory, `.tmp-onboard-${eventId}-`));
  const temporaryPin = path.join(temporaryDirectory, `${eventId}.json`);
  const destination = path.join(pinDirectory, `${eventId}.json`);
  try {
    await writeFile(temporaryPin, prepared.serialized);
    await validate(temporaryPin);
    await replaceVerifiedTrees([{ temporary: temporaryPin, destination }], fileSystemOverrides);
    return { ...prepared, destination };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
