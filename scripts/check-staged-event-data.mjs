import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = JSON.parse(await readFile(path.join(root, ".event-data-stage.json"), "utf8"));
const directory = path.join(root, "public", "data", "events", stage.eventId);
const [event, catalog, map, eventDirectories] = await Promise.all([
  readFile(path.join(directory, "event.json"), "utf8").then(JSON.parse),
  readFile(path.join(directory, "circles.json"), "utf8").then(JSON.parse),
  readFile(path.join(directory, "map.json"), "utf8").then(JSON.parse),
  readdir(path.join(root, "public", "data", "events")),
]);
if (eventDirectories.length !== 1 || eventDirectories[0] !== stage.eventId) throw new Error("The staged public tree must contain exactly the active event.");
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite validation environment is not runnable.");
  const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
  const validated = validateStagedEventArtifacts(event, catalog, map, stage.eventId);
  console.log(`Verified staged ${stage.eventId} ${stage.source} data: ${validated.catalog.circles.length} circles, ${validated.catalog.placements.length} placements.`);
} finally {
  await vite.close();
}
