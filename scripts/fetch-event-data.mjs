import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEventDataPinIdentity, parseEventDataPin } from "./event-data-pin-utils.mjs";
import { fetchEventData } from "./event-data-fetcher.mjs";
import {
  acquireEventOnboardingLock,
  assertNoUnfinishedEventOnboardingTransaction,
} from "./event-onboarding-lock.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, ...arguments_] = process.argv.slice(2);
let pinArgument = null;
let workspaceArgument = null;
for (let index = 0; index < arguments_.length; index += 2) {
  const [option, value] = arguments_.slice(index, index + 2);
  if (!value || (option === "--pin" && pinArgument) || (option === "--workspace" && workspaceArgument)) {
    throw new Error("Usage: npm run data:fetch -- <event-id> [--pin <event-data-pin.json>] [--workspace <directory>]");
  }
  if (option === "--pin") pinArgument = value;
  else if (option === "--workspace") workspaceArgument = value;
  else throw new Error("Usage: npm run data:fetch -- <event-id> [--pin <event-data-pin.json>] [--workspace <directory>]");
}
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) {
  throw new Error("Usage: npm run data:fetch -- <event-id> [--pin <event-data-pin.json>] [--workspace <directory>]");
}

const pinPath = pinArgument
  ? path.resolve(root, pinArgument)
  : path.join(root, "data", "event-data-pins", `${eventId}.json`);
const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;
const lock = workspace === root ? await acquireEventOnboardingLock(root) : null;
try {
if (lock) await assertNoUnfinishedEventOnboardingTransaction(root);
const pin = assertEventDataPinIdentity(parseEventDataPin(await readJsonFileStrict(pinPath, `Event data pin ${eventId}`)), eventId);
const destination = path.join(workspace, ".event-data", eventId);
// A sibling temp directory keeps the final rename atomic on Windows too; the
// system temp directory may be on C: while the checkout is on D: (EXDEV).
await mkdir(path.dirname(destination), { recursive: true });
await fetchEventData(pin, destination);
const location = workspaceArgument ? "isolated onboarding workspace" : path.relative(root, destination);
console.log(`Fetched ${pin.repository}@${pin.commit} to ${location}`);
} finally {
  await lock?.release();
}
