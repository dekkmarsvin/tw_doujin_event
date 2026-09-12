// Runs the browser acceptance journeys behind one command.
//
//   node scripts/run-browser-tests.mjs                 representative sizes
//   node scripts/run-browser-tests.mjs --matrix full   every size and scale
//   node scripts/run-browser-tests.mjs --matrix none   interaction journeys only
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
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MATRIX_MODES = ["representative", "full", "none"];
// A full run writes the size matrix QA quotes; a PR run must not overwrite it
// with its two rows, so each mode owns its own directory.
const OUTPUT = { representative: "outputs/map-viewport-pr", full: "outputs/map-viewport", none: "outputs/map-viewport-state" };
const EVENT = "ff47";

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

// A caller who supplies a URL owns that server and the data behind it; staging
// under them would swap the event out from beneath a deployment they chose.
const external = process.env.MAP_TEST_URL;
if (!external) {
  // The journeys assert against real FF47 booths, so the fixture event cannot
  // stand in. The fetch is the same pinned, per-file SHA-256 verified one that
  // `build:production` performs, and it is skipped once the pin is on disk.
  if (!existsSync(path.join(ROOT, ".event-data", EVENT))) {
    console.error(`staging ${EVENT}: fetching the pinned event data`);
    run("fetch-event-data.mjs", [EVENT]);
  }
  console.error(`staging ${EVENT} into public/data/events (this replaces the fixture staging; \`npm test\` restages the fixture)`);
  run("stage-event-data.mjs", [EVENT]);
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

const port = external ? null : Number(process.env.MAP_TEST_PORT) || await freePort();
const server = external ? null : spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.pages.config.ts", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const base = external ?? `http://localhost:${port}`;

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
let result;
try {
  await ready(base, 60);
  if (server) {
    console.error(`serving ${base} — pre-bundling dependencies`);
    await ready(`${base}/main.tsx`, 180);
  }
  result = spawnSync(process.execPath, ["tests/browser/map-viewport.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...(playwright ? { PLAYWRIGHT_MODULE: playwright } : {}), MAP_TEST_URL: base, MAP_TEST_MATRIX: matrix, MAP_TEST_OUTPUT: process.env.MAP_TEST_OUTPUT ?? OUTPUT[matrix] },
  });
} finally {
  server?.kill();
}
process.exit(result?.status ?? 1);
