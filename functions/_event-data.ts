/**
 * Published event data, served from R2 (#546). The bucket layout is described
 * in `app/event-data-store.ts`.
 */

import { EVENT_INDEX_KEY, eventFileKey, isSafeEventFile, isSafeEventId, parseEventIndex, type EventIndex, type EventIndexEntry } from "../app/event-data-store";

export type { EventIndex, EventIndexEntry };

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
  if (!isSafeEventId(eventId) || !isSafeEventFile(file)) return new Response("Not found", { status: 404 });
  const entry = (await readEventIndex(env)).events.find((item) => item.eventId === eventId);
  if (!entry || !entry.files.includes(file)) return new Response("Not found", { status: 404 });
  const object = await env.EVENT_DATA.get(eventFileKey(eventId, entry.version, file));
  if (!object) throw new Error(`Published file ${eventId}/${file} is missing from its version.`);
  return conditional(request, object.httpEtag, () => object.body);
}
