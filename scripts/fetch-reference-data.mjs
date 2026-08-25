import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReferenceData } from "./reference-data-fetcher.mjs";
import { parseReferenceDataPin } from "./reference-data-pin-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinArgument = process.argv[2];
if (!pinArgument || process.argv.length > 3) throw new Error("Usage: npm run reference-data:fetch -- <reference-data-pin.json>");
const pinPath = path.resolve(root, pinArgument);
const pin = parseReferenceDataPin(JSON.parse(await readFile(pinPath, "utf8")));
const destination = path.join(root, ".reference-data", pin.eventId);
await fetchReferenceData(pin, destination);
console.log(`Fetched ${pin.repository}@${pin.commit} to ${path.relative(root, destination)}`);
