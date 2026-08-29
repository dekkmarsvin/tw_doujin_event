import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EVENT_DATA_PIN_SCHEMA,
  EVENT_DATA_REPOSITORY,
  EVENT_FILE_NAMES,
  REFERENCE_SELECTION_FILE,
  assertEventDataLocator,
  eventFilePath,
  parseEventDataPin,
  rawFileUrl,
  sha256,
} from "./event-data-pin-utils.mjs";
import {
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "./reference-selection-utils.mjs";
import { replaceVerifiedTrees } from "./verified-tree-replace.mjs";
import { parseJsonBytesStrict } from "./strict-json-file.mjs";

export function onboardingWorkspaceReplacements(root, workspace, eventId) {
  return [
    {
      temporary: path.join(workspace, ".event-data", eventId),
      destination: path.join(root, ".event-data", eventId),
    },
    {
      temporary: path.join(workspace, "public", "data", "events"),
      destination: path.join(root, "public", "data", "events"),
    },
    {
      temporary: path.join(workspace, ".event-data-stage.json"),
      destination: path.join(root, ".event-data-stage.json"),
    },
    {
      temporary: path.join(workspace, "data", "circle-identities"),
      destination: path.join(root, "data", "circle-identities"),
    },
  ];
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

/**
 * Two passes, because the shared repository made the reference file set
 * event-specific. The first pass fetches the event folder, which is a fixed
 * list of names. Only after `reference-selection.json` is in hand does the
 * second pass know which `references/` files this event resolves.
 */
export async function prepareEventOnboarding({ eventId, commit, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  assertEventDataLocator(eventId, commit);
  const locator = { repository: EVENT_DATA_REPOSITORY, commit };
  async function fetchPinned(filePath) {
    return fetchBytes(rawFileUrl(locator, { path: filePath }), filePath, fetchImpl);
  }

  const bytesByPath = new Map();
  for (const name of EVENT_FILE_NAMES) {
    const filePath = eventFilePath(eventId, name);
    bytesByPath.set(filePath, await fetchPinned(filePath));
  }

  const selection = parseReferenceSelection(parseJsonBytesStrict(
    bytesByPath.get(eventFilePath(eventId, REFERENCE_SELECTION_FILE)),
    `Pinned ${REFERENCE_SELECTION_FILE}`,
  ));
  if (selection.eventId !== eventId) {
    throw new Error(`Reference selection identity mismatch: expected ${eventId}, got ${selection.eventId}.`);
  }

  const referenceBytes = new Map();
  for (const filePath of referenceSelectionPaths(selection).sort()) {
    const bytes = await fetchPinned(filePath);
    referenceBytes.set(filePath, bytes);
    bytesByPath.set(filePath, bytes);
  }

  const verified = verifyReferenceFiles(selection, referenceBytes, eventId);
  const event = parseJsonBytesStrict(bytesByPath.get(eventFilePath(eventId, "event.json")), "Pinned event.json");
  selectEventReferenceRecords(selection, verified.records, event);

  const pin = parseEventDataPin({
    schema: EVENT_DATA_PIN_SCHEMA,
    eventId,
    repository: EVENT_DATA_REPOSITORY,
    commit,
    files: [...bytesByPath].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) })),
  });
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
  const validationWorkspace = path.join(temporaryDirectory, "workspace");
  const destination = path.join(pinDirectory, `${eventId}.json`);
  try {
    await writeFile(temporaryPin, prepared.serialized);
    await mkdir(validationWorkspace);
    const validation = await validate(temporaryPin, validationWorkspace);
    const replacements = validation?.replacements ?? [];
    for (const replacement of replacements) await mkdir(path.dirname(replacement.destination), { recursive: true });
    await replaceVerifiedTrees([
      ...replacements,
      { temporary: temporaryPin, destination },
    ], fileSystemOverrides);
    return { ...prepared, destination };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
