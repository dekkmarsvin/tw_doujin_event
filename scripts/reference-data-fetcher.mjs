import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseReferenceDataPin, rawReferenceFileUrl, verifyReferenceDataFiles } from "./reference-data-pin-utils.mjs";

async function pathExists(target, lstatImpl) {
  try {
    await lstatImpl(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fileSystem(overrides = {}) {
  return {
    lstat: overrides.lstat ?? lstat,
    rename: overrides.rename ?? rename,
    rm: overrides.rm ?? rm,
  };
}

export async function recoverInterruptedReferenceReplacement(destination, overrides = {}) {
  const fs = fileSystem(overrides);
  const backup = `${destination}.previous`;
  const destinationExists = await pathExists(destination, fs.lstat);
  const backupExists = await pathExists(backup, fs.lstat);
  if (!destinationExists && backupExists) {
    await fs.rename(backup, destination);
  } else if (destinationExists && backupExists) {
    await fs.rm(backup, { recursive: true, force: true });
  }
}

export async function replaceReferenceTree(temporary, destination, overrides = {}) {
  return replaceVerifiedTrees([{ temporary, destination }], overrides);
}

export async function replaceVerifiedTrees(replacements, overrides = {}) {
  const fs = fileSystem(overrides);
  const states = replacements.map(({ temporary, destination }) => ({
    temporary,
    destination,
    backup: `${destination}.previous`,
    hadPrevious: false,
    installed: false,
  }));
  for (const state of states) {
    await recoverInterruptedReferenceReplacement(state.destination, fs);
    state.hadPrevious = await pathExists(state.destination, fs.lstat);
  }
  try {
    for (const state of states) {
      if (state.hadPrevious) await fs.rename(state.destination, state.backup);
    }
    for (const state of states) {
      await fs.rename(state.temporary, state.destination);
      state.installed = true;
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.installed && await pathExists(state.destination, fs.lstat)) {
        await fs.rm(state.destination, { recursive: true, force: true });
      }
      if (state.hadPrevious && !await pathExists(state.destination, fs.lstat) && await pathExists(state.backup, fs.lstat)) {
        await fs.rename(state.backup, state.destination);
      }
    }
    throw error;
  }
  for (const state of states) {
    if (state.hadPrevious) await fs.rm(state.backup, { recursive: true, force: true });
  }
}

export async function stageReferenceData(value, destination, fetchImpl = globalThis.fetch, fileSystemOverrides = {}) {
  const pin = parseReferenceDataPin(value);
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  await recoverInterruptedReferenceReplacement(destination, fileSystemOverrides);
  const temporary = await mkdtemp(path.join(parent, `.tmp-reference-${pin.eventId}-`));
  const filesByPath = new Map();
  try {
    for (const file of pin.files) {
      const response = await fetchImpl(rawReferenceFileUrl(pin, file), { redirect: "error" });
      if (!response.ok) throw new Error(`Failed to fetch ${file.path}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      filesByPath.set(file.path, bytes);
      const output = path.join(temporary, file.path);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }
    verifyReferenceDataFiles(pin, filesByPath);
    return { pin, temporary };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function fetchReferenceData(value, destination, fetchImpl = globalThis.fetch, fileSystemOverrides = {}) {
  const staged = await stageReferenceData(value, destination, fetchImpl, fileSystemOverrides);
  try {
    await replaceReferenceTree(staged.temporary, destination, fileSystemOverrides);
    return staged.pin;
  } catch (error) {
    await rm(staged.temporary, { recursive: true, force: true });
    throw error;
  }
}
