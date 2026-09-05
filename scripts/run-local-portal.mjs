import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localPortalWranglerArgs, readLocalPortalEnvironment } from "./local-portal-environment.mjs";

const values = await readLocalPortalEnvironment();
// Resolved rather than pointed at: a git worktree has no `node_modules` of its
// own and takes the checkout's, so a path relative to this file finds nothing.
// The executable comes from the manifest because wrangler's `exports` does not
// publish its own bin path.
const manifest = createRequire(import.meta.url).resolve("wrangler/package.json");
const wrangler = fileURLToPath(new URL(
  JSON.parse(await readFile(manifest, "utf8")).bin.wrangler,
  pathToFileURL(manifest),
));
const child = spawn(process.execPath, [wrangler, ...localPortalWranglerArgs(values)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = exitCode;
