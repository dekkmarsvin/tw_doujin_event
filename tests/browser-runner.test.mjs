import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Drive the actual runner against a disposable HTTP server and tiny journeys.
// This verifies selection, data setup, cleanup and exit status without using
// a second browser suite to test the browser suite's orchestration.
async function selectionFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-selection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "tests/browser", "node_modules/vite/bin"]) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await copyFile(new URL("../scripts/run-browser-tests.mjs", import.meta.url), path.join(root, "scripts/run-browser-tests.mjs"));
  await writeFile(path.join(root, "scripts/stage-event-data.mjs"), `
    import { appendFileSync } from "node:fs";
    appendFileSync("staged", JSON.stringify(process.argv.slice(2)) + "\\n");
  `);
  await writeFile(path.join(root, "scripts/fetch-event-data.mjs"), `throw new Error("unselected pinned data must not be fetched");`);
  await writeFile(path.join(root, "node_modules/vite/bin/vite.js"), `
    import http from "node:http";
    http.createServer((_request, response) => response.end("ready"))
      .listen(Number(process.argv[process.argv.indexOf("--port") + 1]));
  `);
  const journey = async (name, mode = "fixture", status = 0) => writeFile(path.join(root, "tests/browser", `${name}.mjs`), `
// staged-data: ${mode}
import { appendFileSync } from "node:fs";
appendFileSync("ran", "${name}\\n");
if (!await fetch(process.env.MAP_TEST_URL).then(response => response.ok)) process.exit(9);
process.exit(${status});
  `);
  const run = (args = [], overrides = {}) => {
    const env = { ...process.env, PLAYWRIGHT_MODULE: "unused-test-module" };
    delete env.MAP_TEST_URL; delete env.MAP_TEST_PORT;
    return spawnSync(process.execPath, [path.join(root, "scripts/run-browser-tests.mjs"), ...args], {
      cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 20000,
    });
  };
  return { root, journey, run };
}

test("named journeys run once, prepare only their data and preserve failures", async t => {
  const f = await selectionFixture(t);
  await f.journey("first", "fixture", 1);
  await f.journey("second");
  await f.journey("unselected-pinned", "pinned");
  await f.journey("unselected-portal", "portal");
  const result = f.run(["--journey", "first", "--journey=second.mjs", "--journey", "first.mjs"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(await readFile(path.join(f.root, "ran"), "utf8"), "first\nsecond\n");
  assert.equal(await readFile(path.join(f.root, "staged"), "utf8"), '["--fixture","sample","sample-two"]\n');
  assert.match(result.stderr, /1 browser journey\(s\) failed: first.mjs/);
});

test("no selection still runs every journey and reports success", async t => {
  const f = await selectionFixture(t);
  await f.journey("first"); await f.journey("second");
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(f.root, "ran"), "utf8"), "first\nsecond\n");
  assert.match(result.stderr, /All eligible browser journeys passed \(2 files\)/);
});

test("unknown names, options and incompatible external selections fail before staging", async t => {
  const f = await selectionFixture(t);
  await f.journey("fixture-only");
  for (const args of [["--journey", "missing"], ["--journey"], ["--journey", "../fixture-only"], ["--matrx", "full"], ["--matrix", "invalid"], ["fixture-only"]]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0, `${args}: ${result.stdout}`);
  }
  const external = { MAP_TEST_URL: "http://127.0.0.1:1" };
  assert.match(f.run(["--journey", "fixture-only"], external).stderr, /cannot use MAP_TEST_URL/);
  assert.match(f.run([], external).stderr, /refusing an empty successful run/);
  await assert.rejects(readFile(path.join(f.root, "staged")), { code: "ENOENT" });
});

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
  await copyFile(new URL("./browser/support/failure-diagnostics.mjs", import.meta.url), path.join(root, "failure-diagnostics.mjs"));
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

test("viewport failure keeps bounded request evidence and a screenshot before closing the browser", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "viewport-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "support"));
  await copyFile(new URL("./browser/map-viewport.mjs", import.meta.url), path.join(root, "viewport.mjs"));
  await copyFile(new URL("./browser/support/failure-diagnostics.mjs", import.meta.url), path.join(root, "support", "failure-diagnostics.mjs"));
  await writeFile(path.join(root, "playwright.mjs"), `
    import { writeFile } from "node:fs/promises";
    let closed = false;
    const handlers = {};
    const page = {
      on: (name, callback) => { handlers[name] = callback; },
      setDefaultTimeout() {}, async addInitScript() {},
      async goto() {
        for (let i = 0; i < 25; i++) handlers.response({
          request: () => ({ method: () => "GET" }),
          url: () => "https://fixture.test/data/" + i + "?token=secret-sentinel", status: () => 503,
        });
        handlers.requestfailed({ method: () => "GET", url: () => "https://fixture.test/map?token=secret-sentinel",
          failure: () => ({ errorText: "net::ERR_CONNECTION_RESET" }) });
      },
      isClosed: () => closed,
      url: () => "https://fixture.test/?token=secret-sentinel",
      async screenshot({ path }) {
        if (closed) throw new Error("closed too early");
        await writeFile(path, "captured before close");
      },
      locator: () => ({
        waitFor: async () => { throw new Error("map readiness timed out"); },
        innerText: async () => { throw new Error("text capture unavailable"); },
      }),
    };
    export const chromium = { launch: async () => ({
      version: () => "stub", newPage: async () => page,
      contexts: () => closed ? [] : [{ pages: () => [page] }],
      async close() { closed = true; await writeFile("browser-closed", "yes"); },
    }) };
  `);
  const output = path.join(root, "output");
  const result = spawnSync(process.execPath, [path.join(root, "viewport.mjs")], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, PLAYWRIGHT_MODULE: pathToFileURL(path.join(root, "playwright.mjs")).href,
      MAP_TEST_OUTPUT: output, MAP_TEST_MATRIX: "representative" },
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /map readiness timed out/);
  const raw = await readFile(path.join(output, "browser-report-representative.json"), "utf8");
  const report = JSON.parse(raw);
  assert.match(report.failure, /map readiness timed out/);
  assert.equal(report.diagnostics.length, 1);
  const diagnostic = report.diagnostics[0];
  assert.equal(diagnostic.path, "/");
  assert.equal(diagnostic.requests.length, 20);
  assert.deepEqual(diagnostic.requests[0], { method: "GET", path: "/data/6", status: 503 });
  assert.deepEqual(diagnostic.requests.at(-1), { method: "GET", path: "/map", failure: "net::ERR_CONNECTION_RESET" });
  assert.equal(raw.includes("secret-sentinel"), false);
  assert.equal(diagnostic.textError, "capture failed");
  assert.equal(await readFile(path.join(output, diagnostic.screenshot), "utf8"), "captured before close");
  assert.equal(await readFile(path.join(root, "browser-closed"), "utf8"), "yes");
});
