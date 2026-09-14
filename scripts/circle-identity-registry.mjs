import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { recoverInterruptedReplacement, replaceVerifiedTrees } from "./verified-tree-replace.mjs";

export { planCircleIdentityRegistryUpdate } from "../app/circle-identity-registry.mjs";

export function serializeCircleIdentityRegistry(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function recoverCircleIdentityRegistry(directory, fileSystemOverrides = {}) {
  await recoverInterruptedReplacement(path.resolve(directory), fileSystemOverrides);
}

export async function writeCircleIdentityRegistry({ directory, allocations, evidence, fileSystemOverrides = {} }) {
  const destinationDirectory = path.resolve(directory);
  await recoverCircleIdentityRegistry(destinationDirectory, fileSystemOverrides);
  await mkdir(destinationDirectory, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(path.dirname(destinationDirectory), ".tmp-circle-identities-"));
  const temporaryDirectory = path.join(temporaryRoot, path.basename(destinationDirectory));
  try {
    await cp(destinationDirectory, temporaryDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(temporaryDirectory, "allocations.json"), serializeCircleIdentityRegistry(allocations)),
      writeFile(path.join(temporaryDirectory, "evidence.json"), serializeCircleIdentityRegistry(evidence)),
    ]);
    await replaceVerifiedTrees([{ temporary: temporaryDirectory, destination: destinationDirectory }], fileSystemOverrides);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
