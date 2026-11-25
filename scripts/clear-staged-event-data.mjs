/**
 * A deploy build carries no event data (#546): deployed pages read the
 * published events from the server. Clear anything a fixture or data stage
 * left behind so it cannot end up in `dist` or the bundle.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(root, ".event-data-stage.json"), { force: true });
await rm(path.join(root, "public", "data", "events"), { recursive: true, force: true });
