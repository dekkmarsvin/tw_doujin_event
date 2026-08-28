import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EVENT_DATA_REPOSITORY,
  EVENT_FILE_NAMES,
  assertEventDataPinIdentity,
  eventDataFiles,
  parseEventDataPin,
  rawFileUrl,
  referenceDataFiles,
} from "../scripts/event-data-pin-utils.mjs";

const pin = parseEventDataPin(JSON.parse(await readFile("data/event-data-pins/ff47.json", "utf8")));

test("event data is pinned to a full commit in the shared repository with per-file hashes", () => {
  assert.equal(pin.eventId, "ff47");
  assert.equal(pin.repository, EVENT_DATA_REPOSITORY);
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(
    eventDataFiles(pin).map((file) => file.path),
    EVENT_FILE_NAMES.map((name) => `events/ff47/${name}`),
  );
  assert.equal(referenceDataFiles(pin).length > 0, true, "the pin resolves its references from the same commit");
  for (const file of pin.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(rawFileUrl(pin, file).includes("/main/"), false, "a floating branch must never appear in the fetch URL");
    assert.equal(rawFileUrl(pin, file).includes(pin.commit), true);
  }
});

test("one commit covers both trees, so no second locator remains", () => {
  assert.equal("reference-data-pin.json" in pin, false);
  const paths = pin.files.map((file) => file.path);
  assert.equal(paths.some((filePath) => filePath.endsWith("reference-data-pin.json")), false);
  assert.equal(paths.includes("events/ff47/reference-selection.json"), true);
});

test("pin parsing rejects traversal, short commits, foreign repositories and unknown schemas", () => {
  assert.throws(() => parseEventDataPin({ ...pin, schema: "event-data-pin/1" }), /Unsupported/);
  assert.throws(() => parseEventDataPin({ ...pin, commit: "main" }), /full commit/);
  assert.throws(() => parseEventDataPin({ ...pin, repository: "dekkmarsvin/tw_doujin_event-data-ff47" }), /repository must be/);
  assert.throws(() => parseEventDataPin({ ...pin, files: [{ path: "../secret", sha256: "0".repeat(64) }] }), /Invalid event data pin path/);
  assert.throws(() => parseEventDataPin({ ...pin, files: [{ path: "secrets/key.json", sha256: "0".repeat(64) }] }), /must start with/);
  assert.throws(
    () => parseEventDataPin({ ...pin, files: [...pin.files, { path: "references/../secret.json", sha256: "0".repeat(64) }] }),
    /Invalid event data pin path/,
  );
});

test("a pin whose folder names another event is not accepted for this one", () => {
  // The folder prefix carries the event id, so a foreign pin is rejected by
  // both the path rule and the identity assertion.
  const foreign = {
    ...pin,
    eventId: "other-event",
    files: pin.files.map((file) => ({ ...file, path: file.path.replace("events/ff47/", "events/other-event/") })),
  };
  assert.throws(() => assertEventDataPinIdentity(parseEventDataPin(foreign), "ff47"), /identity mismatch/);
  assert.throws(() => parseEventDataPin({ ...pin, eventId: "other-event" }), /must start with events\/other-event\//);
});

test("a pin must carry every event file and at least one reference", () => {
  for (const name of EVENT_FILE_NAMES) {
    const missing = { ...pin, files: pin.files.filter((file) => file.path !== `events/ff47/${name}`) };
    assert.throws(() => parseEventDataPin(missing), new RegExp(`missing events/ff47/${name}`));
  }
  const withoutReferences = { ...pin, files: eventDataFiles(pin) };
  assert.throws(() => parseEventDataPin(withoutReferences), /must list the references/);
  const foreignEvent = { ...pin, files: [...pin.files, { path: "events/ff48/event.json", sha256: "0".repeat(64) }] };
  assert.throws(() => parseEventDataPin(foreignEvent), /must start with events\/ff47\//);
});
