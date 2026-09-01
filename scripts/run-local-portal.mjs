import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localPortalWranglerArgs, readLocalPortalEnvironment } from "./local-portal-environment.mjs";

const values = await readLocalPortalEnvironment();
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const child = spawn(process.execPath, [wrangler, ...localPortalWranglerArgs(values)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = exitCode;
