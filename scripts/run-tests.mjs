// Runs one tier of the suite, or all of them.
//
//   node scripts/run-tests.mjs module          one tier
//   node scripts/run-tests.mjs module d1 cli   several
//   node scripts/run-tests.mjs --all --spec    what `npm test` runs
//   node scripts/run-tests.mjs d1 --concurrency=1
//
// Defaults to the dot reporter: a full run is hundreds of cases, and the spec
// reporter's one line per passing case is noise everywhere except CI.
//
// The artifact tier reads dist/, so it is skipped unless asked for by name (or
// with --all, which the build precedes).
//
// Tier membership is read out of each test's own source rather than a
// hand-kept list, so `--all` covers every tests/*.test.mjs on disk by
// construction: a new test file cannot be left out of the run, least of all in
// CI, which is `--all`.
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TIER_NAMES = ["module", "d1", "cli", "artifact"];

// What each tier costs, and how a test file reveals that it pays it. Ordered
// most expensive first: a test that reads dist/ needs `npm run build` whatever
// else it also does.
const TIER_SIGNALS = [
  ["artifact", /new URL\(\s*[`"']\.\.\/dist/],
  ["d1", /(?:from|import)\s*\(?\s*["']miniflare["']/],
  ["cli", /(?:from|import)\s*\(?\s*["']node:child_process["']/],
];

async function deriveTiers(root) {
  const tiers = Object.fromEntries(TIER_NAMES.map((name) => [name, []]));
  const files = (await readdir(path.join(root, "tests"))).filter((file) => file.endsWith(".test.mjs")).sort();
  for (const file of files) {
    const source = await readFile(path.join(root, "tests", file), "utf8");
    tiers[TIER_SIGNALS.find(([, signal]) => signal.test(source))?.[0] ?? "module"].push(file);
  }
  return tiers;
}

export async function runTests({ args, root = ROOT, platform = process.platform, run = spawnSync, log = console }) {
  let options;
  let named;
  let concurrency;
  try {
    const parsed = parseArgs({ args, allowPositionals: true, options: {
      all: { type: "boolean" }, spec: { type: "boolean" }, concurrency: { type: "string" },
    } });
    options = parsed.values;
    for (const name of parsed.positionals) {
      if (!TIER_NAMES.includes(name)) throw new Error(`unknown test tier: ${name}`);
    }
    named = options.all ? TIER_NAMES : [...new Set(parsed.positionals)];
    if (named.length === 0) throw new Error("select at least one test tier");
    if (options.concurrency !== undefined) {
      concurrency = Number(options.concurrency);
      if (!/^[1-9]\d*$/.test(options.concurrency) || !Number.isSafeInteger(concurrency)) {
        throw new Error("--concurrency must be a positive integer");
      }
    }
  } catch (error) {
    log.error(error.message);
    log.error(`usage: run-tests.mjs [${TIER_NAMES.join("|")}] | --all [--spec] [--concurrency=N]`);
    return 2;
  }

  const tiers = await deriveTiers(root);
  // Windows shares a small ephemeral port pool across test processes. Run D1
  // separately and serially by default, without serialising the other tiers.
  // An explicit limit applies to the whole selection on every platform.
  const groups = platform === "win32" && concurrency === undefined && named.includes("d1")
    ? [{ names: named.filter((name) => name !== "d1") }, { names: ["d1"], concurrency: 1 }]
    : [{ names: named, concurrency }];
  const reporter = options.spec ? "spec" : "dot";
  let status = 0;
  for (const group of groups) {
    const files = group.names.flatMap((name) => tiers[name].map((file) => `tests/${file}`));
    if (files.length === 0) continue;
    const limit = group.concurrency === undefined ? [] : [`--test-concurrency=${group.concurrency}`];
    log.error(`running ${files.length} test file(s) — ${group.names.join(", ")} (concurrency: ${group.concurrency ?? "Node default"})`);
    const result = run(process.execPath, ["--test", `--test-reporter=${reporter}`, ...limit, ...files], { cwd: root, stdio: "inherit" });
    if (result.error) log.error(result.error.message);
    const code = result.status ?? 1;
    if (status === 0 && code !== 0) status = code;
    // Do not start another group after interruption or a failed spawn. Ordinary
    // test failures still allow the remaining selected files to run, once.
    if (result.signal || result.error) return status;
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTests({ args: process.argv.slice(2) });
}
