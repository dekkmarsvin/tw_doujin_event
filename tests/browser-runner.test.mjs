import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Exercise the real CLI with subordinate data commands in an isolated tree.
// Pin/hash validation belongs to event-data-fetcher.test.mjs; this protects
// the runner from bypassing that boundary when a previous checkout left data.
for (const fetchFails of [false, true]) {
  test(`browser runner ${fetchFails ? "stops on a failed refresh" : "refreshes existing data before staging"}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "browser-runner-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, ".event-data", "ff47"), { recursive: true });
    await writeFile(path.join(root, ".event-data", "ff47", "event.json"), "old pin");
    // The runner reads the journeys off disk to decide what to stage, so one
    // pinned journey has to exist for the pinned staging to be reached at all.
    await mkdir(path.join(root, "tests", "browser"), { recursive: true });
    await writeFile(path.join(root, "tests", "browser", "pinned-journey.mjs"), "// staged-data: pinned\n");
    await copyFile(new URL("../scripts/run-browser-tests.mjs", import.meta.url), path.join(root, "scripts", "run-browser-tests.mjs"));
    await writeFile(path.join(root, "scripts", "fetch-event-data.mjs"), `
      import { writeFileSync } from "node:fs";
      if (process.argv[2] !== "ff47") process.exit(99);
      writeFileSync("fetch-ran", "yes");
      if (${fetchFails}) process.exit(23);
      writeFileSync(".event-data/ff47/event.json", "current pin");
    `);
    await writeFile(path.join(root, "scripts", "stage-event-data.mjs"), `
      import { readFileSync, writeFileSync } from "node:fs";
      writeFileSync("staged-data", readFileSync(".event-data/ff47/event.json"));
      // Stop at the staging boundary: no browser or Vite dependency needed.
      process.exit(17);
    `);
    const env = { ...process.env, PLAYWRIGHT_MODULE: "unused-before-staging" };
    delete env.MAP_TEST_URL;
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "run-browser-tests.mjs")], {
      cwd: root, env, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, fetchFails ? 23 : 17, result.stderr);
    assert.equal(await readFile(path.join(root, "fetch-ran"), "utf8"), "yes");
    if (fetchFails) {
      await assert.rejects(readFile(path.join(root, "staged-data")), { code: "ENOENT" });
      assert.equal(await readFile(path.join(root, ".event-data", "ff47", "event.json"), "utf8"), "old pin");
    } else {
      assert.equal(await readFile(path.join(root, "staged-data"), "utf8"), "current pin");
    }
  });
}

// Discovery decides what gets staged, so a journey that asks for data the
// runner cannot supply has to stop the run by name rather than silently fall
// back to the pinned event and assert against the wrong catalog.
test("browser runner refuses a journey that declares unknown staged data", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "tests", "browser"), { recursive: true });
  await copyFile(new URL("../scripts/run-browser-tests.mjs", import.meta.url), path.join(root, "scripts", "run-browser-tests.mjs"));
  // Would exit 17 if it were ever reached; reaching it at all is the failure.
  await writeFile(path.join(root, "scripts", "fetch-event-data.mjs"), "process.exit(17);");
  await writeFile(path.join(root, "scripts", "stage-event-data.mjs"), "process.exit(17);");
  await writeFile(path.join(root, "tests", "browser", "typo.mjs"), "// staged-data: fixtures\n");

  const env = { ...process.env, PLAYWRIGHT_MODULE: "unused-before-staging" };
  delete env.MAP_TEST_URL;
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "run-browser-tests.mjs")], { cwd: root, env, encoding: "utf8", timeout: 10000 });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /typo\.mjs/, "the refusal names the journey that has to be fixed");
  assert.match(result.stderr, /fixtures/, "and the declaration it could not honour");
});

test("journey finish preserves pageerror diagnostics through the standard outer abort", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "journey-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(new URL("./browser/support/journey.mjs", import.meta.url), path.join(root, "journey.mjs"));
  // Browser lifecycle only is stubbed; exercise the actual helper and report
  // writes, including the closed-browser state reached by the second abort.
  await writeFile(path.join(root, "playwright.mjs"), `
    let closed = false;
    const handlers = {};
    const page = {
      on: (name, callback) => { handlers[name] = callback; },
      setDefaultTimeout() {},
      async goto() { handlers.pageerror(new Error("script failed")); },
      isClosed: () => closed,
      url: () => "https://fixture.test/?token=secret-sentinel",
      async screenshot() {},
      locator: () => ({ innerText: async () => "still visible at failure" }),
    };
    export const chromium = { launch: async () => ({
      version: () => "stub", newPage: async () => page,
      contexts: () => closed ? [] : [{ pages: () => [page] }],
      async close() { closed = true; },
    }) };
  `);
  await writeFile(path.join(root, "check.mjs"), `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { start, output } from "./journey.mjs";
    const journey = await start("pageerror");
    await journey.page();
    let original;
    await assert.rejects(async () => {
      try { await journey.finish(); }
      catch (error) { original = error; await journey.abort(error); }
    }, error => error === original && /script failed/.test(error.message));
    const raw = await readFile(output + "/browser-report-pageerror.json", "utf8");
    const report = JSON.parse(raw);
    assert.equal(report.diagnostics.length, 1);
    assert.equal(report.diagnostics[0].visibleText, "still visible at failure");
    assert.equal(report.diagnostics[0].screenshot, "failure-pageerror-1.png");
    assert.deepEqual(report.errors, ["script failed"]);
    assert.match(report.failure, /script failed/);
    assert.equal(raw.includes("secret-sentinel"), false);
  `);
  const result = spawnSync(process.execPath, [path.join(root, "check.mjs")], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, PLAYWRIGHT_MODULE: pathToFileURL(path.join(root, "playwright.mjs")).href, MAP_TEST_OUTPUT: path.join(root, "output") },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
