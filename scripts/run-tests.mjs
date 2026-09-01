// Runs one tier, or just the tests affected by the working tree. Tier
// membership comes from each test's own source — see scripts/select-tests.mjs.
// Defaults to the dot reporter: a full run is hundreds of cases, and the spec
// reporter's one line per passing case is noise everywhere except CI.
//
//   node scripts/run-tests.mjs module          one tier
//   node scripts/run-tests.mjs module d1 cli   several
//   node scripts/run-tests.mjs --changed       tiers touched by the diff
//   node scripts/run-tests.mjs --all --spec    what `npm test` runs
//
// The artifact tier reads dist/, so it is skipped unless asked for by name (or
// with --all). When --changed selects an artifact test, that is reported rather
// than silently dropped: dist/ may be stale or absent.
//
// Tiers are derived from the test sources, not declared, so `--all` covers
// every tests/*.test.mjs on disk by construction — a new test file cannot be
// left out of the run, least of all in CI, which is `--all`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { changedFilesFrom, deriveTiers, selectTests, TIER_NAMES } from "./select-tests.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const reporter = args.includes("--spec") ? "spec" : "dot";
const isolation = args.includes("--isolate") ? "process" : null;
const tiers = await deriveTiers();

function filesForTiers(names) {
  return names.flatMap((name) => (tiers[name] ?? []).map((file) => `tests/${file}`));
}

let files;
let label;

if (args.includes("--all")) {
  files = filesForTiers(TIER_NAMES);
  label = "all tiers";
} else if (args.includes("--changed")) {
  const { selected, reason, unresolved, uncovered } = await selectTests(changedFilesFrom());
  const artifactTests = new Set((tiers.artifact ?? []).map((file) => `tests/${file}`));
  const all = selected.map((file) => `tests/${file}`);
  files = all.filter((file) => !artifactTests.has(file));
  const deferred = all.filter((file) => artifactTests.has(file));
  label = `changed (${reason})`;
  if (unresolved.length > 0) {
    console.error(`note: always-run tests with no resolvable edge: ${unresolved.join(", ")}`);
  }
  if (deferred.length > 0) {
    console.error(`note: ${deferred.join(", ")} also affected; run \`npm run test:artifact\` to cover dist/.`);
  }
  // An empty run is a real answer here, but only ever an explained one.
  if (uncovered.length > 0) {
    console.error(`note: no test covers ${uncovered.join(", ")} — that is a coverage gap, not a pass.`);
  }
} else {
  const named = args.filter((argument) => TIER_NAMES.includes(argument));
  if (named.length === 0) {
    console.error(`usage: run-tests.mjs [${TIER_NAMES.join("|")}] | --changed | --all`);
    process.exit(2);
  }
  files = filesForTiers(named);
  label = named.join(", ");
}

if (files.length === 0) {
  console.log(`no tests in this run (${label})`);
  process.exit(0);
}

console.error(`running ${files.length} test file(s) — ${label}`);
const nodeArgs = ["--test", `--test-reporter=${reporter}`];
if (isolation) nodeArgs.push(`--test-isolation=${isolation}`);
const result = spawnSync(process.execPath, [...nodeArgs, ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(result.status ?? 1);
