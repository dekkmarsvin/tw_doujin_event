import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REFERENCE_SELECTION_FILE,
  isReferencePath,
  parseEventDataPin,
  rawFileUrl,
  referenceDataFiles,
  sha256,
} from "./event-data-pin-utils.mjs";
import { verifyReferenceFiles } from "./reference-selection-utils.mjs";
import { recoverInterruptedReplacement, replaceVerifiedTrees } from "./verified-tree-replace.mjs";
import { parseJsonBytesStrict } from "./strict-json-file.mjs";

/**
 * Where a pinned repository path lands inside the workspace tree. The event's
 * own files sit at the root, because the rest of the pipeline reads them by
 * bare name; `references/` keeps its repository path so a selection path
 * resolves against disk verbatim.
 */
function workspaceRelativePath(pin, filePath) {
  return isReferencePath(filePath) ? filePath : filePath.slice(`events/${pin.eventId}/`.length);
}

/**
 * Downloads one pinned commit into a sibling temporary directory, verifies
 * every byte against the pin and the reference selection, and returns the
 * staged tree without installing it.
 */
export async function stageEventData(value, destination, fetchImpl = globalThis.fetch, fileSystemOverrides = {}) {
  const pin = parseEventDataPin(value);
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  await recoverInterruptedReplacement(destination, fileSystemOverrides);
  const temporary = await mkdtemp(path.join(parent, `.tmp-${pin.eventId}-`));
  try {
    for (const file of pin.files) {
      const response = await fetchImpl(rawFileUrl(pin, file), { redirect: "error" });
      if (!response.ok) throw new Error(`Failed to fetch ${file.path}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}`);
      const output = path.join(temporary, workspaceRelativePath(pin, file.path));
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }

    // Verified before anything is installed, so a pin whose bytes hash
    // correctly but whose selection is wrong still fails closed.
    let selection;
    try {
      selection = parseJsonBytesStrict(
        await readFile(path.join(temporary, REFERENCE_SELECTION_FILE)),
        `Pinned ${REFERENCE_SELECTION_FILE}`,
      );
    } catch {
      throw new Error(`Pinned ${REFERENCE_SELECTION_FILE} is not valid UTF-8 JSON.`);
    }
    const referenceBytes = new Map(await Promise.all(referenceDataFiles(pin).map(async (file) => [
      file.path,
      await readFile(path.join(temporary, file.path)),
    ])));
    verifyReferenceFiles(selection, referenceBytes, pin.eventId);

    return { pin, temporary };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function fetchEventData(value, destination, fetchImpl = globalThis.fetch, fileSystemOverrides = {}) {
  const staged = await stageEventData(value, destination, fetchImpl, fileSystemOverrides);
  try {
    await replaceVerifiedTrees([{ temporary: staged.temporary, destination }], fileSystemOverrides);
    return staged.pin;
  } catch (error) {
    await rm(staged.temporary, { recursive: true, force: true });
    throw error;
  }
}
