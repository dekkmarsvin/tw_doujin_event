import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const outputPath = resolve(root, "public", "data", "events", "ff47", "map.json");

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
  "SELECT event_id, revision, source_name, confidence, updated_at, layout_json FROM event_maps WHERE event_id = 'ff47';",
], { cwd: root, encoding: "utf8" });

const [execution] = JSON.parse(stdout);
const row = execution?.results?.[0];
if (!row) throw new Error("Local D1 does not contain a published ff47 event map.");

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
console.log(`Exported ff47 revision ${snapshot.revision}: ${slotCount} slots, ${layout.landmarks.length} landmarks.`);
