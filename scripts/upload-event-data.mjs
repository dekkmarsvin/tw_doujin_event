/**
 * Load the staged fixtures into the local portal's event data bucket (#546).
 *
 *   node scripts/upload-event-data.mjs --persist-to .wrangler/local-portal
 *
 * Reads what `npm run data:stage` left in `public/data/events/` and
 * `.event-data-stage.json`: the staged order is the order readers are offered.
 * Every file goes under `events/<eventId>/<version>/`, with the identity
 * registry under `registry/<version>/`, laid out as approvals publish them.
 * `index.json` is written last. Remote buckets are written only by approvals.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = "Usage: node scripts/upload-event-data.mjs --persist-to <dir>";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bucket = "tw-doujin-event-data";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--persist-to") throw new Error(USAGE);
const location = ["--local", "--persist-to", args[1]];

const manifest = createRequire(import.meta.url).resolve("wrangler/package.json");
const wrangler = fileURLToPath(new URL(JSON.parse(await readFile(manifest, "utf8")).bin.wrangler, pathToFileURL(manifest)));

function put(key, file) {
  const result = spawnSync(process.execPath, [wrangler, "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", "application/json", ...location], {
    cwd: root, encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Upload of ${key} failed:\n${result.stdout}\n${result.stderr}`);
}

async function jsonFiles(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await jsonFiles(path.join(directory, entry.name), relative));
    else if (entry.name.endsWith(".json")) found.push(relative);
  }
  return found.sort();
}

// A version readers switch to must be complete: run the same staged-data check
// the build uses (every map the event needs, manifest coverage, identities)
// before anything is uploaded.
const check = spawnSync(process.execPath, [path.join(root, "scripts", "check-staged-event-data.mjs")], { cwd: root, stdio: "inherit" });
if (check.status !== 0) throw new Error("The staged events failed their check; nothing was uploaded.");

const stage = JSON.parse(await readFile(path.join(root, ".event-data-stage.json"), "utf8"));
const staged = stage.events ?? [{ eventId: stage.eventId }];
const eventIds = staged.map(({ eventId }) => eventId);
// A sortable timestamp: later uploads always carry a later version.
const version = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
// The circle identity registry approvals read and extend (#546). The local
// portal starts from an empty one, as a new environment does: the fixtures'
// circles carry their own ids, and production's registry lives only in R2.
const index = { schema: "event-index/1", registry: version, events: [] };
const staging = path.join(root, "public", "data", "events");
const registry = await mkdtemp(path.join(tmpdir(), "event-registry-"));
try {
  for (const [file, value] of [["allocations.json", { schema: "circle-id-allocations/1", nextSequence: 1, allocations: [] }],
    ["evidence.json", { schema: "circle-identity-evidence/1", entries: [] }]]) {
    await writeFile(path.join(registry, file), `${JSON.stringify(value)}\n`);
    put(`registry/${version}/${file}`, path.join(registry, file));
  }
} finally {
  await rm(registry, { recursive: true, force: true });
}
for (const eventId of eventIds) {
  const directory = path.join(staging, eventId);
  const files = await jsonFiles(directory);
  for (const required of ["event.json", "reference-records.json", "circles.json"]) {
    if (!files.includes(required)) throw new Error(`Staged ${eventId} has no ${required}.`);
  }
  for (const file of files) put(`events/${eventId}/${version}/${file}`, path.join(directory, file));
  const read = async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"));
  index.events.push({ eventId, version, files, definition: await read("event.json"), references: await read("reference-records.json") });
  console.log(`${eventId}: ${files.length} files as version ${version}`);
}

const temporary = await mkdtemp(path.join(tmpdir(), "event-index-"));
try {
  const indexFile = path.join(temporary, "index.json");
  await writeFile(indexFile, `${JSON.stringify(index)}\n`);
  // Kept whole, like every published index, so a rollback restores all of it.
  put(`history/index-${version}.json`, indexFile);
  put("index.json", indexFile);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Loaded ${eventIds.join(", ")} into the local ${bucket}.`);
