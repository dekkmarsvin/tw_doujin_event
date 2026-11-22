/**
 * Copy one published event from production into `public/data/events/` for the
 * browser journeys that measure real data (#546).
 *
 *   node scripts/fetch-published-event.mjs ff47
 *   node scripts/fetch-published-event.mjs ff47 --update
 *
 * `fixtures/published/<eventId>.json` fixes the hash of every file. If the
 * event has since been corrected, the copy fails rather than letting the
 * journeys measure data nobody reviewed; `--update` records the current files.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "Usage: node scripts/fetch-published-event.mjs <event-id> [--update]";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, ...options] = process.argv.slice(2);
const update = options.length === 1 && options[0] === "--update";
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId) || (options.length && !update)) throw new Error(USAGE);

const pinPath = path.join(root, "fixtures", "published", `${eventId}.json`);
const pin = JSON.parse(await readFile(pinPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(file) {
  const url = new URL(`/data/events/${eventId}/${file}`, pin.origin);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function publishedEntry() {
  const index = await (await fetch(new URL("/data/events/index.json", pin.origin), { redirect: "error" })).json();
  const entry = index.events?.find((event) => event.eventId === eventId);
  if (!entry) throw new Error(`${pin.origin} does not publish ${eventId}.`);
  return entry;
}

if (update) {
  const entry = await publishedEntry();
  const files = {};
  for (const file of [...entry.files].sort()) files[file] = sha256(await download(file));
  // Each file is served from whatever version is current when it is asked
  // for, so a correction published mid-download would mix two versions.
  if ((await publishedEntry()).version !== entry.version) throw new Error(`${eventId} changed while downloading; run --update again.`);
  await writeFile(pinPath, `${JSON.stringify({ ...pin, version: entry.version, files }, null, 2)}\n`);
  console.log(`Recorded ${eventId} version ${entry.version}.`);
  process.exit(0);
}

const downloaded = [];
for (const [file, expected] of Object.entries(pin.files)) {
  const bytes = await download(file);
  if (sha256(bytes) !== expected) {
    throw new Error(`${eventId}/${file} no longer matches version ${pin.version}. If the change is expected, run with --update.`);
  }
  downloaded.push([file, bytes]);
}

// Replaced whole, only after every file checked out, so a failed copy never
// leaves half of one event and half of another.
const events = path.join(root, "public", "data", "events");
await rm(events, { recursive: true, force: true });
for (const [file, bytes] of downloaded) {
  const target = path.join(events, eventId, ...file.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
await writeFile(path.join(root, ".event-data-stage.json"),
  `${JSON.stringify({ eventId, source: "published", events: [{ eventId, source: "published" }] })}\n`);
console.log(`Copied ${eventId} version ${pin.version} from ${pin.origin}.`);
