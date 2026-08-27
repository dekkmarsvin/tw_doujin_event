import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  onboardEvent,
  onboardingWorkspaceReplacements,
  prepareEventOnboarding,
  serializeEventDataPin,
} from "../scripts/event-onboarding.mjs";
import { parseEventDataPin, sha256 } from "../scripts/event-data-pin-utils.mjs";

const eventId = "event-alpha";
const eventCommit = "a".repeat(40);
const referenceCommit = "b".repeat(40);
const eventRepository = `dekkmarsvin/tw_doujin_event-data-${eventId}`;
const referenceRepository = "dekkmarsvin/tw_doujin_event-reference-data";
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

function fixture() {
  const referenceFiles = new Map([
    ["data/organizers/example-organizer.json", jsonBytes({
      schema: "organizer/1", id: "example-organizer", name: "虛構主辦", officialUrl: source.url,
      sources: [source], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
    })],
    ["data/category-catalogs/example-organizer/main/2026-01-01.json", jsonBytes({
      schema: "category-catalog/1", id: "main", organizerId: "example-organizer", revision: "2026-01-01",
      categories: [{ id: "illustration", label: "插畫" }], sources: [source], provenance: { "/categories/0/label": [source.id] },
    })],
    ["data/venues/example-venue.json", jsonBytes({
      schema: "venue/1", id: "example-venue", name: "虛構場館", officialUrl: venueSource.url,
      sources: [venueSource], provenance: { "/name": [source.id], "/officialUrl": [source.id] },
    })],
    ["data/venue-spaces/example-hall.json", jsonBytes({
      schema: "venue-space/1", id: "example-hall", venueId: "example-venue", name: "虛構展館",
      sources: [venueSource], provenance: { "/name": [source.id] },
    })],
  ]);
  const referencePin = {
    schema: "reference-data-pin/2",
    eventId,
    repository: referenceRepository,
    commit: referenceCommit,
    files: [...referenceFiles].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256(bytes) })),
    selection: {
      organizers: [{ id: "example-organizer", path: "data/organizers/example-organizer.json" }],
      categoryCatalog: {
        id: "main", organizerId: "example-organizer", revision: "2026-01-01",
        path: "data/category-catalogs/example-organizer/main/2026-01-01.json",
      },
      venues: [{
        id: "example-venue",
        path: "data/venues/example-venue.json",
        spaces: [{ id: "example-hall", path: "data/venue-spaces/example-hall.json" }],
      }],
    },
  };
  const eventFiles = new Map([
    ["event.json", jsonBytes({
      id: eventId,
      organizerAssignments: [{ organizerId: "example-organizer", role: "lead" }],
      categoryCatalog: { organizerId: "example-organizer", id: "main", revision: "2026-01-01" },
      venueAssignments: [{ venueId: "example-venue", venueSpaceId: "example-hall", areaIds: ["all"] }],
    })],
    ["official-booths.json", jsonBytes({ schema: "official-booths/1" })],
    ["map.json", jsonBytes({ schema: "event-map/1" })],
    ["reference-data-pin.json", jsonBytes(referencePin)],
  ]);
  const responses = new Map([
    ...[...eventFiles].map(([filePath, bytes]) => [
      `https://raw.githubusercontent.com/${eventRepository}/${eventCommit}/${filePath}`,
      bytes,
    ]),
    ...[...referenceFiles].map(([filePath, bytes]) => [
      `https://raw.githubusercontent.com/${referenceRepository}/${referenceCommit}/${filePath}`,
      bytes,
    ]),
  ]);
  return { eventFiles, referenceFiles, referencePin, responses };
}

function fetchFrom(responses) {
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    return responses.has(url)
      ? new Response(responses.get(url))
      : new Response("not found", { status: 404 });
  };
}

async function writeWorkspaceState(root, value) {
  const files = [
    path.join(root, ".event-data", eventId, "sentinel.txt"),
    path.join(root, ".reference-data", eventId, "sentinel.txt"),
    path.join(root, "public", "data", "events", "sentinel.txt"),
    path.join(root, ".event-data-stage.json"),
  ];
  for (const filePath of files) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value);
  }
}

async function readWorkspaceState(root) {
  return Promise.all([
    readFile(path.join(root, ".event-data", eventId, "sentinel.txt"), "utf8"),
    readFile(path.join(root, ".reference-data", eventId, "sentinel.txt"), "utf8"),
    readFile(path.join(root, "public", "data", "events", "sentinel.txt"), "utf8"),
    readFile(path.join(root, ".event-data-stage.json"), "utf8"),
  ]);
}

