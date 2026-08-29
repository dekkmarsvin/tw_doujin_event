import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

export const EVENT_ONBOARDING_LOCK_TOKEN_ENV = "TW_DOUJIN_EVENT_ONBOARDING_LOCK_TOKEN";

export function eventOnboardingLockDirectory(root) {
  return path.join(root, "data", "event-data-pins", ".onboard.lock");
}

export function eventOnboardingTransactionFile(root) {
  return path.join(root, "data", "event-data-pins", ".onboard.transaction.json");
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function readOwner(lockDirectory) {
  const owner = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
  const valid = owner?.schema === "event-onboarding-lock/1"
    && typeof owner.hostname === "string"
    && Number.isInteger(owner.pid) && owner.pid > 0
    && typeof owner.token === "string" && owner.token !== "";
  if (!valid) throw new Error("Event onboarding lock ownership is invalid.");
  return owner;
}

export async function assertEventOnboardingOwnership(
  root,
  token = process.env[EVENT_ONBOARDING_LOCK_TOKEN_ENV],
) {
  const transactionFile = eventOnboardingTransactionFile(root);
  if (await pathExists(transactionFile) || await pathExists(`${transactionFile}.committed`)) {
    throw new Error("Circle identity registry belongs to an unfinished event onboarding transaction.");
  }
  const lockDirectory = eventOnboardingLockDirectory(root);
  if (!await pathExists(lockDirectory)) return;
  const owner = await readOwner(lockDirectory);
  if (!token || owner.token !== token) {
    throw new Error(`Event onboarding is already active on ${owner.hostname} (PID ${owner.pid}).`);
  }
}

export async function acquireEventOnboardingLock(
  root,
  token = process.env[EVENT_ONBOARDING_LOCK_TOKEN_ENV],
  attempt = 0,
) {
  const pinDirectory = path.join(root, "data", "event-data-pins");
  const lockDirectory = eventOnboardingLockDirectory(root);
  if (await pathExists(lockDirectory)) {
    const activeOwner = await readOwner(lockDirectory);
    if (token && activeOwner.token === token) {
      return { token, release: async () => {} };
    }
    if (activeOwner.hostname !== hostname() || processIsAlive(activeOwner.pid)) {
      throw new Error(`Event onboarding is already active on ${activeOwner.hostname} (PID ${activeOwner.pid}).`);
    }
    await rm(lockDirectory, { recursive: true, force: true });
  }

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
    if (!["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
    if (attempt >= 2) throw new Error("Could not acquire the event onboarding lock.", { cause: error });
    return acquireEventOnboardingLock(root, token, attempt + 1);
  }

  return {
    token: owner.token,
    release: async () => {
      const activeOwner = await readOwner(lockDirectory);
      if (activeOwner.token !== owner.token) throw new Error("Event onboarding lock ownership changed before release.");
      await rm(lockDirectory, { recursive: true, force: true });
    },
  };
}
