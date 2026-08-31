import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
const workspaceArgument = arguments_[0] === "--workspace" && arguments_.length === 2 ? arguments_[1] : null;
if (arguments_.length > 0 && !workspaceArgument) {
  throw new Error("Usage: npm run event-data:check -- [--workspace <directory>]");
}
const workspace = workspaceArgument ? path.resolve(root, workspaceArgument) : root;
const stage = JSON.parse(await readFile(path.join(workspace, ".event-data-stage.json"), "utf8"));
const stagedEvents = stage.events ?? [{ eventId: stage.eventId, source: stage.source }];
const eventsRoot = path.join(workspace, "public", "data", "events");
const eventDirectories = await readdir(eventsRoot);

// The staged tree must be exactly the staged set — no leftovers from an earlier
// run, and nothing published that the manifest does not name.
const staged = [...stagedEvents.map(({ eventId }) => eventId)].sort();
if (eventDirectories.length !== staged.length || !eventDirectories.slice().sort().every((name, index) => name === staged[index])) {
  throw new Error(`The staged public tree must contain exactly ${staged.join(", ")}.`);
}

const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite validation environment is not runnable.");
  const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
  for (const { eventId, source } of stagedEvents) {
    const directory = path.join(eventsRoot, eventId);
    const [event, references, catalog] = await Promise.all([
      readJsonFileStrict(path.join(directory, "event.json"), "staged event.json"),
      readJsonFileStrict(path.join(directory, "reference-records.json"), "staged reference-records.json"),
      readJsonFileStrict(path.join(directory, "circles.json"), "staged circles.json"),
    ]);
    let map;
    if (Array.isArray(event.venueAssignments) && event.venueAssignments.length > 1) {
      const manifest = await readJsonFileStrict(path.join(directory, "map-manifest.json"), "staged map-manifest.json");
      const maps = new Map(await Promise.all(manifest.maps.map(async ({ path: relativePath }) => [
        relativePath,
        await readJsonFileStrict(path.join(directory, ...relativePath.split("/")), `staged ${relativePath}`),
      ])));
      map = { manifest, maps };
    } else {
      map = await readJsonFileStrict(path.join(directory, "map.json"), "staged map.json");
    }
    const validated = validateStagedEventArtifacts(event, references, catalog, map, eventId);
    console.log(`Verified staged ${eventId} ${source} data: ${validated.catalog.circles.length} circles, ${validated.catalog.placements.length} placements.`);
  }
} finally {
  await vite.close();
}
