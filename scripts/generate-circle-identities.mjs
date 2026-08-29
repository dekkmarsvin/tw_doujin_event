import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOfficialBoothData } from "./official-booth-importer.mjs";
import {
  planCircleIdentityRegistryUpdate,
  recoverCircleIdentityRegistry,
  writeCircleIdentityRegistry,
} from "./circle-identity-registry.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, ...arguments_] = process.argv.slice(2);
let workspaceArgument = null;
let mode = "dry-run";
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--workspace" && !workspaceArgument && arguments_[index + 1]) {
    workspaceArgument = arguments_[index + 1];
    index += 1;
  } else if ((argument === "--write" || argument === "--check") && mode === "dry-run") {
    mode = argument.slice(2);
  } else {
    throw new Error("Usage: npm run identity:generate -- <event-id> [--workspace <directory>] [--write | --check]");
  }
}
if (!/^[a-z0-9][a-z0-9-]*$/u.test(eventId ?? "")) {
  throw new Error("Usage: npm run identity:generate -- <event-id> [--workspace <directory>] [--write | --check]");
}

const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;
const eventDirectory = path.join(workspace, ".event-data", eventId);
const registryDirectory = path.join(workspace, "data", "circle-identities");
await recoverCircleIdentityRegistry(registryDirectory);
const [event, officialValue, grouping, allocations, evidence] = await Promise.all([
  readJsonFileStrict(path.join(eventDirectory, "event.json"), "event.json"),
  readJsonFileStrict(path.join(eventDirectory, "official-booths.json"), "official-booths.json"),
  readJsonFileStrict(path.join(eventDirectory, "circle-identity-groups.json"), "circle-identity-groups.json"),
  readJsonFileStrict(path.join(registryDirectory, "allocations.json"), "identity allocations"),
  readJsonFileStrict(path.join(registryDirectory, "evidence.json"), "identity evidence"),
]);
if (event.id !== eventId) throw new Error(`Event definition identity mismatch: expected ${eventId}, got ${event.id}.`);
const official = parseOfficialBoothData(officialValue, event);
const planned = planCircleIdentityRegistryUpdate({ eventId, official, grouping, allocations, evidence });

if (mode === "check" && planned.summary.changed) {
  throw new Error(`Identity registry is missing ${planned.summary.newAllocationCount} reviewed ${eventId} group(s). Run with --write and review the diff.`);
}
if (mode === "write" && planned.summary.changed) {
  await writeCircleIdentityRegistry({ directory: registryDirectory, allocations: planned.allocations, evidence: planned.evidence });
}
console.log(JSON.stringify({ ...planned.summary, mode }, null, 2));
