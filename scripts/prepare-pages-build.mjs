import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function comparablePath(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export async function removeVinextDeployRedirect(root) {
  const redirectPath = resolve(root, ".wrangler", "deploy", "config.json");
  let raw;
  try {
    raw = await readFile(redirectPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const redirect = JSON.parse(raw);
  if (typeof redirect.configPath !== "string") {
    throw new Error(`Refusing to remove an unrecognized Wrangler deploy config at ${redirectPath}.`);
  }

  const target = comparablePath(resolve(dirname(redirectPath), redirect.configPath));
  const expected = comparablePath(resolve(root, "dist", "server", "wrangler.json"));
  if (target !== expected) {
    throw new Error(`Refusing to remove a Wrangler deploy config that points to ${redirect.configPath}.`);
  }

  await rm(redirectPath);
  return true;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && comparablePath(resolve(process.argv[1])) === comparablePath(modulePath)) {
  const removed = await removeVinextDeployRedirect(resolve(dirname(modulePath), ".."));
  if (removed) console.log("Removed the stale vinext Wrangler deploy redirect.");
}
