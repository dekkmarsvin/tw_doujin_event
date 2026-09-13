// Runs the browser acceptance journeys behind one command.
//
//   node scripts/run-browser-tests.mjs                 representative sizes
//   node scripts/run-browser-tests.mjs --matrix full   every size and scale
//   node scripts/run-browser-tests.mjs --matrix none   interaction journeys only
//
// Journeys live in tests/browser/*.mjs. Each declares the staged data it needs
// with a `// staged-data: pinned|fixture` line; pinned is the default.
//
// Before this script the journeys were real but unreachable: a maintainer had
// to stage FF47, start Vite in another shell, and assemble PLAYWRIGHT_MODULE,
// MAP_TEST_URL and BROWSER_CHANNEL from a QA report to discover how to run
// them. That is why they were never a gate. Everything that recipe did by hand
// happens here, so the journeys can be rerun by name like every other tier.
//
// Browsers stay out of package.json on purpose: `npm ci` must keep working, and
// the Node suite must keep running, on a machine with no browser at all. So
// Playwright is resolved wherever it already is rather than depended upon, and
// its absence is reported as the one command that fixes it.
//
// Which journeys exist is read off disk, and which data each one needs is read
// out of its own source, for the same reason `scripts/run-tests.mjs` derives
// its tiers that way: a journey cannot be left out of the gate by forgetting to
// register it somewhere.
import { spawn, spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOURNEYS = path.join(ROOT, "tests", "browser");
const MATRIX_MODES = ["representative", "full", "none"];
// A full run writes the size matrix QA quotes; a PR run must not overwrite it
// with its two rows, so each mode owns its own directory.
const OUTPUT = { representative: "outputs/map-viewport-pr", full: "outputs/map-viewport", none: "outputs/map-viewport-state" };

// What a journey needs staged before it can mean anything. The pinned event is
// the real catalogue the viewport journey measures; the fixtures carry the
// scenarios real data has no business containing — a retired booth, a circle
// with no picture — and need no network.
const STAGING = {
  pinned: { fetch: ["ff47"], stage: ["ff47"], label: "pinned ff47" },
  fixture: { fetch: null, stage: ["--fixture", "sample", "sample-two"], label: "fixtures sample, sample-two" },
};
const DECLARED_DATA = /^\/\/ staged-data: (\w+)/m;

const args = process.argv.slice(2);
const matrixIndex = args.indexOf("--matrix");
const matrix = matrixIndex === -1 ? "representative" : args[matrixIndex + 1];
if (!MATRIX_MODES.includes(matrix)) {
  console.error(`usage: run-browser-tests.mjs [--matrix ${MATRIX_MODES.join("|")}]`);
  process.exit(2);
}

// The staging scripts are invoked directly rather than through `npm run`: npm
// is a shell script on Windows, and spawning it needs `shell: true`, which
// concatenates rather than escapes its arguments.
function run(script, scriptArguments) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...scriptArguments], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Checked here so a missing browser is one clear line rather than a stack
// trace out of the journeys. A caller's own PLAYWRIGHT_MODULE is passed
// through untouched; otherwise the journeys import the bare specifier, which
// keeps Playwright's package exports in play — resolving to its CommonJS entry
// and handing that path over would bypass them.
function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
  try {
    createRequire(path.join(ROOT, "package.json")).resolve("playwright");
    return null;
  } catch {
    console.error("Playwright is not installed. It is deliberately not a devDependency, so install it once:\n\n  npm run test:browser:install\n\nOr point PLAYWRIGHT_MODULE at an existing installation.");
    process.exit(2);
  }
}

const playwright = resolvePlaywright();

// Grouped by the data they need, because staging is one set at a time: each
// group stages, serves and runs together before the next replaces it.
async function discover() {
  const files = (await readdir(JOURNEYS, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
  const groups = new Map();
  for (const file of files) {
    const declared = DECLARED_DATA.exec(await readFile(path.join(JOURNEYS, file), "utf8"))?.[1] ?? "pinned";
    if (!STAGING[declared]) throw new Error(`tests/browser/${file} declares unknown staged-data "${declared}"; expected ${Object.keys(STAGING).join(" or ")}`);
    groups.set(declared, [...(groups.get(declared) ?? []), file]);
  }
  return groups;
}

const groups = await discover();
// A caller who supplies a URL owns that server and the data behind it, so
// nothing is staged under them. A deployment serves published events, never
// fixtures, so only the pinned journeys can mean anything against one.
const external = process.env.MAP_TEST_URL;
if (external && groups.size > 1) {
  console.error(`MAP_TEST_URL is set, so only the pinned journeys run; ${[...groups.keys()].filter((key) => key !== "pinned").join(", ")} journeys need staged fixtures this script is not allowed to replace.`);
  for (const key of [...groups.keys()]) if (key !== "pinned") groups.delete(key);
}

function stage(mode) {
  const { fetch: fetchEvents, stage: stageArguments, label } = STAGING[mode];
  // An existing directory may belong to an older pin or contain incomplete
  // data; always refresh before staging, and stop if verification fails rather
  // than running against the previous checkout.
  for (const event of fetchEvents ?? []) {
    console.error(`staging ${event}: fetching the pinned event data`);
    run("fetch-event-data.mjs", [event]);
  }
  console.error(`staging ${label} into public/data/events (\`npm test\` restages the fixture afterwards)`);
  run("stage-event-data.mjs", stageArguments);
}

// The Vite CLI rather than an in-process `createServer`: embedding it makes the
// dependency scan race its own teardown, and the journeys then time out
// navigating to a server that never finishes pre-bundling. The CLI is also what
// the runbook tells a maintainer to start by hand, so the gate and the manual
// recipe exercise the same server.
async function freePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serve() {
  if (external) return { base: external, stop() {} };
  const port = Number(process.env.MAP_TEST_PORT) || await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.pages.config.ts", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

// Listening is not the same as ready to answer a browser. Fetching the page
// proves the port is live; fetching the entry module then makes Vite discover
// and pre-bundle the dependency graph, which on a cold cache takes longer than
// the journeys' ten-second navigation timeout. Paying it here rather than
// inside the first `page.goto` is the difference between a warm-up and a
// failure that looks like the app is broken.
async function ready(url, seconds) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    if (attempt >= seconds * 2) throw new Error(`${url} did not answer within ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const failures = [];
for (const [mode, files] of groups) {
  if (!external) stage(mode);
  const server = await serve();
  try {
    await ready(server.base, 60);
    if (!external) {
      console.error(`serving ${server.base} — pre-bundling dependencies`);
      await ready(`${server.base}/main.tsx`, 180);
    }
    for (const file of files) {
      console.error(`\n— ${file} (${STAGING[mode].label})`);
      const result = spawnSync(process.execPath, [`tests/browser/${file}`], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, ...(playwright ? { PLAYWRIGHT_MODULE: playwright } : {}), MAP_TEST_URL: server.base, MAP_TEST_MATRIX: matrix, MAP_TEST_OUTPUT: process.env.MAP_TEST_OUTPUT ?? OUTPUT[matrix] },
      });
      // Every journey runs even after one fails: a single report of what is
      // broken beats discovering the next failure only on the next push.
      if (result.status !== 0) failures.push(file);
    }
  } finally {
    server.stop();
  }
}

if (failures.length) {
  console.error(`\n${failures.length} browser journey(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.error(`\nAll browser journeys passed (${[...groups.values()].flat().length} files).`);
