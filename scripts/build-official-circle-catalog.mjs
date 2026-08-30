import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOfficialCatalogPayload } from "./official-catalog-core.mjs";
import { parseOfficialBoothData } from "./official-booth-importer.mjs";
import { recoverCircleIdentityRegistry } from "./circle-identity-registry.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, ...arguments_] = process.argv.slice(2);
const check = arguments_.includes("--check");
const workspaceIndex = arguments_.indexOf("--workspace");
const workspaceArgument = workspaceIndex >= 0 ? arguments_[workspaceIndex + 1] : null;
const expectedArguments = [
  ...(check ? ["--check"] : []),
  ...(workspaceArgument ? ["--workspace", workspaceArgument] : []),
];
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)
  || arguments_.length !== expectedArguments.length
  || arguments_.some((value, index) => value !== expectedArguments[index])) {
  throw new Error("Usage: node scripts/build-official-circle-catalog.mjs <event-id> [--check] [--workspace <directory>]");
}
const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;

const dataDir = path.join(workspace, ".event-data", eventId);
const outputPath = path.join(workspace, "public", "data", "events", eventId, "circles.json");
await recoverCircleIdentityRegistry(path.join(workspace, "data", "circle-identities"));
const [event, officialValue, evidence] = await Promise.all([
  readJsonFileStrict(path.join(dataDir, "event.json"), "event.json"),
  readJsonFileStrict(path.join(dataDir, "official-booths.json"), "official-booths.json"),
  readJsonFileStrict(path.join(workspace, "data", "circle-identities", "evidence.json"), "identity evidence"),
]);
if (event.id !== eventId) throw new Error(`Event definition identity mismatch: expected ${eventId}, got ${event.id}.`);
const official = parseOfficialBoothData(officialValue, event);
const payload = buildOfficialCatalogPayload({ eventId, event, official, evidence });
const retiredCount = payload.placements.filter((placement) => placement.status !== "active").length;
const retiredNote = retiredCount > 0 ? `, ${retiredCount} retired` : "";
const serialized = `${JSON.stringify(payload)}\n`;
if (check) {
  const current = await readFile(outputPath, "utf8");
  if (current !== serialized) throw new Error(`${path.relative(root, outputPath)} is stale.`);
  console.log(`Verified official-only ${eventId} catalog: ${payload.circles.length} circles, ${payload.placements.length} placements${retiredNote}.`);
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
  console.log(`Built official-only ${eventId} catalog: ${payload.circles.length} circles, ${payload.placements.length} placements${retiredNote}.`);
}
