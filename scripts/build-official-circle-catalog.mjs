import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertExactOrganizerEvidenceCoverage, consumeOrganizerEvidenceKey } from "./official-catalog-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventId = process.argv[2];
const check = process.argv.includes("--check");
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) throw new Error("Usage: node scripts/build-official-circle-catalog.mjs <event-id> [--check]");

const dataDir = path.join(root, ".event-data", eventId);
const outputPath = path.join(root, "public", "data", "events", eventId, "circles.json");
const [event, official, evidence] = await Promise.all([
  readFile(path.join(dataDir, "event.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDir, "official-booths.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "circle-identities", "evidence.json"), "utf8").then(JSON.parse),
]);
if (event.id !== eventId) throw new Error(`Event definition identity mismatch: expected ${eventId}, got ${event.id}.`);
const defaultArea = event.areas?.[0]?.id;
if (typeof defaultArea !== "string" || !defaultArea) throw new Error("Event definition must declare a default area.");
if (!Array.isArray(official.days) || official.days.length === 0) throw new Error("Official booth data has no days.");

const normalize = (value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
const sourceIndex = new Map();
for (const entry of evidence.entries) {
  for (const source of entry.sources) {
    if (source.eventId !== eventId || source.kind !== "organizer-booth") continue;
    if (sourceIndex.has(source.value)) throw new Error(`Organizer source ${source.value} belongs to more than one circle.`);
    sourceIndex.set(source.value, entry);
  }
}

const circlesById = new Map();
const placements = [];
const consumedSources = new Set();
for (const day of official.days) {
  if (!event.days.some((candidate) => String(candidate.id) === String(day.day))) throw new Error(`Official data contains undeclared day ${day.day}.`);
  for (const group of day.booths) {
    const keys = group.codes.map((code) => `${day.day}:${code}`);
    keys.forEach((key) => consumeOrganizerEvidenceKey(consumedSources, key));
    const entries = keys.map((key) => sourceIndex.get(key));
    if (entries.some((entry) => !entry)) throw new Error(`Official group ${day.day}:${group.codes.join(",")} has no reviewed circle identity.`);
    const ids = new Set(entries.map((entry) => entry.circleId));
    if (ids.size !== 1) throw new Error(`Official group ${day.day}:${group.codes.join(",")} resolves to multiple circle identities.`);
    const [entry] = entries;
    if (normalize(entry.currentName) !== normalize(group.name)) {
      throw new Error(`Organizer name drift for ${day.day}:${group.codes[0]}: evidence=${entry.currentName}, official=${group.name}.`);
    }
    circlesById.set(entry.circleId, { id: entry.circleId, name: group.name });
    for (const code of group.codes) {
      placements.push({
        id: `${day.day}-${code.toLocaleLowerCase("en-US")}`,
        circleId: entry.circleId,
        day: day.day,
        area: defaultArea,
        boothCode: code,
        status: "active",
        tone: "mint",
      });
    }
  }
}

assertExactOrganizerEvidenceCoverage(new Set(sourceIndex.keys()), consumedSources);
const payload = {
  schema: "circle-catalog/3",
  eventId,
  generatedAt: event.dataUpdatedAt,
  circles: [...circlesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  placements,
};
const serialized = `${JSON.stringify(payload)}\n`;
if (check) {
  const current = await readFile(outputPath, "utf8");
  if (current !== serialized) throw new Error(`${path.relative(root, outputPath)} is stale.`);
  console.log(`Verified official-only ${eventId} catalog: ${payload.circles.length} circles, ${placements.length} placements.`);
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
  console.log(`Built official-only ${eventId} catalog: ${payload.circles.length} circles, ${placements.length} placements.`);
}
