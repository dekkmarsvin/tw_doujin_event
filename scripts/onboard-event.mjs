import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onboardEvent } from "./event-onboarding.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, commit, ...extra] = process.argv.slice(2);
if (!eventId || !commit || extra.length > 0) {
  throw new Error("Usage: npm run event:onboard -- <event-id> <full-commit-sha>");
}

async function runScript(script, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", script), ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

const result = await onboardEvent({
  eventId,
  commit,
  root,
  validate: async (temporaryPin) => {
    await runScript("fetch-event-data.mjs", [eventId, "--pin", temporaryPin]);
    await runScript("stage-event-data.mjs", [eventId]);
    await runScript("check-staged-event-data.mjs", []);
  },
});
console.log(`Onboarded ${eventId}: ${path.relative(root, result.destination)}`);
