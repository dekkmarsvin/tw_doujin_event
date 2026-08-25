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
  const fs = fileSystem(overrides);
  const backup = `${destination}.previous`;
  await recoverInterruptedReferenceReplacement(destination, fs);
  const hadPrevious = await pathExists(destination, fs.lstat);
  if (hadPrevious) await fs.rename(destination, backup);
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    if (hadPrevious && !await pathExists(destination, fs.lstat) && await pathExists(backup, fs.lstat)) {
      await fs.rename(backup, destination);
    }
    throw error;
  }
  if (hadPrevious) await fs.rm(backup, { recursive: true, force: true });
}

export async function fetchReferenceData(value, destination, fetchImpl = globalThis.fetch, fileSystemOverrides = {}) {
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
    await replaceReferenceTree(temporary, destination, fileSystemOverrides);
    return pin;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
