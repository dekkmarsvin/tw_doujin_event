import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEventDataPinIdentity, parseEventDataPin, rawFileUrl, sha256 } from "./event-data-pin-utils.mjs";
import { replaceVerifiedTrees, stageReferenceData } from "./reference-data-fetcher.mjs";
import { parseJsonBytesStrict, readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [eventId, ...arguments_] = process.argv.slice(2);
const pinIndex = arguments_.indexOf("--pin");
const pinArgument = pinIndex >= 0 ? arguments_[pinIndex + 1] : null;
const expectedArguments = pinArgument ? ["--pin", pinArgument] : [];
if (!eventId || !/^[a-z0-9][a-z0-9-]*$/.test(eventId)
  || arguments_.length !== expectedArguments.length
  || arguments_.some((value, index) => value !== expectedArguments[index])) {
  throw new Error("Usage: npm run data:fetch -- <event-id> [--pin <event-data-pin.json>]");
}

const pinPath = pinArgument
  ? path.resolve(root, pinArgument)
  : path.join(root, "data", "event-data-pins", `${eventId}.json`);
const pin = assertEventDataPinIdentity(parseEventDataPin(await readJsonFileStrict(pinPath, `Event data pin ${eventId}`)), eventId);
const destination = path.join(root, ".event-data", eventId);
await mkdir(path.dirname(destination), { recursive: true });
// A sibling temp directory keeps the final rename atomic on Windows too; the
// system temp directory may be on C: while the checkout is on D: (EXDEV).
const temporary = await mkdtemp(path.join(path.dirname(destination), `.tmp-${eventId}-`));
let temporaryReference = null;

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
  if (!pin.files.some(({ path: filePath }) => filePath === "reference-data-pin.json")) {
    throw new Error("Pinned event data must include reference-data-pin.json.");
  }
  let referencePin;
  try {
    const bytes = await readFile(path.join(temporary, "reference-data-pin.json"));
    referencePin = parseJsonBytesStrict(bytes, "Pinned reference-data-pin.json");
  } catch {
    throw new Error("Pinned reference-data-pin.json is not valid UTF-8 JSON.");
  }
  if (referencePin.eventId !== eventId) throw new Error(`Reference data pin identity mismatch: expected ${eventId}, got ${referencePin.eventId}.`);
  const referenceDestination = path.join(root, ".reference-data", eventId);
  const stagedReference = await stageReferenceData(referencePin, referenceDestination);
  temporaryReference = stagedReference.temporary;
  await replaceVerifiedTrees([
    { temporary: temporaryReference, destination: referenceDestination },
    { temporary, destination },
  ]);
  console.log(`Fetched ${pin.repository}@${pin.commit} to ${path.relative(root, destination)}`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  if (temporaryReference) await rm(temporaryReference, { recursive: true, force: true });
  throw error;
}
