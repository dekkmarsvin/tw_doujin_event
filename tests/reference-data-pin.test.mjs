import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchReferenceData, recoverInterruptedReferenceReplacement } from "../scripts/reference-data-fetcher.mjs";
import {
  parseReferenceDataPin,
  rawReferenceFileUrl,
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
  schema: "reference-data-pin/1",
  eventId: "event-alpha",
  repository: "dekkmarsvin/tw_doujin_event-reference-data",
  commit: "1".repeat(40),
  files: [...records].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) })),
  selection: {
    organizer: { id: "example-organizer", path: "data/organizers/example-organizer.json" },
    categoryCatalog: { id: "main", organizerId: "example-organizer", revision: "2026-01-01", path: "data/category-catalogs/example-organizer/main/2026-01-01.json" },
    venue: { id: "example-venue", path: "data/venues/example-venue.json" },
    venueSpaces: [{ id: "example-hall", path: "data/venue-spaces/example-hall.json" }],
  },
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
  assert.equal(verifyReferenceDataFiles(parsed, records).records.size, 4);
});

test("reference verification fails closed for pin, hash, schema and stable-id mismatches", () => {
  assert.throws(() => parseReferenceDataPin({ ...pin, commit: "main" }), /full commit SHA/);
  assert.throws(() => parseReferenceDataPin({ ...pin, files: [{ path: "../secret.json", sha256: "0".repeat(64) }] }), /path is invalid/);
  assert.throws(() => parseReferenceDataPin({ ...pin, files: [{ path: "data/../secret.json", sha256: "0".repeat(64) }] }), /path is invalid/);
  const badHash = structuredClone(pin);
  badHash.files[0].sha256 = "0".repeat(64);
  assert.throws(() => verifyReferenceDataFiles(badHash, records), /SHA-256 mismatch/);
  const unknown = structuredClone(pin);
  unknown.selection.organizer.id = "unknown-organizer";
  assert.throws(() => verifyReferenceDataFiles(unknown, records), /Unknown organizer stable ID/);

  const pathName = pin.selection.categoryCatalog.path;
  const wrongSchemaRecords = new Map(records);
  const changed = Buffer.from(records.get(pathName).toString("utf8").replace("category-catalog/1", "category-catalog/2"));
  wrongSchemaRecords.set(pathName, changed);
  const wrongSchema = structuredClone(pin);
  wrongSchema.files.find((file) => file.path === pathName).sha256 = sha256(changed);
  assert.throws(() => verifyReferenceDataFiles(wrongSchema, wrongSchemaRecords), /unsupported reference schema/);

  const organizerPath = pin.selection.organizer.path;
  const wrongAuthorityRecords = new Map(records);
  const wrongAuthority = Buffer.from(records.get(organizerPath).toString("utf8").replace("organizer-official", "venue-official"));
  wrongAuthorityRecords.set(organizerPath, wrongAuthority);
  const wrongAuthorityPin = structuredClone(pin);
  wrongAuthorityPin.files.find((file) => file.path === organizerPath).sha256 = sha256(wrongAuthority);
  assert.throws(() => verifyReferenceDataFiles(wrongAuthorityPin, wrongAuthorityRecords), /kind is invalid/);

  const duplicateProvenanceRecords = new Map(records);
  const duplicateProvenance = Buffer.from(records.get(organizerPath).toString("utf8").replace(`"/name":["official-page"]`, `"/name":["official-page","official-page"]`));
  duplicateProvenanceRecords.set(organizerPath, duplicateProvenance);
  const duplicateProvenancePin = structuredClone(pin);
  duplicateProvenancePin.files.find((file) => file.path === organizerPath).sha256 = sha256(duplicateProvenance);
  assert.throws(() => verifyReferenceDataFiles(duplicateProvenancePin, duplicateProvenanceRecords), /duplicate source ids/);
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
