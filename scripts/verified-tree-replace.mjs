import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
    readFile: overrides.readFile ?? readFile,
    rename: overrides.rename ?? rename,
    rm: overrides.rm ?? rm,
    writeFile: overrides.writeFile ?? writeFile,
  };
}

function transactionTemporaryPath(transactionFile) {
  return `${transactionFile}.temporary`;
}

function transactionCommittedPath(transactionFile) {
  return `${transactionFile}.committed`;
}

function transactionCommittedTemporaryPath(transactionFile) {
  return `${transactionCommittedPath(transactionFile)}.temporary`;
}

function parseTransactionJournal(journal, root) {
  if (journal?.schema !== "verified-tree-transaction/1" || !Array.isArray(journal.destinations)) {
    throw new Error("Invalid verified-tree transaction journal.");
  }
  if (journal.destinations.some((entry) => !path.isAbsolute(entry?.destination ?? "")
    || typeof entry.hadPrevious !== "boolean")) {
    throw new Error("Invalid verified-tree transaction journal state.");
  }
  const resolvedRoot = path.resolve(root);
  const destinations = journal.destinations.map((entry) => path.resolve(entry.destination));
  if (new Set(destinations).size !== destinations.length) {
    throw new Error("Verified-tree transaction journal contains duplicate destinations.");
  }
  if (destinations.some((destination) => {
    const relative = path.relative(resolvedRoot, destination);
    return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  })) {
    throw new Error("Verified-tree transaction journal contains a destination outside its repository.");
  }
  return journal.destinations.map((entry, index) => ({
    ...entry,
    destination: destinations[index],
    backup: `${destinations[index]}.previous`,
  }));
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

export async function recoverInterruptedTreeTransaction(transactionFile, root, overrides = {}) {
  const fs = fileSystem(overrides);
  const temporaryJournal = transactionTemporaryPath(transactionFile);
  const committedJournal = transactionCommittedPath(transactionFile);
  const temporaryCommittedJournal = transactionCommittedTemporaryPath(transactionFile);
  const committedExists = await pathExists(committedJournal, fs.lstat);
  if (committedExists) {
    const journal = JSON.parse(await fs.readFile(committedJournal, "utf8"));
    const states = parseTransactionJournal(journal, root);
    for (const state of states) {
      if (!await pathExists(state.destination, fs.lstat)) {
        throw new Error(`Cannot finish committed replacement for ${state.destination}.`);
      }
    }
    for (const state of states) {
      await fs.rm(state.backup, { recursive: true, force: true });
    }
    await fs.rm(transactionFile, { force: true });
    await fs.rm(committedJournal, { force: true });
    await fs.rm(temporaryJournal, { force: true });
    await fs.rm(temporaryCommittedJournal, { force: true });
    return "committed";
  }

  const journalExists = await pathExists(transactionFile, fs.lstat);
  if (!journalExists) {
    await fs.rm(temporaryJournal, { force: true });
    await fs.rm(temporaryCommittedJournal, { force: true });
    return false;
  }

  const journal = JSON.parse(await fs.readFile(transactionFile, "utf8"));
  const states = parseTransactionJournal(journal, root);
  for (const state of [...states].reverse()) {
    const destinationExists = await pathExists(state.destination, fs.lstat);
    const backupExists = await pathExists(state.backup, fs.lstat);
    if (state.hadPrevious) {
      if (backupExists) {
        if (destinationExists) await fs.rm(state.destination, { recursive: true, force: true });
        await fs.rename(state.backup, state.destination);
      } else if (!destinationExists) {
        throw new Error(`Cannot recover interrupted replacement for ${state.destination}.`);
      }
    } else if (destinationExists) {
      await fs.rm(state.destination, { recursive: true, force: true });
    }
  }
  await fs.rm(transactionFile, { force: true });
  await fs.rm(temporaryJournal, { force: true });
  await fs.rm(temporaryCommittedJournal, { force: true });
  return "rolled-back";
}

export async function replaceVerifiedTreesTransaction(
  replacements,
  transactionFile,
  root,
  overrides = {},
) {
  const fs = fileSystem(overrides);
  await recoverInterruptedTreeTransaction(transactionFile, root, fs);
  const states = replacements.map(({ temporary, destination }) => ({
    temporary,
    destination,
    backup: `${destination}.previous`,
    hadPrevious: false,
  }));
  for (const state of states) state.hadPrevious = await pathExists(state.destination, fs.lstat);

  const temporaryJournal = transactionTemporaryPath(transactionFile);
  const journal = {
    schema: "verified-tree-transaction/1",
    destinations: states.map(({ destination, hadPrevious }) => ({ destination, hadPrevious })),
  };
  const serializedJournal = `${JSON.stringify(journal)}\n`;
  const committedJournal = transactionCommittedPath(transactionFile);
  const temporaryCommittedJournal = transactionCommittedTemporaryPath(transactionFile);
  await fs.writeFile(temporaryJournal, serializedJournal, { flag: "wx" });
  try {
    await fs.rename(temporaryJournal, transactionFile);
    for (const state of states) {
      if (state.hadPrevious) await fs.rename(state.destination, state.backup);
    }
    for (const state of states) {
      await fs.rename(state.temporary, state.destination);
    }
    await fs.writeFile(temporaryCommittedJournal, serializedJournal, { flag: "wx" });
    await fs.rename(temporaryCommittedJournal, committedJournal);
  } catch (error) {
    try {
      await recoverInterruptedTreeTransaction(transactionFile, root, fs);
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        `Verified-tree replacement failed and recovery was incomplete: ${error.message}`,
      );
    }
    throw error;
  }
  await fs.rm(transactionFile, { force: true });
  for (const state of states) {
    if (state.hadPrevious) await fs.rm(state.backup, { recursive: true, force: true });
  }
  await fs.rm(committedJournal, { force: true });
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
