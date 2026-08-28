import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "../scripts/reference-selection-utils.mjs";

const source = {
  id: "official-page",
  kind: "organizer-official",
  url: "https://organizer.example.invalid/reference",
  retrievedAt: "2026-01-01T00:00:00Z",
};
const venueSource = { ...source, kind: "venue-official", url: "https://venue.example.invalid/reference" };
const records = new Map([
  ["references/organizers/example-organizer.json", Buffer.from(JSON.stringify({
    schema: "organizer/1", id: "example-organizer", name: "虛構主辦", officialUrl: source.url,
    sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  }))],
  ["references/category-catalogs/example-organizer/main/2026-01-01.json", Buffer.from(JSON.stringify({
    schema: "category-catalog/1", id: "main", organizerId: "example-organizer", revision: "2026-01-01",
    categories: [{ id: "illustration", label: "插畫" }], sources: [source], provenance: { "/categories/0/label": [source.id] },
  }))],
  ["references/venues/example-venue.json", Buffer.from(JSON.stringify({
    schema: "venue/1", id: "example-venue", name: "虛構場館", officialUrl: venueSource.url,
    sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  }))],
  ["references/venue-spaces/example-hall.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "example-hall", venueId: "example-venue", name: "虛構展館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  }))],
]);

const selection = {
  schema: "reference-selection/1",
  eventId: "event-alpha",
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

const event = {
  id: "event-alpha",
  organizerAssignments: [{ organizerId: "example-organizer", role: "lead" }],
  categoryCatalog: { organizerId: "example-organizer", id: "main", revision: "2026-01-01" },
  venueAssignments: [{ venueId: "example-venue", venueSpaceId: "example-hall", areaIds: ["all"] }],
};

function withRecord(filePath, replace) {
  const changed = Buffer.from(records.get(filePath).toString("utf8").replace(...replace));
  return new Map([...records, [filePath, changed]]);
}

const organizerPath = selection.organizers[0].path;

test("a selection names references without a repository or commit of its own", () => {
  const parsed = parseReferenceSelection(selection);
  assert.equal(parsed.eventId, "event-alpha");
  assert.equal(referenceSelectionPaths(parsed).length, 4);
  for (const filePath of referenceSelectionPaths(parsed)) {
    assert.equal(filePath.startsWith("references/"), true, "selection paths address the shared data repository");
  }
  const verified = verifyReferenceFiles(parsed, records, "event-alpha");
  assert.equal(verified.records.size, 4);
  assert.equal(selectEventReferenceRecords(parsed, verified.records, event).length, 4);
});

test("reference records are emitted in a stable sorted order", () => {
  const verified = verifyReferenceFiles(selection, records, "event-alpha");
  const reordered = structuredClone(selection);
  reordered.venues[0].spaces = [...reordered.venues[0].spaces];
  const first = selectEventReferenceRecords(selection, verified.records, event);
  const second = selectEventReferenceRecords(reordered, verified.records, event);
  assert.deepEqual(first.map((record) => record.id), ["main", "example-organizer", "example-hall", "example-venue"]);
  assert.deepEqual(second, first);
});

test("selection parsing rejects traversal, foreign prefixes and unknown schemas", () => {
  assert.throws(() => parseReferenceSelection({ ...selection, schema: "reference-data-pin/2" }), /Unsupported reference selection schema/);
  const traversal = structuredClone(selection);
  traversal.organizers[0].path = "references/../secret.json";
  assert.throws(() => parseReferenceSelection(traversal), /path is invalid/);
  const foreign = structuredClone(selection);
  foreign.organizers[0].path = "data/organizers/example-organizer.json";
  assert.throws(() => parseReferenceSelection(foreign), /path is invalid/);
  const located = { ...selection, repository: "dekkmarsvin/tw_doujin_event-reference-data" };
  assert.throws(() => parseReferenceSelection(located), /unknown property repository/);
});

test("identity mismatch between the selection and the event fails closed", () => {
  assert.throws(() => verifyReferenceFiles(selection, records, "event-beta"), /identity mismatch/);
});

test("verification fails closed for schema, stable-id, source and provenance mismatches", () => {
  const unknown = structuredClone(selection);
  unknown.organizers[0].id = "unknown-organizer";
  assert.throws(() => verifyReferenceFiles(unknown, records), /Category catalog organizer must be selected/);

  const catalogPath = selection.categoryCatalog.path;
  assert.throws(
    () => verifyReferenceFiles(selection, withRecord(catalogPath, ["category-catalog/1", "category-catalog/2"])),
    /unsupported reference schema/,
  );
  assert.throws(
    () => verifyReferenceFiles(selection, withRecord(organizerPath, ["organizer-official", "venue-official"])),
    /kind is invalid/,
  );
  assert.throws(
    () => verifyReferenceFiles(selection, withRecord(organizerPath, [/https:\/\/organizer\.example\.invalid/g, "https:organizer.example.invalid"])),
    /must use HTTPS/,
  );
  assert.throws(
    () => verifyReferenceFiles(selection, withRecord(organizerPath, [/2026-01-01T00:00:00Z/g, "2026-02-30T00:00:00Z"])),
    /must be an ISO timestamp/,
  );
  assert.throws(
    () => verifyReferenceFiles(selection, withRecord(organizerPath, [`"/name":["official-page"]`, `"/name":["official-page","official-page"]`])),
    /duplicate source ids/,
  );

  const organizerBytes = records.get(organizerPath);
  const organizerName = Buffer.from("虛構主辦");
  const offset = organizerBytes.indexOf(organizerName);
  const malformedUtf8 = new Map([...records, [organizerPath, Buffer.concat([
    organizerBytes.subarray(0, offset),
    Buffer.from([0xc3, 0x28]),
    organizerBytes.subarray(offset + organizerName.length),
  ])]]);
  assert.throws(() => verifyReferenceFiles(selection, malformedUtf8), /not valid JSON/);
});

test("the pinned reference files and the selection must be the same set", () => {
  const missing = new Map(records);
  missing.delete(organizerPath);
  assert.throws(() => verifyReferenceFiles(selection, missing), /Selected reference file is missing/);

  const extra = new Map([...records, ["references/organizers/unselected.json", Buffer.from("{}")]]);
  assert.throws(() => verifyReferenceFiles(selection, extra), /is not selected/);

  const twice = structuredClone(selection);
  twice.organizers.push({ id: "second-organizer", path: organizerPath });
  assert.throws(() => parseReferenceSelection(twice), /selected more than once/);
});

test("event assignments must exactly match every selected reference", () => {
  const verified = verifyReferenceFiles(selection, records, "event-alpha");
  assert.throws(() => selectEventReferenceRecords(selection, verified.records, {
    ...event,
    organizerAssignments: [{ organizerId: "unselected", role: "lead" }],
  }), /organizer assignments do not match/);
});

test("a selection supports plural organizers, venues and spaces as exact sets", () => {
  const pluralRecords = new Map(records);
  pluralRecords.set("references/organizers/partner-organizer.json", Buffer.from(JSON.stringify({
    schema: "organizer/1", id: "partner-organizer", name: "協力主辦", officialUrl: source.url,
    sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })));
  pluralRecords.set("references/venue-spaces/example-annex.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "example-annex", venueId: "example-venue", name: "虛構副館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  })));
  pluralRecords.set("references/venues/second-venue.json", Buffer.from(JSON.stringify({
    schema: "venue/1", id: "second-venue", name: "第二場館", officialUrl: venueSource.url,
    sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
  })));
  pluralRecords.set("references/venue-spaces/second-hall.json", Buffer.from(JSON.stringify({
    schema: "venue-space/1", id: "second-hall", venueId: "second-venue", name: "第二展館",
    sources: [venueSource], provenance: { "/name": [source.id] },
  })));
  const plural = structuredClone(selection);
  plural.organizers.push({ id: "partner-organizer", path: "references/organizers/partner-organizer.json" });
  plural.venues[0].spaces.push({ id: "example-annex", path: "references/venue-spaces/example-annex.json" });
  plural.venues.push({
    id: "second-venue",
    path: "references/venues/second-venue.json",
    spaces: [{ id: "second-hall", path: "references/venue-spaces/second-hall.json" }],
  });
  const pluralEvent = structuredClone(event);
  pluralEvent.organizerAssignments.push({ organizerId: "partner-organizer", role: "partner" });
  pluralEvent.venueAssignments.push(
    { venueId: "example-venue", venueSpaceId: "example-annex", areaIds: ["annex"] },
    { venueId: "second-venue", venueSpaceId: "second-hall", areaIds: ["second"] },
  );

  const verified = verifyReferenceFiles(plural, pluralRecords, "event-alpha");
  assert.equal(selectEventReferenceRecords(plural, verified.records, pluralEvent).length, 8);

  const wrongCatalogRevision = structuredClone(pluralEvent);
  wrongCatalogRevision.categoryCatalog.revision = "2026-01-02";
  assert.throws(() => selectEventReferenceRecords(plural, verified.records, wrongCatalogRevision), /category catalog does not match/);

  const missingSpace = structuredClone(pluralEvent);
  missingSpace.venueAssignments = missingSpace.venueAssignments.filter(({ venueSpaceId }) => venueSpaceId !== "example-annex");
  assert.throws(() => selectEventReferenceRecords(plural, verified.records, missingSpace), /venue assignments do not match/);

  const extraSpace = structuredClone(pluralEvent);
  extraSpace.venueAssignments.push({ venueId: "second-venue", venueSpaceId: "unselected-hall", areaIds: ["extra"] });
  assert.throws(() => selectEventReferenceRecords(plural, verified.records, extraSpace), /venue assignments do not match/);
});
