import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEventDataPinIdentity, parseEventDataPin } from "./event-data-pin-utils.mjs";
import { fetchEventData } from "./event-data-fetcher.mjs";
import { readPublishedEvents } from "./published-events.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const USAGE = "Usage: npm run data:fetch -- (<event-id> | --published) [--pin <event-data-pin.json>] [--workspace <directory>]";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [first, ...arguments_] = process.argv.slice(2);
const published = first === "--published";
const eventId = published ? null : first;
let pinArgument = null;
let workspaceArgument = null;
for (let index = 0; index < arguments_.length; index += 2) {
  const [option, value] = arguments_.slice(index, index + 2);
  if (!value || (option === "--pin" && pinArgument) || (option === "--workspace" && workspaceArgument)) {
    throw new Error(USAGE);
  }
  if (option === "--pin") pinArgument = value;
  else if (option === "--workspace") workspaceArgument = value;
  else throw new Error(USAGE);
}
if (!published && (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId))) throw new Error(USAGE);
// A pin path names one event's pin, so it cannot stand for a whole set.
if (published && pinArgument) throw new Error(USAGE);

const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;
const eventIds = published ? await readPublishedEvents(root) : [eventId];

for (const id of eventIds) {
  const pinPath = pinArgument
    ? path.resolve(root, pinArgument)
    : path.join(root, "data", "event-data-pins", `${id}.json`);
  const pin = assertEventDataPinIdentity(parseEventDataPin(await readJsonFileStrict(pinPath, `Event data pin ${id}`)), id);
  const destination = path.join(workspace, ".event-data", id);
  // A sibling temp directory keeps the final rename atomic on Windows too; the
  // system temp directory may be on C: while the checkout is on D: (EXDEV).
  await mkdir(path.dirname(destination), { recursive: true });
  await fetchEventData(pin, destination);
  const location = workspaceArgument ? "isolated onboarding workspace" : path.relative(root, destination);
  console.log(`Fetched ${pin.repository}@${pin.commit} to ${location}`);
}
