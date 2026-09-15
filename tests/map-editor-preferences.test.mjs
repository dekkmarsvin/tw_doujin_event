import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const preferences = await environment.runner.import("/app/map-editor-preferences.ts");
after(() => vite.close());

const { DEFAULT_MAP_EDITOR_PREFERENCES: defaults, MAP_EDITOR_PREFERENCES_KEY: key, NUDGE_STEPS, readMapEditorPreferences: read, saveMapEditorPreferences: save } = preferences;
const stored = (value) => ({ getItem: () => value });

test("a round trip through storage returns exactly what the toolbar set", () => {
  const written = {};
  const chosen = { showBackground: false, backgroundOpacity: 0, tracing: true, nudge: .1 };
  save({ setItem: (name, value) => { written[name] = value; } }, chosen);
  assert.deepEqual(read(stored(written[key])), chosen);
});

test("every offered nudge step survives a round trip, and nothing else is accepted", () => {
  for (const step of NUDGE_STEPS) assert.equal(read(stored(JSON.stringify({ nudge: step }))).nudge, step);
  for (const rejected of [0, 2, -1, "1", null, Infinity, NaN]) {
    assert.equal(read(stored(JSON.stringify({ nudge: rejected }))).nudge, defaults.nudge);
  }
});

test("opacity is clamped to the slider's range and non-numbers fall back", () => {
  for (const [saved, expected] of [[0, 0], [100, 100], [42.5, 42.5], [-20, 0], [180, 100]]) {
    assert.equal(read(stored(JSON.stringify({ backgroundOpacity: saved }))).backgroundOpacity, expected);
  }
  for (const rejected of ["30", null, true, Infinity, NaN]) {
    assert.equal(read(stored(JSON.stringify({ backgroundOpacity: rejected }))).backgroundOpacity, defaults.backgroundOpacity);
  }
});

test("an absent, unusable or malformed entry leaves the editor on its defaults", () => {
  for (const storage of [null, stored(null), stored("{"), stored("[]"), stored("null"), stored("7"), { getItem() { throw new Error("blocked"); } }]) {
    assert.deepEqual(read(storage), defaults);
  }
  // A partial entry keeps the fields it does carry.
  assert.deepEqual(read(stored(JSON.stringify({ tracing: true }))), { ...defaults, tracing: true });
});

test("a storage that refuses writes costs the next session's values and nothing else", () => {
  assert.doesNotThrow(() => save({ setItem() { throw new Error("quota"); } }, defaults));
  assert.doesNotThrow(() => save(null, defaults));
});
