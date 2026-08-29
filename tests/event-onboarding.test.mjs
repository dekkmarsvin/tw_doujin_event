import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  onboardEvent,
  onboardingTransactionFile,
  onboardingWorkspaceDestinations,
  onboardingWorkspaceReplacements,
  prepareEventOnboarding,
  serializeEventDataPin,
} from "../scripts/event-onboarding.mjs";
import { EVENT_DATA_REPOSITORY, EVENT_FILE_NAMES, parseEventDataPin, sha256 } from "../scripts/event-data-pin-utils.mjs";

const eventId = "event-alpha";
const commit = "a".repeat(40);
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

function rawUrl(filePath, revision = commit) {
  return `https://raw.githubusercontent.com/${EVENT_DATA_REPOSITORY}/${revision}/${filePath}`;
}

function fixture() {
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
  const referenceFiles = new Map([
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
  const eventFiles = new Map([
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
  ]);
  const responses = new Map(
    [...eventFiles, ...referenceFiles].map(([filePath, bytes]) => [rawUrl(filePath), bytes]),
  );
  return { eventFiles, referenceFiles, referenceSelection, responses };
}

function fetchFrom(responses) {
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    return responses.has(url)
      ? new Response(responses.get(url))
      : new Response("not found", { status: 404 });
  };
}

// The reference tree is no longer a separate workspace target: one fetch
// installs it inside `.event-data/<eventId>/`.
async function writeWorkspaceState(root, value) {
  const files = [
    path.join(root, ".event-data", eventId, "sentinel.txt"),
    path.join(root, "public", "data", "events", "sentinel.txt"),
    path.join(root, ".event-data-stage.json"),
    path.join(root, "data", "circle-identities", "allocations.json"),
    path.join(root, "data", "circle-identities", "evidence.json"),
  ];
  for (const filePath of files) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value);
  }
}

async function readWorkspaceState(root) {
  return Promise.all([
    readFile(path.join(root, ".event-data", eventId, "sentinel.txt"), "utf8"),
    readFile(path.join(root, "public", "data", "events", "sentinel.txt"), "utf8"),
    readFile(path.join(root, ".event-data-stage.json"), "utf8"),
    readFile(path.join(root, "data", "circle-identities", "allocations.json"), "utf8"),
    readFile(path.join(root, "data", "circle-identities", "evidence.json"), "utf8"),
  ]);
}

test("onboarding hashes both trees from one commit and commits the pin only after validation", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-success-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = fixture();
  let validated = false;
  const result = await onboardEvent({
    eventId,
    commit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
    validate: async (pinPath, workspace) => {
      const parsed = parseEventDataPin(JSON.parse(await readFile(pinPath, "utf8")));
      assert.equal(parsed.commit, commit);
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
    [
      ...EVENT_FILE_NAMES.map((name) => {
        const filePath = `events/${eventId}/${name}`;
        return [filePath, data.eventFiles.get(filePath)];
      }),
      ...[...data.referenceFiles].sort(([left], [right]) => left.localeCompare(right)),
    ]
      .map(([filePath, bytes]) => [filePath, sha256(bytes)]),
  );
  assert.deepEqual(await readWorkspaceState(temporary), Array(5).fill("candidate"));
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
    commit,
    root: temporary,
    fetchImpl: fetchFrom(fixture().responses),
    validate: async (_pinPath, workspace) => {
      await writeWorkspaceState(workspace, "rejected candidate");
      assert.deepEqual(await readWorkspaceState(temporary), Array(5).fill("previous"));
      throw new Error("simulated staged validation failure");
    },
  }), /simulated staged validation failure/);
  assert.equal(await readFile(destination, "utf8"), "previous pin\n");
  assert.deepEqual(await readWorkspaceState(temporary), Array(5).fill("previous"));
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
    commit,
    root: temporary,
    fetchImpl: fetchFrom(fixture().responses),
    validate: async (_pinPath, workspace) => {
      await writeWorkspaceState(workspace, "candidate");
      return { replacements: onboardingWorkspaceReplacements(temporary, workspace, eventId) };
    },
    fileSystemOverrides: { rename: renameWithFailure },
  }), /simulated pin rename failure/);
  assert.equal(await readFile(destination, "utf8"), "previous pin\n");
  assert.deepEqual(await readWorkspaceState(temporary), Array(5).fill("previous"));
  assert.deepEqual(await readdir(path.dirname(destination)), [`${eventId}.json`]);
});

