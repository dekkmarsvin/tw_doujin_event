import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const [eventId, destination] = process.argv.slice(2);
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId) || !destination) {
  throw new Error("Usage: npm run map:snapshot -- <event-id> <data-repo-map.json>");
}
const outputPath = resolve(root, destination);
const retiredPublicRoot = resolve(root, "public", "data", "events");
if (outputPath === retiredPublicRoot || outputPath.startsWith(`${retiredPublicRoot}\\`) || outputPath.startsWith(`${retiredPublicRoot}/`)) {
  throw new Error("Map snapshots belong in the event data repository, not public/data/events.");
}

const stdout = execFileSync(process.execPath, [
  wranglerCli,
  "d1",
  "execute",
  "site-creator-d1",
  "--local",
  "--persist-to",
  ".wrangler/state",
  "--config",
  "dist/server/wrangler.json",
  "--json",
  "--command",
  `SELECT event_id, revision, source_name, confidence, updated_at, layout_json FROM event_maps WHERE event_id = '${eventId}';`,
], { cwd: root, encoding: "utf8" });

const [execution] = JSON.parse(stdout);
const row = execution?.results?.[0];
if (!row) throw new Error(`Local D1 does not contain a published ${eventId} event map.`);

const layout = JSON.parse(row.layout_json);
const snapshot = {
  eventId: row.event_id,
  revision: row.revision,
  sourceName: row.source_name,
  confidence: row.confidence / 100,
  updatedAt: `${row.updated_at.replace(" ", "T")}Z`,
  layout,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const slotCount = layout.rows.reduce((total, mapRow) => total + mapRow.slots.length, 0);
console.log(`Exported ${eventId} revision ${snapshot.revision} to ${outputPath}: ${slotCount} slots, ${layout.landmarks.length} landmarks.`);
