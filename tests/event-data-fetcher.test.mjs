import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchEventData, stageEventData } from "../scripts/event-data-fetcher.mjs";
import { EVENT_DATA_REPOSITORY, sha256 } from "../scripts/event-data-pin-utils.mjs";
import { recoverInterruptedReplacement, replaceVerifiedTrees } from "../scripts/verified-tree-replace.mjs";

const eventId = "event-alpha";
const commit = "1".repeat(40);
const source = {
  id: "official-page",
  kind: "organizer-official",
  url: "https://organizer.example.invalid/reference",
  retrievedAt: "2026-01-01T00:00:00Z",
};
const venueSource = { ...source, kind: "venue-official", url: "https://venue.example.invalid/reference" };

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

const referenceSelection = {
  schema: "reference-selection/1",
  eventId,
  organizers: [{ id: "example-organizer", path: "references/organizers/example-organizer.json" }],
  categoryCatalog: {
    id: "main",
    organizerId: "example-organizer",
    revision: "2026-01-01",
    path: "references/category-catalogs/example-organizer/main/2026-01-01.json",
  },
  venues: [{
    id: "example-venue",
    path: "references/venues/example-venue.json",
    spaces: [{ id: "example-hall", path: "references/venue-spaces/example-hall.json" }],
  }],
};

const bytesByPath = new Map([
  [`events/${eventId}/event.json`, jsonBytes({
    id: eventId,
    organizerAssignments: [{ organizerId: "example-organizer", role: "lead" }],
    categoryCatalog: { organizerId: "example-organizer", id: "main", revision: "2026-01-01" },
    venueAssignments: [{ venueId: "example-venue", venueSpaceId: "example-hall", areaIds: ["all"] }],
  })],
  [`events/${eventId}/official-booths.json`, jsonBytes({ schema: "official-booths/1" })],
  [`events/${eventId}/circle-identity-groups.json`, jsonBytes({
    schema: "circle-identity-groups/1", eventId, groups: [{ sources: ["1:A01"] }],
  })],
  [`events/${eventId}/map.json`, jsonBytes({ schema: "event-map/1" })],
  [`events/${eventId}/reference-selection.json`, jsonBytes(referenceSelection)],
  ["references/organizers/example-organizer.json", jsonBytes({
    schema: "organizer/1", id: "example-organizer", name: "虛構主辦", officialUrl: source.url,
    sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })],
  ["references/category-catalogs/example-organizer/main/2026-01-01.json", jsonBytes({
    schema: "category-catalog/1", id: "main", organizerId: "example-organizer", revision: "2026-01-01",
    categories: [{ id: "illustration", label: "插畫" }], sources: [source], provenance: { "/categories/0/label": [source.id] },
  })],
  ["references/venues/example-venue.json", jsonBytes({
    schema: "venue/1", id: "example-venue", name: "虛構場館", officialUrl: venueSource.url,
    sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })],
  ["references/venue-spaces/example-hall.json", jsonBytes({
    schema: "venue-space/1", id: "example-hall", venueId: "example-venue", name: "虛構展館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  })],
]);

const pin = {
  schema: "event-data-pin/2",
  eventId,
  repository: EVENT_DATA_REPOSITORY,
  commit,
  files: [...bytesByPath].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) })),
};

function fetchFrom(overrides = new Map()) {
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    const prefix = `https://raw.githubusercontent.com/${EVENT_DATA_REPOSITORY}/${commit}/`;
    assert.equal(url.startsWith(prefix), true, "the fetch URL must name the pinned commit, never a branch");
    const filePath = url.slice(prefix.length);
    if (overrides.has(filePath)) {
      const override = overrides.get(filePath);
      return override instanceof Error ? { ok: false, status: 503 } : new Response(override);
    }
    return bytesByPath.has(filePath) ? new Response(bytesByPath.get(filePath)) : new Response("missing", { status: 404 });
  };
}

async function temporaryRoot(t, label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("one fetch installs the event folder flat and references at their repository path", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-success");
  const destination = path.join(root, eventId);
  await fetchEventData(pin, destination, fetchFrom());
  assert.deepEqual(await readFile(path.join(destination, "event.json")), bytesByPath.get(`events/${eventId}/event.json`));
  assert.deepEqual(
    await readFile(path.join(destination, "references/organizers/example-organizer.json")),
    bytesByPath.get("references/organizers/example-organizer.json"),
  );
  await assert.rejects(readFile(path.join(destination, "events", eventId, "event.json")), /ENOENT/);
});

