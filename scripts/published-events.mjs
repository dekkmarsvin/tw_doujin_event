import path from "node:path";
import { readJsonFileStrict } from "./strict-json-file.mjs";

export const PUBLISHED_EVENTS_SCHEMA = "published-events/1";
export const PUBLISHED_EVENTS_FILE = path.join("data", "published-events.json");

const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The list of events production serves, and the order the reader offers them
 * in. Deliberately separate from `data/event-data-pins/`: a pin can exist for
 * an event that is prepared but not public yet, and only this file decides what
 * a reader can reach (ADR-0044's draft/published boundary).
 *
 * Adding an event is a data edit here plus its pin — no code, no workflow and
 * no build command names an event.
 */
export function parsePublishedEvents(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Published events must be an object.");
  }
  if (value.schema !== PUBLISHED_EVENTS_SCHEMA) {
    throw new Error(`Published events schema must be ${PUBLISHED_EVENTS_SCHEMA}.`);
  }
  if (Object.keys(value).length !== 2) {
    throw new Error("Published events must carry exactly `schema` and `events`.");
  }
  if (!Array.isArray(value.events) || value.events.length === 0) {
    throw new Error("Published events must list at least one event.");
  }
  if (!value.events.every((eventId) => typeof eventId === "string" && EVENT_ID.test(eventId))) {
    throw new Error("Every published event id must be lower-case alphanumeric with dashes.");
  }
  if (new Set(value.events).size !== value.events.length) {
    throw new Error("Published events must not repeat an event id.");
  }
  return Object.freeze([...value.events]);
}

export async function readPublishedEvents(root) {
  return parsePublishedEvents(
    await readJsonFileStrict(path.join(root, PUBLISHED_EVENTS_FILE), PUBLISHED_EVENTS_FILE),
  );
}
