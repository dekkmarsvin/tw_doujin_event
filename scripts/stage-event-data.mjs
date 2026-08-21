import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = process.argv.includes("--fixture");
const requested = process.argv.find((value, index) => index > 1 && !value.startsWith("--"));
const eventId = fixture ? (requested ?? "sample") : requested;
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) throw new Error("Usage: npm run data:stage -- (--fixture | <event-id>)");

const source = fixture
  ? path.join(root, "fixtures", "events", eventId)
  : path.join(root, ".event-data", eventId);
const event = JSON.parse(await readFile(path.join(source, "event.json"), "utf8"));
if (event.id !== eventId) throw new Error(`Staged event identity mismatch: expected ${eventId}, got ${event.id}.`);

const publicRoot = path.resolve(root, "public", "data", "events");
if (path.dirname(publicRoot) !== path.resolve(root, "public", "data")) throw new Error("Refusing to replace an unexpected public data path.");
await rm(publicRoot, { recursive: true, force: true });
const destination = path.join(publicRoot, eventId);
await mkdir(destination, { recursive: true });
await cp(path.join(source, "event.json"), path.join(destination, "event.json"));
await cp(path.join(source, "map.json"), path.join(destination, "map.json"));

if (fixture) {
  await cp(path.join(source, "circles.json"), path.join(destination, "circles.json"));
} else {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", "build-official-circle-catalog.mjs"), eventId], { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Official catalog builder exited ${code}.`)));
  });
}

await writeFile(path.join(root, ".event-data-stage.json"), `${JSON.stringify({ eventId, source: fixture ? "fixture" : "pin" })}\n`);
console.log(`Staged ${eventId} (${fixture ? "fixture" : "pinned data"}) for the Pages build.`);
