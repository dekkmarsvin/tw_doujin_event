import path from "node:path";
import { readJsonFileStrict } from "./strict-json-file.mjs";
import { parsePublishedEvents } from "../app/published-events.mjs";
export { parsePublishedEvents, PUBLISHED_EVENTS_SCHEMA } from "../app/published-events.mjs";
const PUBLISHED_EVENTS_FILE = path.join("data", "published-events.json");

export async function readPublishedEvents(root) {
  return parsePublishedEvents(
    await readJsonFileStrict(path.join(root, PUBLISHED_EVENTS_FILE), PUBLISHED_EVENTS_FILE),
  );
}
