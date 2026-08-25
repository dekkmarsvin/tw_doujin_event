import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchReferenceData, recoverInterruptedReferenceReplacement, replaceVerifiedTrees } from "../scripts/reference-data-fetcher.mjs";
import {
  parseReferenceDataPin,
  rawReferenceFileUrl,
  selectEventReferenceRecords,
  sha256,
  verifyReferenceDataFiles,
} from "../scripts/reference-data-pin-utils.mjs";

const source = {
  id: "official-page",
  kind: "organizer-official",
  url: "https://organizer.example.invalid/reference",
  retrievedAt: "2026-01-01T00:00:00Z",
};
const venueSource = { ...source, kind: "venue-official", url: "https://venue.example.invalid/reference" };
const records = new Map([
  ["data/organizers/example-organizer.json", Buffer.from(JSON.stringify({
    schema: "organizer/1", id: "example-organizer", name: "虛構主辦", officialUrl: source.url,
    sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  }))],
  ["data/category-catalogs/example-organizer/main/2026-01-01.json", Buffer.from(JSON.stringify({
    schema: "category-catalog/1", id: "main", organizerId: "example-organizer", revision: "2026-01-01",
    categories: [{ id: "illustration", label: "插畫" }], sources: [source], provenance: { "/categories/0/label": [source.id] },
  }))],
  ["data/venues/example-venue.json", Buffer.from(JSON.stringify({
    schema: "venue/1", id: "example-venue", name: "虛構場館", officialUrl: venueSource.url,
    sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  }))],
  ["data/venue-spaces/example-hall.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "example-hall", venueId: "example-venue", name: "虛構展館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  }))],
]);

const pin = {
  schema: "reference-data-pin/2",
  eventId: "event-alpha",
  repository: "dekkmarsvin/tw_doujin_event-reference-data",
  commit: "1".repeat(40),
  files: [...records].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) })),
  selection: {
    organizers: [{ id: "example-organizer", path: "data/organizers/example-organizer.json" }],
    categoryCatalog: { id: "main", organizerId: "example-organizer", revision: "2026-01-01", path: "data/category-catalogs/example-organizer/main/2026-01-01.json" },
    venues: [{
      id: "example-venue",
      path: "data/venues/example-venue.json",
      spaces: [{ id: "example-hall", path: "data/venue-spaces/example-hall.json" }],
    }],
  },
};

const event = {
  id: "event-alpha",
  organizerAssignments: [{ organizerId: "example-organizer", role: "lead" }],
  categoryCatalog: { organizerId: "example-organizer", id: "main", revision: "2026-01-01" },
  venueAssignments: [{ venueId: "example-venue", venueSpaceId: "example-hall", areaIds: ["all"] }],
};

test("reference pin uses an immutable commit and per-file hashes", () => {
  const parsed = parseReferenceDataPin(pin);
  assert.match(parsed.commit, /^[0-9a-f]{40}$/);
  for (const file of parsed.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    const url = rawReferenceFileUrl(parsed, file);
    assert.match(url, new RegExp(parsed.commit));
    assert.equal(url.startsWith(`https://raw.githubusercontent.com/${parsed.repository}/main/`), false);
  }
  const verified = verifyReferenceDataFiles(parsed, records);
  assert.equal(verified.records.size, 4);
  assert.equal(selectEventReferenceRecords(parsed, verified.records, event).length, 4);
});

