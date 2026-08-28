import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { REFERENCE_SELECTION_FILE } from "./event-data-pin-utils.mjs";
import {
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "./reference-selection-utils.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fixture = false;
let requested = null;
let workspaceArgument = null;
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--fixture" && !fixture) fixture = true;
  else if (argument === "--workspace" && !workspaceArgument && arguments_[index + 1]) {
    workspaceArgument = arguments_[index + 1];
    index += 1;
  } else if (!argument.startsWith("--") && !requested) requested = argument;
  else throw new Error("Usage: npm run data:stage -- (--fixture [event-id] | <event-id>) [--workspace <directory>]");
}
const eventId = fixture ? (requested ?? "sample") : requested;
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) {
  throw new Error("Usage: npm run data:stage -- (--fixture [event-id] | <event-id>) [--workspace <directory>]");
}
const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;

const source = fixture
  ? path.join(root, "fixtures", "events", eventId)
  : path.join(workspace, ".event-data", eventId);
const event = await readJsonFileStrict(path.join(source, "event.json"), "event.json");
if (event.id !== eventId) throw new Error(`Staged event identity mismatch: expected ${eventId}, got ${event.id}.`);

const publicRoot = path.resolve(workspace, "public", "data", "events");
if (path.dirname(publicRoot) !== path.resolve(workspace, "public", "data")) throw new Error("Refusing to replace an unexpected public data path.");
await rm(publicRoot, { recursive: true, force: true });
const destination = path.join(publicRoot, eventId);
await mkdir(destination, { recursive: true });
await cp(path.join(source, "event.json"), path.join(destination, "event.json"));
await cp(path.join(source, "map.json"), path.join(destination, "map.json"));

if (fixture) {
  await cp(path.join(source, "reference-records.json"), path.join(destination, "reference-records.json"));
} else {
  const selection = parseReferenceSelection(
    await readJsonFileStrict(path.join(source, REFERENCE_SELECTION_FILE), REFERENCE_SELECTION_FILE),
  );
  // Selection paths are repository-relative, and `data:fetch` keeps the
  // `references/` prefix on disk, so they resolve against the fetched tree.
  const filesByPath = new Map(await Promise.all(referenceSelectionPaths(selection).map(async (filePath) => [
    filePath,
    await readFile(path.join(source, filePath)),
  ])));
  const verified = verifyReferenceFiles(selection, filesByPath, eventId);
  const selectedRecords = selectEventReferenceRecords(selection, verified.records, event);
  await writeFile(
    path.join(destination, "reference-records.json"),
    `${JSON.stringify(selectedRecords, null, 2)}\n`,
  );
}

if (fixture) {
  await cp(path.join(source, "circles.json"), path.join(destination, "circles.json"));
} else {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts", "build-official-circle-catalog.mjs"), eventId, "--workspace", workspace],
      { cwd: root, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Official catalog builder exited ${code}.`)));
  });
}

await writeFile(path.join(workspace, ".event-data-stage.json"), `${JSON.stringify({ eventId, source: fixture ? "fixture" : "pin" })}\n`);
console.log(`Staged ${eventId} (${fixture ? "fixture" : "pinned data"}) for the Pages build.`);
