/**
 * Upload the staged events to the event data bucket as one new version (#546).
 *
 *   node scripts/upload-event-data.mjs --remote [--preview]
 *   node scripts/upload-event-data.mjs --local --persist-to .wrangler/local-portal
 *
 * Reads what `npm run data:stage` left in `public/data/events/` and
 * `.event-data-stage.json`: the staged order is the order readers are offered.
 * Every file goes under `events/<eventId>/<version>/`, with the identity
 * registry under `registry/<version>/` and each event's published grouping
 * under `source/`. `index.json` is written last, so readers switch to the new
 * version only once it is complete.
 * Production migration: `npm run data:fetch -- --published`, then
 * `npm run data:stage -- --published`, then this with `--remote`.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = "Usage: node scripts/upload-event-data.mjs (--remote [--preview] | --local --persist-to <dir>)";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKETS = { production: "tw-doujin-event-data", preview: "tw-doujin-event-data-preview" };

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const local = args.includes("--local");
const preview = args.includes("--preview");
const persistIndex = args.indexOf("--persist-to");
const persistTo = persistIndex >= 0 ? args[persistIndex + 1] : null;
if (remote === local || (local && !persistTo) || (local && preview)) throw new Error(USAGE);

const bucket = preview ? BUCKETS.preview : BUCKETS.production;
const location = remote ? ["--remote"] : ["--local", "--persist-to", persistTo];

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

// Once approvals publish to the bucket (#546), its index holds events the data
// repository never saw, and the registry they were numbered with. Replacing
// that index from the data repository would remove them.
{
  const temporary = await mkdtemp(path.join(tmpdir(), "event-index-current-"));
  try {
    const target = path.join(temporary, "index.json");
    const read = spawnSync(process.execPath, [wrangler, "r2", "object", "get", `${bucket}/index.json`, "--file", target, ...location], { cwd: root, encoding: "utf8" });
    if (read.status === 0) {
      const current = JSON.parse(await readFile(target, "utf8"));
      const approved = (current.events ?? []).filter((entry) => entry.source).map((entry) => entry.eventId);
      if (approved.length) throw new Error(`${bucket} already holds events published by approval (${approved.join(", ")}); uploading from the data repository would remove them. Nothing was uploaded.`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const stage = JSON.parse(await readFile(path.join(root, ".event-data-stage.json"), "utf8"));
const staged = stage.events ?? [{ eventId: stage.eventId, source: stage.source }];
const eventIds = staged.map(({ eventId }) => eventId);
// A sortable timestamp: later uploads always carry a later version.
const version = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
// The circle identity registry the staged catalogs were built with. Approvals
// read it from here and write the next version (#546).
const index = { schema: "event-index/1", registry: version, events: [] };
const staging = path.join(root, "public", "data", "events");
for (const file of ["allocations.json", "evidence.json"]) put(`registry/${version}/${file}`, path.join(root, "data", "circle-identities", file));
const GROUPING = "circle-identity-groups.json";
async function exists(target) {
  try { await readFile(target); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

for (const eventId of eventIds) {
  const directory = path.join(staging, eventId);
  const files = await jsonFiles(directory);
  for (const required of ["event.json", "reference-records.json", "circles.json"]) {
    if (!files.includes(required)) throw new Error(`Staged ${eventId} has no ${required}.`);
  }
  for (const file of files) put(`events/${eventId}/${version}/${file}`, path.join(directory, file));
  const read = async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"));
  // A later correction reads the published grouping, which maintainers may
  // have adjusted after publication. Fixtures have none.
  const source = staged.find((item) => item.eventId === eventId).source === "fixture"
    ? path.join(root, "fixtures", "events", eventId) : path.join(root, ".event-data", eventId);
  const sourceFiles = await exists(path.join(source, GROUPING)) ? [GROUPING] : [];
  for (const file of sourceFiles) put(`events/${eventId}/${version}/source/${file}`, path.join(source, file));
  index.events.push({ eventId, version, files, ...(sourceFiles.length ? { sourceFiles } : {}),
    definition: await read("event.json"), references: await read("reference-records.json") });
  console.log(`${eventId}: ${files.length} files as version ${version}`);
}

const temporary = await mkdtemp(path.join(tmpdir(), "event-index-"));
try {
  const indexFile = path.join(temporary, "index.json");
  await writeFile(indexFile, `${JSON.stringify(index)}\n`);
  put("index.json", indexFile);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Published ${eventIds.join(", ")} to ${bucket} (${remote ? "remote" : "local"}).`);