test("reference verification fails closed for pin, hash, schema and stable-id mismatches", () => {
  assert.throws(() => parseReferenceDataPin({ ...pin, commit: "main" }), /full commit SHA/);
  assert.throws(() => parseReferenceDataPin({ ...pin, files: [{ path: "../secret.json", sha256: "0".repeat(64) }] }), /path is invalid/);
  assert.throws(() => parseReferenceDataPin({ ...pin, files: [{ path: "data/../secret.json", sha256: "0".repeat(64) }] }), /path is invalid/);
  const badHash = structuredClone(pin);
  badHash.files[0].sha256 = "0".repeat(64);
  assert.throws(() => verifyReferenceDataFiles(badHash, records), /SHA-256 mismatch/);
  const unknown = structuredClone(pin);
  unknown.selection.organizers[0].id = "unknown-organizer";
  assert.throws(() => verifyReferenceDataFiles(unknown, records), /Category catalog organizer must be selected/);

  const pathName = pin.selection.categoryCatalog.path;
  const wrongSchemaRecords = new Map(records);
  const changed = Buffer.from(records.get(pathName).toString("utf8").replace("category-catalog/1", "category-catalog/2"));
  wrongSchemaRecords.set(pathName, changed);
  const wrongSchema = structuredClone(pin);
  wrongSchema.files.find((file) => file.path === pathName).sha256 = sha256(changed);
  assert.throws(() => verifyReferenceDataFiles(wrongSchema, wrongSchemaRecords), /unsupported reference schema/);

  const organizerPath = pin.selection.organizers[0].path;
  const malformedUtf8Records = new Map(records);
  const organizerBytes = records.get(organizerPath);
  const organizerName = Buffer.from("虛構主辦");
  const organizerNameOffset = organizerBytes.indexOf(organizerName);
  const malformedUtf8 = Buffer.concat([
    organizerBytes.subarray(0, organizerNameOffset),
    Buffer.from([0xc3, 0x28]),
    organizerBytes.subarray(organizerNameOffset + organizerName.length),
  ]);
  malformedUtf8Records.set(organizerPath, malformedUtf8);
  const malformedUtf8Pin = structuredClone(pin);
  malformedUtf8Pin.files.find((file) => file.path === organizerPath).sha256 = sha256(malformedUtf8);
  assert.throws(() => verifyReferenceDataFiles(malformedUtf8Pin, malformedUtf8Records), /not valid JSON/);

  const wrongAuthorityRecords = new Map(records);
  const wrongAuthority = Buffer.from(records.get(organizerPath).toString("utf8").replace("organizer-official", "venue-official"));
  wrongAuthorityRecords.set(organizerPath, wrongAuthority);
  const wrongAuthorityPin = structuredClone(pin);
  wrongAuthorityPin.files.find((file) => file.path === organizerPath).sha256 = sha256(wrongAuthority);
  assert.throws(() => verifyReferenceDataFiles(wrongAuthorityPin, wrongAuthorityRecords), /kind is invalid/);

  const malformedUrlRecords = new Map(records);
  const malformedUrl = Buffer.from(records.get(organizerPath).toString("utf8").replaceAll("https://organizer.example.invalid", "https:organizer.example.invalid"));
  malformedUrlRecords.set(organizerPath, malformedUrl);
  const malformedUrlPin = structuredClone(pin);
  malformedUrlPin.files.find((file) => file.path === organizerPath).sha256 = sha256(malformedUrl);
  assert.throws(() => verifyReferenceDataFiles(malformedUrlPin, malformedUrlRecords), /must use HTTPS/);

  const invalidDateRecords = new Map(records);
  const invalidDate = Buffer.from(records.get(organizerPath).toString("utf8").replaceAll("2026-01-01T00:00:00Z", "2026-02-30T00:00:00Z"));
  invalidDateRecords.set(organizerPath, invalidDate);
  const invalidDatePin = structuredClone(pin);
  invalidDatePin.files.find((file) => file.path === organizerPath).sha256 = sha256(invalidDate);
  assert.throws(() => verifyReferenceDataFiles(invalidDatePin, invalidDateRecords), /must be an ISO timestamp/);

  const duplicateProvenanceRecords = new Map(records);
  const duplicateProvenance = Buffer.from(records.get(organizerPath).toString("utf8").replace(`"/name":["official-page"]`, `"/name":["official-page","official-page"]`));
  duplicateProvenanceRecords.set(organizerPath, duplicateProvenance);
  const duplicateProvenancePin = structuredClone(pin);
  duplicateProvenancePin.files.find((file) => file.path === organizerPath).sha256 = sha256(duplicateProvenance);
  assert.throws(() => verifyReferenceDataFiles(duplicateProvenancePin, duplicateProvenanceRecords), /duplicate source ids/);
});

test("event assignments must exactly match every selected reference", () => {
  const verified = verifyReferenceDataFiles(pin, records);
  assert.throws(() => selectEventReferenceRecords(pin, verified.records, {
    ...event,
    organizerAssignments: [{ organizerId: "unselected", role: "lead" }],
  }), /organizer assignments do not match/);
  const extraFile = structuredClone(pin);
  extraFile.files.push({ path: "data/organizers/unselected.json", sha256: "0".repeat(64) });
  assert.throws(() => parseReferenceDataPin(extraFile), /must be selected exactly once/);
});

