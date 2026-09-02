import { readFile } from "node:fs/promises";
import { MAP_MANIFEST_FILE, eventUsesScopedMaps } from "./event-data-pin-utils.mjs";

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error("Usage: node scripts/smoke-published-events.mjs <base-url>");
const published = JSON.parse(await readFile(new URL("../data/published-events.json", import.meta.url), "utf8"));
const eventIds = Array.isArray(published) ? published : published.events?.map((entry) => typeof entry === "string" ? entry : entry.eventId ?? entry.id);
if (!Array.isArray(eventIds) || eventIds.length === 0 || eventIds.some((id) => typeof id !== "string")) {
  throw new Error("Published event registry is invalid.");
}

async function read(path, label) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "error", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
  return response;
}

/** Only a 404 means "this event does not scope its maps". Any other failure is
 * a broken deployment and still has to fail the smoke test. */
async function readOptional(path, label) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "error", headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
  return response;
}

for (const eventId of eventIds) {
  const prefix = `/data/events/${encodeURIComponent(eventId)}`;
  const [event, catalog] = await Promise.all([
    read(`${prefix}/event.json`, `${eventId} event`).then((response) => response.json()),
    read(`${prefix}/circles.json`, `${eventId} catalog`).then((response) => response.json()),
    read(`${prefix}/reference-records.json`, `${eventId} references`),
  ]);
  if (event.id !== eventId || catalog.eventId !== eventId) throw new Error(`${eventId} deployed artifact identity mismatch.`);
  // Two days in one hall can each have their own layout, so probe for the
  // manifest instead of inferring it from the hall count.
  const manifestResponse = eventUsesScopedMaps(event)
    ? await readOptional(`${prefix}/${MAP_MANIFEST_FILE}`, `${eventId} map manifest`)
    : null;
  if (manifestResponse) {
    const manifest = await manifestResponse.json();
    if (manifest.eventId !== eventId || !Array.isArray(manifest.maps) || manifest.maps.length === 0) throw new Error(`${eventId} map manifest is invalid.`);
    await Promise.all(manifest.maps.map(({ path }) => read(`${prefix}/${path}`, `${eventId} map ${path}`).then(async (response) => {
      const map = await response.json();
      if (map.eventId !== eventId) throw new Error(`${eventId} map ${path} identity mismatch.`);
    })));
  } else {
    const map = await read(`${prefix}/map.json`, `${eventId} map`).then((response) => response.json());
    if (map.eventId !== eventId) throw new Error(`${eventId} map identity mismatch.`);
  }
  const reader = await fetch(new URL(`/?event=${encodeURIComponent(eventId)}`, baseUrl), { redirect: "error" });
  if (!reader.ok || !(reader.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(`${eventId} Reader route returned ${reader.status}.`);
  }
  console.log(`Verified deployed event ${eventId}: definition, catalog, references, maps and Reader route.`);
}
