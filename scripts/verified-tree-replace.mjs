import { lstat, rename, rm } from "node:fs/promises";

// Swapping already-verified trees into place. Callers download and verify into
// a sibling temporary directory first, then hand the finished trees here so a
// failure at any point leaves the previous verified state installed.
//
// ADR-0039 removed the second fetch, so `data:fetch` now replaces one tree.
// Onboarding still replaces several at once — the fetched data, the public
// staging tree and the stage marker have to move together or not at all.

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

export async function recoverInterruptedReplacement(destination, overrides = {}) {
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
    await recoverInterruptedReplacement(state.destination, fs);
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