test("onboarding hashes event files, verifies reference data and commits the pin only after validation", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-success-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = fixture();
  let validated = false;
  const result = await onboardEvent({
    eventId,
    commit: eventCommit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
    validate: async (pinPath, workspace) => {
      const parsed = parseEventDataPin(JSON.parse(await readFile(pinPath, "utf8")));
      assert.equal(parsed.commit, eventCommit);
      await writeWorkspaceState(workspace, "candidate");
      validated = true;
      return { replacements: onboardingWorkspaceReplacements(temporary, workspace, eventId) };
    },
  });
  assert.equal(validated, true);
  assert.equal(result.destination, path.join(temporary, "data", "event-data-pins", `${eventId}.json`));
  const written = parseEventDataPin(JSON.parse(await readFile(result.destination, "utf8")));
  assert.deepEqual(
    written.files.map(({ path: filePath, sha256: hash }) => [filePath, hash]),
    [...data.eventFiles].map(([filePath, bytes]) => [filePath, sha256(bytes)]),
  );
  assert.deepEqual(await readWorkspaceState(temporary), Array(4).fill("candidate"));
});

test("a validation failure preserves the previous pin and every fetched or staged tree", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-validation-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "data", "event-data-pins", `${eventId}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "previous pin\n");
  await writeWorkspaceState(temporary, "previous");
  await assert.rejects(onboardEvent({
    eventId,
    commit: eventCommit,
    root: temporary,
    fetchImpl: fetchFrom(fixture().responses),
    validate: async (_pinPath, workspace) => {
      await writeWorkspaceState(workspace, "rejected candidate");
      assert.deepEqual(await readWorkspaceState(temporary), Array(4).fill("previous"));
      throw new Error("simulated staged validation failure");
    },
  }), /simulated staged validation failure/);
  assert.equal(await readFile(destination, "utf8"), "previous pin\n");
  assert.deepEqual(await readWorkspaceState(temporary), Array(4).fill("previous"));
  assert.deepEqual(await readdir(path.dirname(destination)), [`${eventId}.json`]);
});

test("a final rename failure restores the previous pin and every promoted tree", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-rename-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "data", "event-data-pins", `${eventId}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "previous pin\n");
  await writeWorkspaceState(temporary, "previous");
  const renameWithFailure = async (sourcePath, destinationPath) => {
    if (sourcePath.includes(`.tmp-onboard-${eventId}-`) && destinationPath === destination) {
      throw new Error("simulated pin rename failure");
    }
    return rename(sourcePath, destinationPath);
  };
  await assert.rejects(onboardEvent({
    eventId,
    commit: eventCommit,
    root: temporary,
    fetchImpl: fetchFrom(fixture().responses),
    validate: async (_pinPath, workspace) => {
      await writeWorkspaceState(workspace, "candidate");
      return { replacements: onboardingWorkspaceReplacements(temporary, workspace, eventId) };
    },
    fileSystemOverrides: { rename: renameWithFailure },
  }), /simulated pin rename failure/);
  assert.equal(await readFile(destination, "utf8"), "previous pin\n");
  assert.deepEqual(await readWorkspaceState(temporary), Array(4).fill("previous"));
  assert.deepEqual(await readdir(path.dirname(destination)), [`${eventId}.json`]);
});

test("branch names and tags are rejected before fetching or writing", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-revision-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let fetches = 0;
  for (const revision of ["main", "v1.0.0", eventCommit.slice(0, 12)]) {
    await assert.rejects(onboardEvent({
      eventId,
      commit: revision,
      root: temporary,
      fetchImpl: async () => { fetches += 1; },
    }), /full commit SHA/);
  }
  assert.equal(fetches, 0);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("a missing commit or tampered reference file leaves no pin", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-failure-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await assert.rejects(onboardEvent({
    eventId,
    commit: "c".repeat(40),
    root: temporary,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /HTTP 404/);

  const data = fixture();
  const [tamperedPath] = data.referenceFiles.keys();
  data.responses.set(
    `https://raw.githubusercontent.com/${referenceRepository}/${referenceCommit}/${tamperedPath}`,
    Buffer.from("tampered"),
  );
  await assert.rejects(onboardEvent({
    eventId,
    commit: eventCommit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
  }), /SHA-256 mismatch/);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("an unsupported reference pin schema leaves no pin", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-schema-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = fixture();
  const invalid = { ...data.referencePin, schema: "reference-data-pin/3" };
  data.responses.set(
    `https://raw.githubusercontent.com/${eventRepository}/${eventCommit}/reference-data-pin.json`,
    jsonBytes(invalid),
  );
  await assert.rejects(onboardEvent({
    eventId,
    commit: eventCommit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
  }), /Unsupported reference data pin schema/);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("the generated FF47 pin serialization is byte-for-byte identical to the reviewed pin", async () => {
  const expected = await readFile("data/event-data-pins/ff47.json", "utf8");
  assert.equal(serializeEventDataPin(JSON.parse(expected)), expected);
});

test("preparing an onboarding pin does not write to disk", async () => {
  const data = fixture();
  const prepared = await prepareEventOnboarding({ eventId, commit: eventCommit, fetchImpl: fetchFrom(data.responses) });
  assert.equal(prepared.pin.repository, eventRepository);
});
