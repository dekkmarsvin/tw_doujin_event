import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventDataPin, rawFileUrl, sha256 } from "./event-data-pin-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventId = process.argv[2];
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) throw new Error("Usage: npm run data:fetch -- <event-id>");

const pinPath = path.join(root, "data", "event-data-pins", `${eventId}.json`);
const pin = parseEventDataPin(JSON.parse(await readFile(pinPath, "utf8")));
const destination = path.join(root, ".event-data", eventId);
await mkdir(path.dirname(destination), { recursive: true });
// A sibling temp directory keeps the final rename atomic on Windows too; the
// system temp directory may be on C: while the checkout is on D: (EXDEV).
const temporary = await mkdtemp(path.join(path.dirname(destination), `.tmp-${eventId}-`));

try {
  for (const file of pin.files) {
    const response = await fetch(rawFileUrl(pin, file), { redirect: "error" });
    if (!response.ok) throw new Error(`Failed to fetch ${file.path}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}`);
    const output = path.join(temporary, file.path);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes);
  }
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
  console.log(`Fetched ${pin.repository}@${pin.commit} to ${path.relative(root, destination)}`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
