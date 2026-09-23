import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runTests } from "../scripts/run-tests.mjs";

const quiet = { error() {} };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "node-test-runner-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "tests"));
  for (const [name, source] of Object.entries({
    "logic.test.mjs": 'import test from "node:test";',
    "database.test.mjs": 'import { Miniflare } from "miniflare";',
    "command.test.mjs": 'import { spawnSync } from "node:child_process";',
    "built.test.mjs": 'const artifact = new URL("../dist/index.html", import.meta.url);',
  })) await writeFile(path.join(root, "tests", name), source);
  return root;
}

test("Windows all tiers discovers every file once and isolates serial D1", async (t) => {
  const root = await fixture(t);
  // A new file must be included without registering it with the runner.
  await writeFile(path.join(root, "tests", "new.test.mjs"), "");
  const calls = [];
  const status = await runTests({ root, platform: "win32", args: ["--all", "--spec"], log: quiet,
    run: (_exe, args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].some((arg) => arg.startsWith("--test-concurrency=")));
  assert.ok(calls[1].includes("--test-concurrency=1"));
  assert.deepEqual(calls[1].filter((arg) => arg.endsWith(".test.mjs")), ["tests/database.test.mjs"]);
  assert.deepEqual(calls.flat().filter((arg) => arg.endsWith(".test.mjs")).sort(),
    ["built", "command", "database", "logic", "new"].map((name) => `tests/${name}.test.mjs`));
  assert.ok(calls.every((args) => args.includes("--test-reporter=spec")));
});

test("Linux CI retains a single all-files run with Node's default concurrency", async (t) => {
  const root = await fixture(t);
  const calls = [];
  await runTests({ root, platform: "linux", args: ["--all"], log: quiet,
    run: (_exe, args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter((arg) => arg.endsWith(".test.mjs")).length, 4);
  assert.ok(!calls[0].some((arg) => arg.startsWith("--test-concurrency=")));
});

test("an explicit concurrency overrides the platform default without duplicating tiers", async (t) => {
  const root = await fixture(t);
  for (const platform of ["win32", "linux"]) {
    const calls = [];
    await runTests({ root, platform, args: ["d1", "module", "d1", "--concurrency", "2"], log: quiet,
      run: (_exe, args) => { calls.push(args); return { status: 0 }; } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("--test-concurrency=2"));
    assert.deepEqual(calls[0].filter((arg) => arg.endsWith(".test.mjs")), ["tests/database.test.mjs", "tests/logic.test.mjs"]);
  }
});

test("module-only Windows runs keep normal concurrency and omit artifact tests", async (t) => {
  const root = await fixture(t);
  const calls = [];
  await runTests({ root, platform: "win32", args: ["module"], log: quiet,
    run: (_exe, args) => { calls.push(args); return { status: 0 }; } });
  assert.deepEqual(calls, [["--test", "--test-reporter=dot", "tests/logic.test.mjs"]]);
});

test("invalid limits and misspelled selections fail before starting any tests", async () => {
  for (const args of [[], ["d11"], ["--all", "d11"], ["d1", "--concurency=1"],
    ...["0", "-1", "1.5", "NaN", "1e2", "9007199254740992"].map((value) => ["d1", `--concurrency=${value}`])]) {
    assert.equal(await runTests({ args, root: "must-not-be-read", log: quiet,
      run: () => assert.fail("invalid arguments must not start tests") }), 2, args.join(" "));
  }
});

test("failed groups preserve failure while the remaining selected tests run once", async (t) => {
  const root = await fixture(t);
  for (const statuses of [[7, 0], [0, 8], [7, 8]]) {
    let runs = 0;
    const status = await runTests({ root, platform: "win32", args: ["--all"], log: quiet,
      run: () => ({ status: statuses[runs++] }) });
    assert.equal(runs, 2);
    assert.equal(status, statuses.find((value) => value !== 0));
  }
});

test("interruptions and spawn errors stop without launching another group", async (t) => {
  const root = await fixture(t);
  for (const result of [{ status: null, signal: "SIGINT" }, { status: null, error: new Error("spawn failed") }]) {
    let runs = 0;
    assert.equal(await runTests({ root, platform: "win32", args: ["--all"], log: quiet,
      run: () => { runs++; return result; } }), 1);
    assert.equal(runs, 1);
  }
});

test("the real CLI forwards concurrency to Node and returns test failures", async (t) => {
  const root = await fixture(t);
  const source = 'import test from "node:test"; test("fixture", () => { throw new Error("expected failure"); });';
  await writeFile(path.join(root, "tests", "logic.test.mjs"), source);
  // Execute the exported entry against the temporary tree so no repository
  // suite or external runtime is recursively started by this regression test.
  const runner = fileURLToPath(new URL("../scripts/run-tests.mjs", import.meta.url));
  await mkdir(path.join(root, "scripts"));
  await copyFile(runner, path.join(root, "scripts", "run-tests.mjs"));
  const result = spawnSync(process.execPath, ["scripts/run-tests.mjs", "module", "--concurrency=1", "--spec"], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /expected failure/);
  assert.match(result.stderr, /concurrency: 1/);
});
