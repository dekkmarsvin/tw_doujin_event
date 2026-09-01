// Selects the test files affected by a set of changed files, so an agent can
// verify a one-module change without running all 60.
//
// Edges are recovered statically. Most are mechanical: most tests load repo code
// through `environment.runner.import("/app/x.ts")`, the rest use plain relative
// imports or `new URL("../x", import.meta.url)`. Anything a scan cannot resolve
// is declared in tests/test-deps.json. A test with neither a scanned nor a
// declared edge always runs, and is reported — silence is never treated as
// "nothing depends on this".
//
// The same rule applies from the other side. A changed file the model has no
// view of — outside every scanned directory — selects the full suite; one the
// model does cover but that no test reaches is reported as uncovered, not
// passed off as a clean run.
import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TIER_NAMES = ["module", "d1", "cli", "artifact"];
const SOURCE_DIRS = ["app", "db", "functions", "scripts", "worker", "workers", "build"];
const DATA_DIRS = ["fixtures", "data", "docs", "monitoring", "public", ".github"];
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json", ".css"];
const RESOLVE_INDEXES = ["/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

// A change to any of these invalidates the whole selection: run everything.
const ALWAYS_FULL = [
  /^package(-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^vite[^/]*\.config\.ts$/,
  /^eslint\.config\.mjs$/,
  /^postcss\.config\.mjs$/,
  /^next\.config\.ts$/,
  /^drizzle\.config\.ts$/,
  /^wrangler\.jsonc$/,
  // Anything under tests/ that is not itself a test file: the declared-edge
  // file, and any support file a test might load without naming it in a way a
  // scan can see.
  /^tests\/(?!.*\.test\.mjs$)/,
  /^scripts\/select-tests\.mjs$/,
  /^scripts\/run-tests\.mjs$/,
  /^\.github\/workflows\//,
];

// Paths the selector can reason about: it either walks their imports or lists
// them as data. A changed file outside all of them has no modelled edges, so
// its absence from every dependency set proves nothing — see selectTests.
const MODELLED_DIRS = [...SOURCE_DIRS, ...DATA_DIRS];

const posix = (value) => value.split(path.sep).join("/");

async function statOrNull(relative) {
  try {
    return await stat(path.join(ROOT, relative));
  } catch {
    return null;
  }
}

// Turn a specifier into the repo-relative file it names, trying the extensions
// TypeScript and Vite leave off. A trailing slash survives as a directory edge.
async function resolveRepoPath(candidate) {
  const normalized = posix(path.normalize(candidate)).replace(/^\.\//, "");
  if (normalized.startsWith("..") || normalized === "" || path.isAbsolute(normalized)) return null;
  const wantsDirectory = candidate.endsWith("/");
  for (const extension of RESOLVE_EXTENSIONS) {
    const attempt = `${normalized}${extension}`;
    const stats = await statOrNull(attempt);
    if (!stats) continue;
    if (stats.isFile() && !wantsDirectory) return attempt;
    if (stats.isDirectory() && extension === "") return `${normalized.replace(/\/$/, "")}/`;
  }
  for (const index of RESOLVE_INDEXES) {
    const stats = await statOrNull(`${normalized}${index}`);
    if (stats?.isFile()) return `${normalized}${index}`;
  }
  return null;
}

async function listFiles(directory) {
  const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await listFiles(relative)));
    else found.push(relative);
  }
  return found;
}

// file -> repo-relative files it imports, for every source directory.
async function buildSourceGraph() {
  const graph = new Map();
  for (const directory of SOURCE_DIRS) {
    for (const file of await listFiles(directory)) {
      if (!/\.(ts|tsx|mjs|js|jsx)$/.test(file)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const dependencies = new Set();
      for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
        const resolved = await resolveRepoPath(path.join(path.dirname(file), specifier));
        if (resolved) dependencies.add(resolved);
      }
      graph.set(file, dependencies);
    }
  }
  return graph;
}

