import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
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
import {
  recoverInterruptedTreeTransaction,
  replaceVerifiedTreesTransaction,
} from "./verified-tree-replace.mjs";
import { parseJsonBytesStrict } from "./strict-json-file.mjs";

export function onboardingWorkspaceDestinations(root, eventId) {
  return [
    path.join(root, ".event-data", eventId),
    path.join(root, "public", "data", "events"),
    path.join(root, ".event-data-stage.json"),
    path.join(root, "data", "circle-identities"),
  ];
}

export function onboardingWorkspaceReplacements(root, workspace, eventId) {
  const temporaryPaths = [
    path.join(workspace, ".event-data", eventId),
    path.join(workspace, "public", "data", "events"),
    path.join(workspace, ".event-data-stage.json"),
    path.join(workspace, "data", "circle-identities"),
  ];
  return onboardingWorkspaceDestinations(root, eventId).map((destination, index) => ({
    temporary: temporaryPaths[index],
    destination,
  }));
}

export function onboardingTransactionFile(root) {
  return path.join(root, "data", "event-data-pins", ".onboard.transaction.json");
}

function onboardingLockDirectory(root) {
  return path.join(root, "data", "event-data-pins", ".onboard.lock");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function acquireOnboardingLock(root, attempt = 0) {
  const pinDirectory = path.join(root, "data", "event-data-pins");
  const lockDirectory = onboardingLockDirectory(root);
  const candidate = await mkdtemp(path.join(pinDirectory, ".tmp-onboard-lock-"));
  const owner = {
    schema: "event-onboarding-lock/1",
    hostname: hostname(),
    pid: process.pid,
    token: randomUUID(),
  };
  await writeFile(path.join(candidate, "owner.json"), `${JSON.stringify(owner)}\n`);
  try {
    await rename(candidate, lockDirectory);
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
    let activeOwner;
    try {
      activeOwner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    } catch (ownerError) {
      if (ownerError?.code === "ENOENT" && attempt < 2) return acquireOnboardingLock(root, attempt + 1);
      throw new Error("Event onboarding lock ownership cannot be verified.", { cause: ownerError });
    }
    const validOwner = activeOwner?.schema === "event-onboarding-lock/1"
      && typeof activeOwner.hostname === "string"
      && Number.isInteger(activeOwner.pid) && activeOwner.pid > 0
      && typeof activeOwner.token === "string" && activeOwner.token !== "";
    if (!validOwner) throw new Error("Event onboarding lock ownership is invalid.");
    if (activeOwner.hostname !== hostname() || processIsAlive(activeOwner.pid)) {
      throw new Error(`Event onboarding is already active on ${activeOwner.hostname} (PID ${activeOwner.pid}).`);
    }
    await rm(lockDirectory, { recursive: true, force: true });
    if (attempt >= 2) throw new Error("Could not acquire the event onboarding lock.");
    return acquireOnboardingLock(root, attempt + 1);
  }

  return async () => {
    const activeOwner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    if (activeOwner?.token !== owner.token) throw new Error("Event onboarding lock ownership changed before release.");
    await rm(lockDirectory, { recursive: true, force: true });
  };
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
  assertEventDataLocator(eventId, commit);
  const pinDirectory = path.join(root, "data", "event-data-pins");
  await mkdir(pinDirectory, { recursive: true });
  const releaseLock = await acquireOnboardingLock(root);
  try {
    const destination = path.join(pinDirectory, `${eventId}.json`);
    const transactionFile = onboardingTransactionFile(root);
    await recoverInterruptedTreeTransaction(transactionFile, root, fileSystemOverrides);
    const prepared = await prepareEventOnboarding({ eventId, commit, fetchImpl });
    const temporaryDirectory = await mkdtemp(path.join(pinDirectory, `.tmp-onboard-${eventId}-`));
    const temporaryPin = path.join(temporaryDirectory, `${eventId}.json`);
    const validationWorkspace = path.join(temporaryDirectory, "workspace");
    try {
      await writeFile(temporaryPin, prepared.serialized);
      await mkdir(validationWorkspace);
      const validation = await validate(temporaryPin, validationWorkspace);
      const replacements = validation?.replacements ?? [];
      for (const replacement of replacements) await mkdir(path.dirname(replacement.destination), { recursive: true });
      await replaceVerifiedTreesTransaction(
        [...replacements, { temporary: temporaryPin, destination }],
        transactionFile,
        root,
        fileSystemOverrides,
      );
      return { ...prepared, destination };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } finally {
    await releaseLock();
  }
}
