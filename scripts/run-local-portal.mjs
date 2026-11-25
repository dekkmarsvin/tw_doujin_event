import { spawn, spawnSync } from "node:child_process";
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
// The schema comes from migrations/ (#546); a fresh or cleared local D1 gets it
// before anything reads it.
const migrate = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", ".wrangler/local-portal"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});
if (migrate.status !== 0) throw new Error("local portal: could not apply the D1 migrations.");

// Pages Functions serve event data from R2 (#546), so the staged fixture goes
// into the portal's local bucket before the server starts.
const seed = spawnSync(process.execPath, [fileURLToPath(new URL("./upload-event-data.mjs", import.meta.url)), "--persist-to", ".wrangler/local-portal"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});
if (seed.status !== 0) throw new Error("local portal: could not load the staged events into the local event data bucket.");

const child = spawn(process.execPath, [wrangler, ...localPortalWranglerArgs(values)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code !== 0 || signal) console.error(`local portal: Wrangler exited (code=${code}, signal=${signal})`);
    resolve(code ?? 1);
  });
});
process.exitCode = exitCode;
