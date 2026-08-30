import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLISHED_EVENTS_SCHEMA,
  parsePublishedEvents,
  readPublishedEvents,
} from "../scripts/published-events.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaces = [];
after(async () => { await Promise.all(workspaces.map((directory) => rm(directory, { recursive: true, force: true }))); });

async function stage(...args) {
  const workspace = await mkdtemp(path.join(tmpdir(), "staged-events-"));
  workspaces.push(workspace);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "stage-event-data.mjs"), ...args, "--workspace", workspace,
    ], { cwd: root, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`staging exited with ${code}`))));
  });
  return workspace;
}

test("the published list is the only place production names an event", async () => {
  const published = await readPublishedEvents(root);
  assert.ok(published.length >= 1, "production must serve at least one event");

  for (const eventId of published) {
    // Every published event must be reachable: a listed event with no pin would
    // fail the build rather than quietly serving nothing.
    const pin = JSON.parse(await readFile(path.join(root, "data", "event-data-pins", `${eventId}.json`), "utf8"));
    assert.equal(pin.eventId, eventId);
  }

  // The build command must not name an event; adding one is a data change.
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const [name, script] of Object.entries(packageJson.scripts)) {
    for (const eventId of published) {
      assert.doesNotMatch(script, new RegExp(`\\b${eventId}\\b`), `npm script ${name} must not name ${eventId}`);
    }
  }
});

test("published event lists reject anything that would not resolve", () => {
  const valid = { schema: PUBLISHED_EVENTS_SCHEMA, events: ["ff47", "next-event"] };
  assert.deepEqual(parsePublishedEvents(valid), ["ff47", "next-event"]);

  assert.throws(() => parsePublishedEvents({ ...valid, schema: "published-events/2" }), /schema/);
  assert.throws(() => parsePublishedEvents({ ...valid, events: [] }), /at least one/);
  assert.throws(() => parsePublishedEvents({ ...valid, events: ["ff47", "ff47"] }), /repeat/);
  assert.throws(() => parsePublishedEvents({ ...valid, events: ["../escape"] }), /lower-case/);
  assert.throws(() => parsePublishedEvents({ ...valid, events: ["FF47"] }), /lower-case/);
  assert.throws(() => parsePublishedEvents({ ...valid, extra: 1 }), /exactly/);
  assert.throws(() => parsePublishedEvents([]), /object/);
});

test("staging carries a set of events, and the manifest names all of them", async () => {
  const workspace = await stage("--fixture", "sample", "sample-two");

  const manifest = JSON.parse(await readFile(path.join(workspace, ".event-data-stage.json"), "utf8"));
  assert.deepEqual(manifest.events, [
    { eventId: "sample", source: "fixture" },
    { eventId: "sample-two", source: "fixture" },
  ]);
  assert.equal(manifest.eventId, "sample", "the first staged event stays the default for consumers that need one");

  const staged = await readdir(path.join(workspace, "public", "data", "events"));
  assert.deepEqual(staged.sort(), ["sample", "sample-two"]);
  for (const eventId of ["sample", "sample-two"]) {
    const files = await readdir(path.join(workspace, "public", "data", "events", eventId));
    assert.deepEqual(files.sort(), ["circles.json", "event.json", "map.json", "reference-records.json"]);
  }
});

test("staging replaces the served set rather than accumulating it", async () => {
  const workspace = await stage("--fixture", "sample", "sample-two");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "stage-event-data.mjs"), "--fixture", "sample", "--workspace", workspace,
    ], { cwd: root, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`staging exited with ${code}`))));
  });

  // A leftover event would be served without appearing in the manifest, which
  // is exactly the "published without deciding to publish it" failure.
  assert.deepEqual(await readdir(path.join(workspace, "public", "data", "events")), ["sample"]);
  const manifest = JSON.parse(await readFile(path.join(workspace, ".event-data-stage.json"), "utf8"));
  assert.deepEqual(manifest.events, [{ eventId: "sample", source: "fixture" }]);
});