test("onboarding another event recovers the repository-wide transaction interrupted before pin install", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-interrupted-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "data", "event-data-pins", `${eventId}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "previous pin\n");
  await writeWorkspaceState(temporary, "previous");

  const destinations = [...onboardingWorkspaceDestinations(temporary, eventId), destination];
  const transactionFile = onboardingTransactionFile(temporary);
  await writeFile(transactionFile, `${JSON.stringify({
    schema: "verified-tree-transaction/1",
    destinations: destinations.map((transactionDestination) => ({
      destination: transactionDestination,
      hadPrevious: true,
    })),
  })}\n`);
  for (const transactionDestination of destinations) {
    await rename(transactionDestination, `${transactionDestination}.previous`);
  }
  await writeWorkspaceState(temporary, "candidate");
  const staleLock = path.join(temporary, "data", "event-data-pins", ".onboard.lock");
  await mkdir(staleLock);
  await writeFile(path.join(staleLock, "owner.json"), `${JSON.stringify({
    schema: "event-onboarding-lock/1",
    hostname: os.hostname(),
    pid: 2147483647,
    token: "stale-owner",
  })}\n`);

  await assert.rejects(onboardEvent({
    eventId: "event-beta",
    commit,
    root: temporary,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /HTTP 404/);

  assert.equal(await readFile(destination, "utf8"), "previous pin\n");
  assert.deepEqual(await readWorkspaceState(temporary), Array(5).fill("previous"));
  await assert.rejects(readFile(transactionFile), /ENOENT/);
  await assert.rejects(lstat(staleLock), /ENOENT/);
  for (const transactionDestination of destinations) {
    await assert.rejects(lstat(`${transactionDestination}.previous`), /ENOENT/);
  }
});

test("an active repository-wide lock refuses overlapping onboarding and is released after failure", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-lock-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let releaseFetch;
  let reportFetchStarted;
  const fetchStarted = new Promise((resolve) => { reportFetchStarted = resolve; });
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
  const first = onboardEvent({
    eventId,
    commit,
    root: temporary,
    fetchImpl: async () => {
      reportFetchStarted();
      await fetchGate;
      return new Response("not found", { status: 404 });
    },
  });
  await fetchStarted;

  let secondFetches = 0;
  const secondError = await onboardEvent({
    eventId: "event-beta",
    commit,
    root: temporary,
    fetchImpl: async () => {
      secondFetches += 1;
      return new Response("not found", { status: 404 });
    },
  }).then(() => null, (error) => error);
  releaseFetch();
  await assert.rejects(first, /HTTP 404/);

  assert.match(secondError?.message ?? "", /already active/);
  assert.equal(secondFetches, 0);
  await assert.rejects(onboardEvent({
    eventId: "event-beta",
    commit,
    root: temporary,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /HTTP 404/);
});

test("every standalone root transaction writer acquires the shared onboarding lock", async () => {
  const writers = [
    "fetch-event-data.mjs",
    "stage-event-data.mjs",
    "generate-circle-identities.mjs",
    "build-official-circle-catalog.mjs",
  ];
  for (const script of writers) {
    const sourceText = await readFile(path.join("scripts", script), "utf8");
    assert.match(sourceText, /workspace === root \? await acquireEventOnboardingLock\(root\) : null/u, script);
  }
  const staging = await readFile(path.join("scripts", "stage-event-data.mjs"), "utf8");
  assert.doesNotMatch(staging, /!fixture\s*&&\s*workspace === root/u);
});

test("branch names and tags are rejected before fetching or writing", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-revision-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let fetches = 0;
  for (const revision of ["main", "v1.0.0", commit.slice(0, 12)]) {
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

test("a missing commit leaves no pin", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-missing-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await assert.rejects(onboardEvent({
    eventId,
    commit: "c".repeat(40),
    root: temporary,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /HTTP 404/);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("a reference file the selection does not describe leaves no pin", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-tampered-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = fixture();
  const [tamperedPath] = data.referenceFiles.keys();
  data.responses.set(rawUrl(tamperedPath), Buffer.from("tampered"));
  await assert.rejects(onboardEvent({
    eventId,
    commit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
  }), /not valid JSON/);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("an unsupported reference selection schema leaves no pin", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "event-onboard-schema-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = fixture();
  data.responses.set(
    rawUrl(`events/${eventId}/reference-selection.json`),
    jsonBytes({ ...data.referenceSelection, schema: "reference-data-pin/2" }),
  );
  await assert.rejects(onboardEvent({
    eventId,
    commit,
    root: temporary,
    fetchImpl: fetchFrom(data.responses),
  }), /Unsupported reference selection schema/);
  await assert.rejects(readFile(path.join(temporary, "data", "event-data-pins", `${eventId}.json`)), /ENOENT/);
});

test("the generated FF47 pin serialization is byte-for-byte identical to the reviewed pin", async () => {
  const expected = await readFile("data/event-data-pins/ff47.json", "utf8");
  assert.equal(serializeEventDataPin(JSON.parse(expected)), expected);
});

test("preparing an onboarding pin does not write to disk", async () => {
  const data = fixture();
  const prepared = await prepareEventOnboarding({ eventId, commit, fetchImpl: fetchFrom(data.responses) });
  assert.equal(prepared.pin.repository, EVENT_DATA_REPOSITORY);
});
