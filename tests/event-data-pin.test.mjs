import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEventDataPin, rawFileUrl } from "../scripts/event-data-pin-utils.mjs";

const pin = parseEventDataPin(JSON.parse(await readFile("data/event-data-pins/ff47.json", "utf8")));

test("event data is pinned to a full commit with per-file hashes", () => {
  assert.equal(pin.eventId, "ff47");
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(pin.files.map((file) => file.path), ["event.json", "official-booths.json"]);
  for (const file of pin.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(rawFileUrl(pin, file).includes(`/main/`), false, "a floating branch must never appear in the fetch URL");
    assert.equal(rawFileUrl(pin, file).includes(pin.commit), true);
  }
});

test("pin parsing rejects traversal, short commits and unknown schemas", () => {
  assert.throws(() => parseEventDataPin({ ...pin, schema: "event-data-pin/2" }), /Unsupported/);
  assert.throws(() => parseEventDataPin({ ...pin, commit: "main" }), /full commit/);
  assert.throws(() => parseEventDataPin({ ...pin, files: [{ path: "../secret", sha256: "0".repeat(64) }] }), /Invalid/);
});