// Every repo path a test file names, by any of the forms actually in use.
async function scanTestEdges(testFile) {
  const source = await readFile(path.join(ROOT, testFile), "utf8");
  const candidates = new Set();
  const add = (value) => {
    if (value) candidates.add(value);
  };

  // environment.runner.import("/app/x.ts") — the Vite SSR runner edge.
  for (const [, p] of source.matchAll(/runner\.import\(\s*["']\/([^"']+)["']/g)) add(p);
  // import ... from "../scripts/x.mjs" and await import("../scripts/x.mjs")
  for (const [, p] of source.matchAll(/(?:from|import)\s*\(?\s*["']\.\.\/([^"']+)["']/g)) add(p);
  // new URL("../app/x.ts", import.meta.url); a template head such as
  // new URL(`../app/${name}`) yields the directory "app/", which fans out below.
  for (const [, p] of source.matchAll(/new URL\(\s*[`"']\.\.\/([^`"'$]*)/g)) add(p);
  // Bare repo-relative literals: "fixtures/...", "data/...", read("docs/...")
  for (const [, p] of source.matchAll(/["'`]((?:fixtures|data|docs|monitoring|public)\/[^"'`$]+)["'`]/g)) add(p);
  // Spawn targets, as one literal ("scripts/x.mjs") or split across
  // path.join(root, "scripts", "x.mjs") arguments.
  for (const [, p] of source.matchAll(/["'`](scripts\/[\w.-]+\.mjs)["'`]/g)) add(p);
  for (const [, p] of source.matchAll(/["'`]scripts["'`]\s*,\s*["'`]([\w.-]+\.mjs)["'`]/g)) add(`scripts/${p}`);
  // Root-level files a test reads by name, plus .github templates.
  for (const [, p] of source.matchAll(/["'`]([\w.-]+\.(?:html|tsx|jsonc|md)|\.github\/[\w./-]+)["'`]/g)) add(p);

  const edges = new Set();
  for (const candidate of candidates) {
    const resolved = await resolveRepoPath(candidate);
    if (resolved) edges.add(resolved);
  }
  return edges;
}

function expandDirectories(edges, allFiles) {
  const expanded = new Set();
  for (const edge of edges) {
    if (!edge.endsWith("/")) {
      expanded.add(edge);
      continue;
    }
    for (const file of allFiles) {
      if (file.startsWith(edge)) expanded.add(file);
    }
  }
  return expanded;
}

function closure(entries, graph) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dependency of graph.get(current) ?? []) queue.push(dependency);
  }
  return seen;
}

// What each tier costs, and how a test file reveals that it pays it. Ordered
// most expensive first: a test that reads dist/ needs `npm run build` whatever
// else it also does. Matched against import specifiers and the `new URL()` form
// the artifact tests actually use, so a path mentioned inside an unrelated
// string literal is not mistaken for the real thing.
const TIER_SIGNALS = [
  ["artifact", /new URL\(\s*[`"']\.\.\/dist/],
  ["d1", /(?:from|import)\s*\(?\s*["']miniflare["']/],
  ["cli", /(?:from|import)\s*\(?\s*["']node:child_process["']/],
];

export async function listTestFiles() {
  return (await readdir(path.join(ROOT, "tests"))).filter((file) => file.endsWith(".test.mjs")).sort();
}

/** Tier membership is read out of each test's own source rather than a
 *  hand-kept list. A new test file therefore lands in a tier the moment it
 *  exists: there is nothing to register, and no way for a file to be absent
 *  from every tier and so run nowhere — the failure a manifest invites. */
export async function deriveTiers() {
  const tiers = Object.fromEntries(TIER_NAMES.map((name) => [name, []]));
  for (const file of await listTestFiles()) {
    const source = await readFile(path.join(ROOT, "tests", file), "utf8");
    const tier = TIER_SIGNALS.find(([, signal]) => signal.test(source))?.[0] ?? "module";
    tiers[tier].push(file);
  }
  return tiers;
}

export function tierMembers(tiers) {
  return TIER_NAMES.flatMap((tier) => tiers[tier] ?? []);
}

/** Edges no scan can see, keyed by test file. Keys are checked against tests/
 *  because a key naming no real test silently declares nothing. */
export async function readDeclaredDeps() {
  const raw = JSON.parse(await readFile(path.join(ROOT, "tests/test-deps.json"), "utf8"));
  const declared = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "//"));
  const onDisk = await listTestFiles();
  const orphans = Object.keys(declared).filter((file) => !onDisk.includes(file)).sort();
  if (orphans.length > 0) {
    throw new Error(`tests/test-deps.json declares edges for test file(s) that do not exist: ${orphans.join(", ")}`);
  }
  return declared;
}

export async function buildTestMap() {
  const tiers = await deriveTiers();
  const declared = await readDeclaredDeps();
  const graph = await buildSourceGraph();
  const allFiles = [...graph.keys()];
  for (const directory of DATA_DIRS) allFiles.push(...(await listFiles(directory)));

  const testFiles = tierMembers(tiers);
  const map = new Map();
  const unresolved = [];
  for (const testFile of testFiles) {
    const scanned = await scanTestEdges(`tests/${testFile}`);
    for (const extra of declared[testFile] ?? []) {
      const resolved = await resolveRepoPath(extra);
      // A declared edge that resolves to nothing is a stale or mistyped path.
      // Dropping it silently would quietly narrow the selection, which is the
      // one direction this tool must never fail in.
      if (!resolved) throw new Error(`tests/test-deps.json: "${testFile}" names "${extra}", which is not in the repo`);
      scanned.add(resolved);
    }
    const entries = expandDirectories(scanned, allFiles);
    if (entries.size === 0) unresolved.push(testFile);
    map.set(testFile, closure(entries, graph));
  }
  return { tiers, map, unresolved, testFiles };
}

export async function selectTests(changedFiles) {
  const { map, unresolved, testFiles } = await buildTestMap();
  const changed = changedFiles.map(posix).filter(Boolean);

  const forcedBy = changed.find((file) => ALWAYS_FULL.some((pattern) => pattern.test(file)));
  if (forcedBy) {
    return { selected: testFiles, reason: `full suite: ${forcedBy} invalidates the selection`, unresolved, uncovered: [] };
  }

  // Every path a dependency set could possibly name. A changed file inside a
  // modelled directory but outside this set is genuinely untested; one outside
  // the modelled directories is simply invisible to the scan, and those two
  // cases must not be answered the same way.
  const modelled = new Set();
  for (const dependencies of map.values()) for (const file of dependencies) modelled.add(file);

  const invisible = changed.filter((file) => {
    if (modelled.has(file)) return false;
    if (file.startsWith("tests/")) return false;
    return !MODELLED_DIRS.some((directory) => file.startsWith(`${directory}/`));
  });
  if (invisible.length > 0) {
    return {
      selected: testFiles,
      reason: `full suite: ${invisible[0]} is outside the dependency model`,
      unresolved,
      uncovered: [],
    };
  }

  const selected = new Set(unresolved);
  const uncovered = [];
  for (const file of changed) {
    if (file.startsWith("tests/") && file.endsWith(".test.mjs")) {
      const name = file.slice("tests/".length);
      if (map.has(name)) selected.add(name);
      continue;
    }
    let covered = false;
    for (const [testFile, dependencies] of map) {
      if (!dependencies.has(file)) continue;
      selected.add(testFile);
      covered = true;
    }
    if (!covered) uncovered.push(file);
  }
  return {
    selected: testFiles.filter((file) => selected.has(file)),
    reason: `${changed.length} changed file(s)`,
    unresolved,
    uncovered,
  };
}

/** Committed + working-tree changes against `base`. Throws if git cannot answer:
 *  an empty answer would silently mean "run nothing". */
export function changedFilesFrom(base = "main") {
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed (${result.status ?? "no exit"}): ${(result.stderr ?? "").trim()}`);
    }
    return result.stdout ?? "";
  };
  const mergeBase = run(["merge-base", "HEAD", base]).trim();
  const committed = run(["diff", "--name-only", mergeBase]).split("\n");
  // Porcelain renames read "R  old -> new"; both sides matter.
  const dirty = run(["status", "--porcelain"]).split("\n").flatMap((line) => {
    const entry = line.slice(3);
    return entry.includes(" -> ") ? entry.split(" -> ") : [entry];
  });
  return [...new Set([...committed, ...dirty].map((line) => line.trim()).filter(Boolean))];
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}select-tests.mjs`);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const filesIndex = args.indexOf("--files");

  const changed = filesIndex === -1
    ? changedFilesFrom(baseIndex === -1 ? "main" : args[baseIndex + 1])
    : args.slice(filesIndex + 1).filter((argument) => !argument.startsWith("--"));

  const { selected, reason, unresolved, uncovered } = await selectTests(changed);
  if (args.includes("--explain")) {
    console.error(`changed: ${changed.length} file(s)`);
    console.error(`reason: ${reason}`);
    if (unresolved.length > 0) console.error(`always-run (no resolvable edge): ${unresolved.join(", ")}`);
    if (uncovered.length > 0) console.error(`no test covers: ${uncovered.join(", ")}`);
    console.error(`selected: ${selected.length}/${(await listTestFiles()).length}`);
  }
  console.log(selected.map((file) => `tests/${file}`).join(" "));
}