test("a hash mismatch on any pinned file preserves the previous verified tree", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-hash");
  const destination = path.join(root, eventId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const tampered = fetchFrom(new Map([["references/venues/example-venue.json", Buffer.from("{}")]]));
  await assert.rejects(stageEventData(pin, destination, tampered), /SHA-256 mismatch/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
});

test("a failed download preserves the previous verified tree", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-failure");
  const destination = path.join(root, eventId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const failing = fetchFrom(new Map([[`events/${eventId}/map.json`, new Error("unavailable")]]));
  await assert.rejects(fetchEventData(pin, destination, failing), /HTTP 503/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
});

test("a selection that does not cover the pinned references fails before replacement", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-selection");
  const destination = path.join(root, eventId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const narrowed = structuredClone(referenceSelection);
  narrowed.venues[0].spaces = [{ id: "example-hall", path: "references/venue-spaces/example-hall.json" }];
  narrowed.organizers = [{ id: "example-organizer", path: "references/organizers/example-organizer.json" }];
  const narrowedBytes = jsonBytes(narrowed);
  const narrowedPin = structuredClone(pin);
  // Drop a pinned reference the selection still names.
  narrowedPin.files = narrowedPin.files.filter(({ path: filePath }) => filePath !== "references/venues/example-venue.json");
  narrowedPin.files.find(({ path: filePath }) => filePath.endsWith("reference-selection.json")).sha256 = sha256(narrowedBytes);
  const overrides = new Map([[`events/${eventId}/reference-selection.json`, narrowedBytes]]);
  await assert.rejects(stageEventData(narrowedPin, destination, fetchFrom(overrides)), /Selected reference file is missing/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
});

test("rename failure restores the previous verified tree", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-rename");
  const destination = path.join(root, eventId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const renameWithFailure = async (sourcePath, destinationPath) => {
    if (sourcePath.includes(`.tmp-${eventId}-`) && destinationPath === destination) {
      throw Object.assign(new Error("simulated rename failure"), { code: "EIO" });
    }
    return rename(sourcePath, destinationPath);
  };
  await assert.rejects(fetchEventData(pin, destination, fetchFrom(), { rename: renameWithFailure }), /simulated rename failure/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
  await assert.rejects(readFile(`${destination}.previous`), /ENOENT/);
});

test("the next run recovers an interrupted directory swap", async (t) => {
  const root = await temporaryRoot(t, "event-fetch-recovery");
  const destination = path.join(root, eventId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  await rename(destination, `${destination}.previous`);
  await recoverInterruptedReplacement(destination);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
  await assert.rejects(readFile(`${destination}.previous`), /ENOENT/);
});

test("paired replacement rolls every tree back when any rename fails", async (t) => {
  const root = await temporaryRoot(t, "paired-rollback");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const nextFirst = path.join(root, "next-first");
  const nextSecond = path.join(root, "next-second");
  for (const directory of [first, second, nextFirst, nextSecond]) await mkdir(directory);
  await Promise.all([
    writeFile(path.join(first, "sentinel.txt"), "old-first"),
    writeFile(path.join(second, "sentinel.txt"), "old-second"),
    writeFile(path.join(nextFirst, "sentinel.txt"), "new-first"),
    writeFile(path.join(nextSecond, "sentinel.txt"), "new-second"),
  ]);
  const renameWithFailure = async (sourcePath, destinationPath) => {
    if (sourcePath === nextSecond && destinationPath === second) throw new Error("simulated paired rename failure");
    return rename(sourcePath, destinationPath);
  };
  await assert.rejects(replaceVerifiedTrees([
    { temporary: nextFirst, destination: first },
    { temporary: nextSecond, destination: second },
  ], { rename: renameWithFailure }), /simulated paired rename failure/);
  assert.equal(await readFile(path.join(first, "sentinel.txt"), "utf8"), "old-first");
  assert.equal(await readFile(path.join(second, "sentinel.txt"), "utf8"), "old-second");
});
