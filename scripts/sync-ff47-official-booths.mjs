/**
 * Sync the organizer's daily booth lists into a versioned local snapshot.
 * The official site is the placement authority (ADR-0012); this is the same
 * shape as the workbook sync — report drift first, replace only on request,
 * commit the result.
 *
 *   node scripts/sync-ff47-official-booths.mjs --check     reports drift, writes nothing
 *   node scripts/sync-ff47-official-booths.mjs --update    replaces the snapshot
 */
import { readFile, writeFile } from "node:fs/promises";
import { diffOfficialSnapshots, indexOfficialBooths, parseOfficialBoothTable } from "./official-booth-utils.mjs";

/**
 * The reading side already links to these pages through
 * the organizer URLs in `data/events/ff47/event.json`; scripts cannot
 * import TypeScript, so the URLs are repeated here. Changing one means
 * changing both.
 */
const DAY_SOURCES = [
  { day: 1, url: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%80%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/" },
  { day: 2, url: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%BA%8C%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/" },
  { day: 3, url: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%89%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/" },
];

const SNAPSHOT_PATH = "data_source_test/ff47-official-booths.json";
const SCHEMA_VERSION = 1;

const mode = process.argv.includes("--update") ? "update" : process.argv.includes("--check") ? "check" : undefined;
if (!mode) throw new Error("Choose --check to report drift or --update to replace the local snapshot.");

async function downloadDay({ day, url }) {
  const response = await fetch(url, { headers: { "User-Agent": "tw-doujin-event-source-sync/1.0" }, redirect: "follow" });
  if (!response.ok) throw new Error(`Day ${day} download failed: HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

function printDiff(before, after) {
  const { added, removed, renamed } = diffOfficialSnapshots(before, after);
  if (!added.length && !removed.length && !renamed.length) {
    console.log(`No official booth changes detected (${indexOfficialBooths(after).size} booths).`);
    return false;
  }
  const current = indexOfficialBooths(after);
  const previous = indexOfficialBooths(before);
  console.log(`Official booth lists differ: ${added.length} added, ${removed.length} removed, ${renamed.length} renamed.`);
  for (const key of added.slice(0, 20)) console.log(`+ ${key} ${current.get(key)}`);
  for (const key of removed.slice(0, 20)) console.log(`- ${key} ${previous.get(key)}`);
  for (const change of renamed.slice(0, 20)) console.log(`~ ${change.key} ${change.before} -> ${change.after}`);
  return true;
}

const days = await Promise.all(DAY_SOURCES.map(async (source) => ({
  day: source.day,
  url: source.url,
  booths: parseOfficialBoothTable(await downloadDay(source), source),
})));

const snapshot = { schemaVersion: SCHEMA_VERSION, days };
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;

const existing = await readFile(SNAPSHOT_PATH, "utf8").catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});

if (mode === "check") {
  if (existing === undefined) {
    console.error(`No local snapshot at ${SNAPSHOT_PATH}. Run npm run official:update.`);
    process.exitCode = 1;
  } else if (printDiff(JSON.parse(existing), snapshot) || existing !== serialized) {
    process.exitCode = 1;
  }
} else {
  if (existing !== undefined) printDiff(JSON.parse(existing), snapshot);
  await writeFile(SNAPSHOT_PATH, serialized);
  console.log(`Updated ${SNAPSHOT_PATH} with ${indexOfficialBooths(snapshot).size} booths across ${days.length} days.`);
}
