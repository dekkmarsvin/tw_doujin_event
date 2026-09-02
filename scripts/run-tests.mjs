// Runs one tier of the suite, or all of them.
//
//   node scripts/run-tests.mjs module          one tier
//   node scripts/run-tests.mjs module d1 cli   several
//   node scripts/run-tests.mjs --all --spec    what `npm test` runs
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

async function deriveTiers() {
  const tiers = Object.fromEntries(TIER_NAMES.map((name) => [name, []]));
  const files = (await readdir(path.join(ROOT, "tests"))).filter((file) => file.endsWith(".test.mjs")).sort();
  for (const file of files) {
    const source = await readFile(path.join(ROOT, "tests", file), "utf8");
    tiers[TIER_SIGNALS.find(([, signal]) => signal.test(source))?.[0] ?? "module"].push(file);
  }
  return tiers;
}

const args = process.argv.slice(2);
const reporter = args.includes("--spec") ? "spec" : "dot";
const tiers = await deriveTiers();

const named = args.includes("--all") ? TIER_NAMES : args.filter((argument) => TIER_NAMES.includes(argument));
if (named.length === 0) {
  console.error(`usage: run-tests.mjs [${TIER_NAMES.join("|")}] | --all`);
  process.exit(2);
}

const files = named.flatMap((name) => (tiers[name] ?? []).map((file) => `tests/${file}`));
const label = args.includes("--all") ? "all tiers" : named.join(", ");
if (files.length === 0) {
  console.log(`no tests in this run (${label})`);
  process.exit(0);
}

console.error(`running ${files.length} test file(s) — ${label}`);
const result = spawnSync(process.execPath, ["--test", `--test-reporter=${reporter}`, ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(result.status ?? 1);
