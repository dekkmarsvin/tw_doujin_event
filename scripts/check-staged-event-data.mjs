import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = JSON.parse(await readFile(path.join(root, ".event-data-stage.json"), "utf8"));
const directory = path.join(root, "public", "data", "events", stage.eventId);
const [event, references, catalog, map, eventDirectories] = await Promise.all([
  readJsonFileStrict(path.join(directory, "event.json"), "staged event.json"),
  readJsonFileStrict(path.join(directory, "reference-records.json"), "staged reference-records.json"),
  readJsonFileStrict(path.join(directory, "circles.json"), "staged circles.json"),
  readJsonFileStrict(path.join(directory, "map.json"), "staged map.json"),
  readdir(path.join(root, "public", "data", "events")),
]);
if (eventDirectories.length !== 1 || eventDirectories[0] !== stage.eventId) throw new Error("The staged public tree must contain exactly the active event.");
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite validation environment is not runnable.");
  const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
  const validated = validateStagedEventArtifacts(event, references, catalog, map, stage.eventId);
  console.log(`Verified staged ${stage.eventId} ${stage.source} data: ${validated.catalog.circles.length} circles, ${validated.catalog.placements.length} placements.`);
} finally {
  await vite.close();
}