test("reference pin v2 supports plural organizers, venues and spaces as exact sets", () => {
  const pluralRecords = new Map(records);
  pluralRecords.set("data/organizers/partner-organizer.json", Buffer.from(JSON.stringify({
    schema: "organizer/1", id: "partner-organizer", name: "協力主辦", officialUrl: source.url,
    sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })));
  pluralRecords.set("data/venue-spaces/example-annex.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "example-annex", venueId: "example-venue", name: "虛構副館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  })));
  pluralRecords.set("data/venues/second-venue.json", Buffer.from(JSON.stringify({
    schema: "venue/1", id: "second-venue", name: "第二場館", officialUrl: venueSource.url,
    sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })));
  pluralRecords.set("data/venue-spaces/second-hall.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "second-hall", venueId: "second-venue", name: "第二展館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  })));
  const pluralPin = structuredClone(pin);
  pluralPin.files = [...pluralRecords].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) }));
  pluralPin.selection.organizers.push({ id: "partner-organizer", path: "data/organizers/partner-organizer.json" });
  pluralPin.selection.venues[0].spaces.push({ id: "example-annex", path: "data/venue-spaces/example-annex.json" });
  pluralPin.selection.venues.push({
    id: "second-venue",
    path: "data/venues/second-venue.json",
    spaces: [{ id: "second-hall", path: "data/venue-spaces/second-hall.json" }],
  });
  const pluralEvent = structuredClone(event);
  pluralEvent.organizerAssignments.push({ organizerId: "partner-organizer", role: "partner" });
  pluralEvent.venueAssignments.push(
    { venueId: "example-venue", venueSpaceId: "example-annex", areaIds: ["annex"] },
    { venueId: "second-venue", venueSpaceId: "second-hall", areaIds: ["second"] },
  );

  const verified = verifyReferenceDataFiles(pluralPin, pluralRecords);
  assert.equal(selectEventReferenceRecords(pluralPin, verified.records, pluralEvent).length, 8);

  const wrongCatalogRevision = structuredClone(pluralEvent);
  wrongCatalogRevision.categoryCatalog.revision = "2026-01-02";
  assert.throws(() => selectEventReferenceRecords(pluralPin, verified.records, wrongCatalogRevision), /category catalog does not match/);

  const missingSpace = structuredClone(pluralEvent);
  missingSpace.venueAssignments = missingSpace.venueAssignments.filter(({ venueSpaceId }) => venueSpaceId !== "example-annex");
  assert.throws(() => selectEventReferenceRecords(pluralPin, verified.records, missingSpace), /venue assignments do not match/);

  const extraSpace = structuredClone(pluralEvent);
  extraSpace.venueAssignments.push({ venueId: "second-venue", venueSpaceId: "unselected-hall", areaIds: ["extra"] });
  assert.throws(() => selectEventReferenceRecords(pluralPin, verified.records, extraSpace), /venue assignments do not match/);
});

test("failed fetch preserves the previous verified tree", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-fetch-failure-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "event-alpha");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const fetchImpl = async (url) => {
    const file = pin.files.find((candidate) => url.endsWith(candidate.path));
    if (file.path === pin.files[1].path) return { ok: false, status: 503 };
    return new Response(records.get(file.path));
  };
  await assert.rejects(fetchReferenceData(pin, destination, fetchImpl), /HTTP 503/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
});

test("rename failure restores the previous verified tree", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-fetch-rename-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "event-alpha");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  const fetchImpl = async (url) => {
    const file = pin.files.find((candidate) => url.endsWith(candidate.path));
    return new Response(records.get(file.path));
  };
  const renameWithFailure = async (sourcePath, destinationPath) => {
    if (sourcePath.includes(".tmp-reference-") && destinationPath === destination) throw Object.assign(new Error("simulated rename failure"), { code: "EIO" });
    return rename(sourcePath, destinationPath);
  };
  await assert.rejects(fetchReferenceData(pin, destination, fetchImpl, { rename: renameWithFailure }), /simulated rename failure/);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
  await assert.rejects(readFile(`${destination}.previous`), /ENOENT/);
});

test("the next run recovers an interrupted directory swap", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-fetch-recovery-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "event-alpha");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "sentinel.txt"), "previous");
  await rename(destination, `${destination}.previous`);
  await recoverInterruptedReferenceReplacement(destination);
  assert.equal(await readFile(path.join(destination, "sentinel.txt"), "utf8"), "previous");
  await assert.rejects(readFile(`${destination}.previous`), /ENOENT/);
});

test("successful fetch verifies then replaces the destination", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-fetch-success-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "event-alpha");
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, "error");
    const file = pin.files.find((candidate) => url.endsWith(candidate.path));
    return new Response(records.get(file.path));
  };
  await fetchReferenceData(pin, destination, fetchImpl);
  for (const [filePath, bytes] of records) {
    assert.deepEqual(await readFile(path.join(destination, filePath)), bytes);
  }
});

test("paired event and reference replacement rolls both trees back when either rename fails", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "paired-fetch-rollback-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const referenceDestination = path.join(temporary, "reference");
  const eventDestination = path.join(temporary, "event");
  const nextReference = path.join(temporary, "next-reference");
  const nextEvent = path.join(temporary, "next-event");
  for (const directory of [referenceDestination, eventDestination, nextReference, nextEvent]) await mkdir(directory);
  await Promise.all([
    writeFile(path.join(referenceDestination, "sentinel.txt"), "old-reference"),
    writeFile(path.join(eventDestination, "sentinel.txt"), "old-event"),
    writeFile(path.join(nextReference, "sentinel.txt"), "new-reference"),
    writeFile(path.join(nextEvent, "sentinel.txt"), "new-event"),
  ]);
  const renameWithFailure = async (sourcePath, destinationPath) => {
    if (sourcePath === nextEvent && destinationPath === eventDestination) throw new Error("simulated paired rename failure");
    return rename(sourcePath, destinationPath);
  };
  await assert.rejects(replaceVerifiedTrees([
    { temporary: nextReference, destination: referenceDestination },
    { temporary: nextEvent, destination: eventDestination },
  ], { rename: renameWithFailure }), /simulated paired rename failure/);
  assert.equal(await readFile(path.join(referenceDestination, "sentinel.txt"), "utf8"), "old-reference");
  assert.equal(await readFile(path.join(eventDestination, "sentinel.txt"), "utf8"), "old-event");
});
