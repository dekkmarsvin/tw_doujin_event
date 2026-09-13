import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
