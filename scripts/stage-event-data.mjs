import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_MANIFEST_FILE } from "../app/event-data-pin.mjs";

// Published events live in the event data bucket (#546); this only stages
// the fixtures that development, tests and the local portal run on.
const USAGE = "Usage: npm run data:stage -- --fixture [event-id…]";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [flag, ...requested] = process.argv.slice(2);
if (flag !== "--fixture" || requested.some((argument) => argument.startsWith("--"))) throw new Error(USAGE);
const eventIds = requested.length > 0 ? requested : ["sample"];
if (!eventIds.every((eventId) => /^[a-z0-9][a-z0-9-]*$/.test(eventId))) throw new Error(USAGE);
if (new Set(eventIds).size !== eventIds.length) throw new Error("Refusing to stage the same event twice.");

/** Absent is an answer here; unreadable is not, and must not be read as absent. */
async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
}

async function stageEvent(eventId, publicRoot) {
  const source = path.join(root, "fixtures", "events", eventId);
  const destination = path.join(publicRoot, eventId);
  await mkdir(destination, { recursive: true });
  for (const file of ["event.json", "reference-records.json", "circles.json"]) {
    await cp(path.join(source, file), path.join(destination, file));
  }
  // The manifest being on disk is what decides, not the hall count: two days in
  // one hall may each have their own layout, while an event whose halls never
  // change between days still ships the single map.json readers fall back to.
  if (await exists(path.join(source, MAP_MANIFEST_FILE))) {
    await cp(path.join(source, MAP_MANIFEST_FILE), path.join(destination, MAP_MANIFEST_FILE));
    await cp(path.join(source, "maps"), path.join(destination, "maps"), { recursive: true });
  } else {
    await cp(path.join(source, "map.json"), path.join(destination, "map.json"));
  }
}

const publicRoot = path.join(root, "public", "data", "events");
// Wiped once for the whole set: a staged tree is the exact set of events the
// build will serve, never a leftover union of earlier runs.
await rm(publicRoot, { recursive: true, force: true });
for (const eventId of eventIds) await stageEvent(eventId, publicRoot);

await writeFile(
  path.join(root, ".event-data-stage.json"),
  // `eventId` is the default event, kept alongside the full set so every
  // consumer that only needs "which one first" keeps reading one field.
  `${JSON.stringify({ eventId: eventIds[0], source: "fixture", events: eventIds.map((eventId) => ({ eventId, source: "fixture" })) })}\n`,
);
console.log(`Staged ${eventIds.join(", ")} (fixture) for the Pages build.`);
