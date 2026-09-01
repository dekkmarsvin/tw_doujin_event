// Selects the test files affected by a set of changed files, so an agent can
// verify a one-module change without running all 60.
//
// Edges are recovered statically. Most are mechanical: 41 tests load repo code
// through `environment.runner.import("/app/x.ts")`, the rest use plain relative
// imports or `new URL("../x", import.meta.url)`. Anything a scan cannot resolve
// is declared in tests/tiers.json under "deps". A test with neither a scanned
// nor a declared edge always runs, and is reported — silence is never treated
// as "nothing depends on this".
import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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
  /^tests\/tiers\.json$/,
  /^tests\/helpers\//,
  /^scripts\/select-tests\.mjs$/,
  /^\.github\/workflows\//,
];

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

export async function buildTestMap() {
  const tiers = JSON.parse(await readFile(path.join(ROOT, "tests/tiers.json"), "utf8"));
  const declared = tiers.deps ?? {};
  const graph = await buildSourceGraph();
  const allFiles = [...graph.keys()];
  for (const directory of DATA_DIRS) allFiles.push(...(await listFiles(directory)));

  const testFiles = ["module", "d1", "cli", "artifact"].flatMap((tier) => tiers[tier] ?? []);

  // tiers.json is the only manifest `npm test` reads, so a file missing from it
  // would never run anywhere, including CI. Refuse to run rather than skip.
  const onDisk = (await readdir(path.join(ROOT, "tests"))).filter((file) => file.endsWith(".test.mjs")).sort();
  const listed = [...testFiles].sort();
  const missing = onDisk.filter((file) => !listed.includes(file));
  const stale = listed.filter((file) => !onDisk.includes(file));
  if (missing.length > 0 || stale.length > 0) {
    const detail = [
      missing.length > 0 ? `absent from tests/tiers.json: ${missing.join(", ")}` : "",
      stale.length > 0 ? `listed but not on disk: ${stale.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`tests/tiers.json is out of sync with tests/ — ${detail}`);
  }
  const map = new Map();
  const unresolved = [];
  for (const testFile of testFiles) {
    const scanned = await scanTestEdges(`tests/${testFile}`);
    for (const extra of declared[testFile] ?? []) {
      const resolved = await resolveRepoPath(extra);
      if (resolved) scanned.add(resolved);
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
    return { selected: testFiles, reason: `full suite: ${forcedBy} invalidates the selection`, unresolved };
  }

  const selected = new Set(unresolved);
  for (const file of changed) {
    if (file.startsWith("tests/") && file.endsWith(".test.mjs")) {
      const name = file.slice("tests/".length);
      if (map.has(name)) selected.add(name);
      continue;
    }
    for (const [testFile, dependencies] of map) {
      if (dependencies.has(file)) selected.add(testFile);
    }
  }
  return {
    selected: testFiles.filter((file) => selected.has(file)),
    reason: `${changed.length} changed file(s)`,
    unresolved,
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

  const { selected, reason, unresolved } = await selectTests(changed);
  if (args.includes("--explain")) {
    console.error(`changed: ${changed.length} file(s)`);
    console.error(`reason: ${reason}`);
    if (unresolved.length > 0) console.error(`always-run (no resolvable edge): ${unresolved.join(", ")}`);
    console.error(`selected: ${selected.length}/${(await buildTestMap()).testFiles.length}`);
  }
  console.log(selected.map((file) => `tests/${file}`).join(" "));
}
