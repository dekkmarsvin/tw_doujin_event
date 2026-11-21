/**
 * Published event data, read from R2 (#546).
 *
 * `index.json` is the one pointer: the events readers are offered, in order,
 * each with its current version, the files that version holds, and the event
 * definition and reference records the pages need before any file loads.
 * Files live under `events/<eventId>/<version>/<path>` and are never rewritten;
 * publishing writes a new version's files first and `index.json` last, so a
 * reader sees the old version or the new one, never a mix.
 */

export const EVENT_INDEX_KEY = "index.json";
export const EVENT_INDEX_SCHEMA = "event-index/1";

export type EventIndexEntry = {
  eventId: string;
  version: string;
  files: string[];
  definition: unknown;
  references: unknown;
};

export type EventIndex = { schema: typeof EVENT_INDEX_SCHEMA; events: EventIndexEntry[] };

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_FILE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;

export function eventFileKey(eventId: string, version: string, file: string) {
  return `events/${eventId}/${version}/${file}`;
}

export function parseEventIndex(value: unknown): EventIndex {
  const index = value as Partial<EventIndex> | null;
  if (!index || index.schema !== EVENT_INDEX_SCHEMA || !Array.isArray(index.events)) throw new Error("Event index has an unknown shape.");
  const seen = new Set<string>();
  for (const entry of index.events) {
    if (!entry || typeof entry.eventId !== "string" || !SAFE_ID.test(entry.eventId) || seen.has(entry.eventId)) throw new Error("Event index names an invalid event.");
    if (typeof entry.version !== "string" || !SAFE_ID.test(entry.version)) throw new Error(`Event index has an invalid version for ${entry.eventId}.`);
    if (!Array.isArray(entry.files) || !entry.files.every((file) => typeof file === "string" && SAFE_FILE.test(file) && !file.split("/").includes(".."))) {
      throw new Error(`Event index has an invalid file list for ${entry.eventId}.`);
    }
    seen.add(entry.eventId);
  }
  return index as EventIndex;
}

export async function readEventIndex(env: Pick<PortalEnv, "EVENT_DATA">): Promise<EventIndex> {
  const object = await env.EVENT_DATA.get(EVENT_INDEX_KEY);
  if (!object) throw new Error("No event index has been published.");
  return parseEventIndex(JSON.parse(await object.text()));
}

/** The definitions every page is built from, in reader order. */
export function publishedEventDefinitions(index: EventIndex) {
  return index.events.map(({ definition, references }) => ({ definition, references }));
}

/** One file of an index entry's version, parsed. The file must be listed. */
export async function readEntryJson(env: Pick<PortalEnv, "EVENT_DATA">, entry: EventIndexEntry, file: string): Promise<unknown> {
  if (!entry.files.includes(file)) throw new Error(`Published ${entry.eventId} has no ${file}.`);
  const object = await env.EVENT_DATA.get(eventFileKey(entry.eventId, entry.version, file));
  if (!object) throw new Error(`Published file ${entry.eventId}/${file} is missing from its version.`);
  return JSON.parse(await object.text());
}

/** A published file's parsed JSON, or null when the event or file is not published. */
export async function readEventJson(env: Pick<PortalEnv, "EVENT_DATA">, eventId: string, file: string): Promise<unknown> {
  const entry = (await readEventIndex(env)).events.find((item) => item.eventId === eventId);
  if (!entry || !entry.files.includes(file)) return null;
  return readEntryJson(env, entry, file);
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, must-revalidate", "x-content-type-options": "nosniff" };

function conditional(request: Request, etag: string, body: () => BodyInit | null) {
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...JSON_HEADERS, etag } });
  return new Response(request.method === "HEAD" ? null : body(), { headers: { ...JSON_HEADERS, etag } });
}

/** `GET /data/events/index.json` */
export async function eventIndexResponse(env: Pick<PortalEnv, "EVENT_DATA">, request: Request) {
  const object = await env.EVENT_DATA.get(EVENT_INDEX_KEY);
  if (!object) return new Response("Not found", { status: 404 });
  const text = await object.text();
  parseEventIndex(JSON.parse(text));
  return conditional(request, object.httpEtag, () => text);
}

/** `GET /data/events/<eventId>/<file>`: the current version's copy. */
export async function eventFileResponse(env: Pick<PortalEnv, "EVENT_DATA">, request: Request, eventId: string, file: string) {
  if (!SAFE_ID.test(eventId) || !SAFE_FILE.test(file)) return new Response("Not found", { status: 404 });
  const entry = (await readEventIndex(env)).events.find((item) => item.eventId === eventId);
  if (!entry || !entry.files.includes(file)) return new Response("Not found", { status: 404 });
  const object = await env.EVENT_DATA.get(eventFileKey(eventId, entry.version, file));
  if (!object) throw new Error(`Published file ${eventId}/${file} is missing from its version.`);
  return conditional(request, object.httpEtag, () => object.body);
}
