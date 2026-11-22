/**
 * The layout of the event data bucket (#546).
 *
 * `index.json` is the one pointer readers and publishers follow: the events
 * readers are offered, in order, each with its current version and files, and
 * the version of the circle identity registry those files were built with.
 *
 *   index.json
 *   events/<eventId>/<version>/<file>          public files the index lists
 *   events/<eventId>/<version>/source/<file>   publication inputs, never served
 *   registry/<version>/allocations.json        circle identity registry
 *   registry/<version>/evidence.json
 *
 * Versions are written once. A publication writes every new object first and
 * `index.json` last, so readers and the next publication see the old state or
 * the new one, never a mix.
 */

export const EVENT_INDEX_KEY = "index.json";
export const EVENT_INDEX_SCHEMA = "event-index/1";

/** The approved candidate a version was published from; absent for versions uploaded from the data repository. */
export type PublishedSource = { candidateId: string; candidateVersion: number; approvalHash: string };

export type EventIndexEntry = {
  eventId: string;
  version: string;
  files: string[];
  definition: unknown;
  references: unknown;
  source?: PublishedSource;
  sourceFiles?: string[];
};

export type EventIndex = { schema: typeof EVENT_INDEX_SCHEMA; registry?: string; events: EventIndexEntry[] };

/** The part of an R2 binding the bucket layout needs. */
export type EventDataBucket = {
  get(key: string): Promise<{ text(): Promise<string>; etag?: string } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches: string } }): Promise<unknown>;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_FILE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;

export const isSafeEventId = (value: string) => SAFE_ID.test(value);
export const isSafeEventFile = (value: string) => SAFE_FILE.test(value) && !value.split("/").includes("..");

export const eventFileKey = (eventId: string, version: string, file: string) => `events/${eventId}/${version}/${file}`;
export const eventSourceKey = (eventId: string, version: string, file: string) => `events/${eventId}/${version}/source/${file}`;
export const registryKey = (version: string, file: "allocations.json" | "evidence.json") => `registry/${version}/${file}`;

/** A sortable timestamp: a later publication always carries a later version. */
export function newEventDataVersion(now: number) {
  return new Date(now).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

export function parseEventIndex(value: unknown): EventIndex {
  const index = value as Partial<EventIndex> | null;
  if (!index || index.schema !== EVENT_INDEX_SCHEMA || !Array.isArray(index.events)) throw new Error("Event index has an unknown shape.");
  if (index.registry !== undefined && (typeof index.registry !== "string" || !SAFE_ID.test(index.registry))) throw new Error("Event index has an invalid registry version.");
  const seen = new Set<string>();
  for (const entry of index.events) {
    if (!entry || typeof entry.eventId !== "string" || !SAFE_ID.test(entry.eventId) || seen.has(entry.eventId)) throw new Error("Event index names an invalid event.");
    if (typeof entry.version !== "string" || !SAFE_ID.test(entry.version)) throw new Error(`Event index has an invalid version for ${entry.eventId}.`);
    for (const list of [entry.files, entry.sourceFiles ?? []]) {
      if (!Array.isArray(list) || !list.every((file) => typeof file === "string" && isSafeEventFile(file))) {
        throw new Error(`Event index has an invalid file list for ${entry.eventId}.`);
      }
    }
    seen.add(entry.eventId);
  }
  return index as EventIndex;
}

/** The index and the ETag a publication must still match when it replaces it. */
export async function readEventIndexObject(bucket: Pick<EventDataBucket, "get">): Promise<{ index: EventIndex; etag: string | undefined } | null> {
  const object = await bucket.get(EVENT_INDEX_KEY);
  if (!object) return null;
  return { index: parseEventIndex(JSON.parse(await object.text())), etag: object.etag };
}

export async function readBucketJson(bucket: Pick<EventDataBucket, "get">, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Event data object ${key} is missing.`);
  return JSON.parse(await object.text());
}
