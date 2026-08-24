import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/collect-cloudflare-usage.mjs", import.meta.url));

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("missing usage history fails unless a reset is explicit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cloudflare-usage-"));
  try {
    const state = path.join(directory, "history.json");
    const rejected = await run(["--report-only", "--state", state, "--date", "2026-08-20"]);
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /usage history is missing/);

    const allowed = await run(["--report-only", "--state", state, "--date", "2026-08-20", "--allow-empty-history"]);
    // An empty report still fails closed because every configured resource is
    // missing. The explicit flag only changes history initialization; it must
    // not make a no-data report look healthy.
    assert.notEqual(allowed.code, 0);
    assert.doesNotMatch(allowed.stderr, /usage history is missing/);
    assert.match(allowed.stdout, /Saved days: 0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
