// Runs the browser acceptance journeys behind one command.
//
//   node scripts/run-browser-tests.mjs                 representative sizes
//   node scripts/run-browser-tests.mjs --matrix full   every size and scale
//   node scripts/run-browser-tests.mjs --matrix none   interaction journeys only
//   node scripts/run-browser-tests.mjs --journey reader-thumbnails
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
// npm ci installs locked Playwright without downloading a browser. Chromium
// is installed separately, only where the browser journeys will run.
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
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOURNEYS = path.join(ROOT, "tests", "browser");
const MATRIX_MODES = ["representative", "full", "none"];
// A full run writes the size matrix QA quotes; a PR run must not overwrite it
// with its two rows, so each mode owns its own directory.
const OUTPUT = { representative: "outputs/map-viewport-pr", full: "outputs/map-viewport", none: "outputs/map-viewport-state" };

// What a journey needs standing up before it can mean anything. The pinned
// event is the real catalogue the viewport journey measures; the fixtures carry
// the scenarios real data has no business containing — a retired booth, a
// circle with no picture — and need no network. The portal is a different
// server altogether: `/api/*` only exists under Pages Functions, so a Vite dev
// server answers a sign-in with the reader's HTML instead.
const ENVIRONMENTS = {
  pinned: { fetch: ["ff47"], stage: ["ff47"], server: "vite", label: "pinned ff47" },
  fixture: { stage: ["--fixture", "sample", "sample-two"], server: "vite", label: "fixtures sample, sample-two" },
  portal: { server: "portal", label: "local portal (sample fixture)" },
};
const DECLARED_DATA = /^\/\/ staged-data: (\w+)/m;
// The local portal's own config pins this origin (thumbnails are served from
// it), so unlike the Vite journeys it cannot be moved to a free port.
const PORTAL_ORIGIN = "http://127.0.0.1:8788";

let matrix;
let requested;
try {
  const { values } = parseArgs({ options: {
    matrix: { type: "string", default: "representative" },
    journey: { type: "string", multiple: true, default: [] },
  }, strict: true, allowPositionals: false });
  matrix = values.matrix;
  requested = new Set(values.journey.map(name => name.endsWith(".mjs") ? name : `${name}.mjs`));
  if (!MATRIX_MODES.includes(matrix)) throw new Error(`Unknown matrix: ${matrix}`);
} catch (error) {
  console.error(`${error.message}\nusage: run-browser-tests.mjs [--matrix ${MATRIX_MODES.join("|")}] [--journey name]...`);
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
    console.error("Playwright is not installed. Run npm ci, then npm run test:browser:install to install its matching Chromium. PLAYWRIGHT_MODULE may override the module for an explicit diagnostic environment.");
    process.exit(2);
  }
}

// Grouped by the data they need, because staging is one set at a time: each
// group stages, serves and runs together before the next replaces it.
async function discover() {
  const files = (await readdir(JOURNEYS, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
  for (const name of requested) {
    if (!files.includes(name)) throw new Error(`Unknown browser journey: ${name}. Use a filename from tests/browser (with or without .mjs).`);
  }
  const groups = new Map();
  for (const file of files) {
    if (requested.size && !requested.has(file)) continue;
    const declared = DECLARED_DATA.exec(await readFile(path.join(JOURNEYS, file), "utf8"))?.[1] ?? "pinned";
    if (!ENVIRONMENTS[declared]) throw new Error(`tests/browser/${file} declares unknown staged-data "${declared}"; expected ${Object.keys(ENVIRONMENTS).join(" or ")}`);
    groups.set(declared, [...(groups.get(declared) ?? []), file]);
  }
  return groups;
}

const groups = await discover();
// A caller who supplies a URL owns that server and the data behind it, so
// nothing is staged under them. A deployment serves published events, never
// fixtures, so only the pinned journeys can mean anything against one.
const external = process.env.MAP_TEST_URL;
if (external && [...groups.keys()].some(key => key !== "pinned")) {
  if (requested.size) throw new Error("Selected fixture/portal journeys cannot use MAP_TEST_URL; unset it so the runner prepares their isolated environment.");
  console.error(`MAP_TEST_URL is set, so only the pinned journeys run; ${[...groups.keys()].filter((key) => key !== "pinned").join(", ")} journeys need staged fixtures this script is not allowed to replace.`);
  for (const key of [...groups.keys()]) if (key !== "pinned") groups.delete(key);
}
if (!groups.size) throw new Error("No browser journeys are eligible; refusing an empty successful run.");
const playwright = resolvePlaywright();

function stage(mode) {
  const { fetch: fetchEvents, stage: stageArguments, label } = ENVIRONMENTS[mode];
  if (!stageArguments) return;
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

// The portal serves the built site through Pages Functions, so it needs a
// current `dist`, and it needs to start from nothing: accounts, claims and
// captured mail all persist in the local D1, and a journey that asserts "this
// circle is unclaimed" would otherwise pass once and fail on every rerun.
async function preparePortal() {
  const { rm } = await import("node:fs/promises");
  // A portal already on the port would serve its own database to the journeys
  // and survive the wipe below, so say so rather than half-running against it.
  try {
    await fetch(`${PORTAL_ORIGIN}/api/auth/config`, { signal: AbortSignal.timeout(2000) });
    console.error(`Something is already serving ${PORTAL_ORIGIN}. The portal journeys need that port and a database they can clear; stop \`npm run dev:portal\` and rerun.`);
    process.exit(2);
  } catch { /* nothing listening, which is what we want */ }

  console.error("portal: building dist and clearing the isolated local D1");
  run("stage-event-data.mjs", ["--fixture", "sample"]);
  const build = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--config", "vite.pages.config.ts"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) process.exit(build.status ?? 1);
  run("build-service-worker.mjs", []);
  run("build-privacy-page.mjs", []);

  // Accounts, claims, captured mail and the login-link rate limit all live in
  // this database. Journeys assert on a circle that has not been claimed yet
  // and sign in a fixed number of times, so a run that inherits the last one's
  // rows passes once and then fails for reasons that have nothing to do with
  // the code. Windows releases the files a beat after the process dies.
  const local = path.join(ROOT, ".wrangler", "local-portal");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(local, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 10) throw new Error(`could not clear ${local}: ${error.message}. A workerd process is probably still holding it.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
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

// Killing the launcher is not enough: it runs Wrangler, which runs workerd, and
// an orphaned workerd keeps both the port and the local D1 files open — so the
// next run cannot bind 8788 and cannot clear the database it must start empty.
// Neither platform kills a tree by default, so each is asked its own way.
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function serve(mode) {
  if (external) return { base: external, stop() {} };
  const spawned = ENVIRONMENTS[mode].server === "portal"
    // The same launcher `npm run dev:portal` uses, so the gate and the manual
    // recipe stand up the same isolated environment — local D1 and R2, always-
    // pass Turnstile, mail captured in D1, nothing remote and no mail sent.
    ? { command: [path.join(ROOT, "scripts", "run-local-portal.mjs")], base: PORTAL_ORIGIN }
    : await (async () => {
      const port = Number(process.env.MAP_TEST_PORT) || await freePort();
      return { command: [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.pages.config.ts", "--port", String(port), "--strictPort"], base: `http://localhost:${port}` };
    })();
  // Its own process group on POSIX, so the whole group can be signalled at once.
  const child = spawn(process.execPath, spawned.command, { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], detached: process.platform !== "win32" });
  return { base: spawned.base, stop: () => killTree(child) };
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
  const portal = ENVIRONMENTS[mode].server === "portal";
  if (!external) {
    if (portal) await preparePortal();
    else stage(mode);
  }
  const server = await serve(mode);
  try {
    // The portal serves a built bundle, so it is ready when it answers; only
    // the Vite environments have a dependency graph to pre-bundle first.
    await ready(portal ? `${server.base}/api/auth/config` : server.base, portal ? 180 : 60);
    if (!external && !portal) {
      console.error(`serving ${server.base} — pre-bundling dependencies`);
      await ready(`${server.base}/main.tsx`, 180);
    }
    if (portal) console.error(`serving ${server.base} — isolated local portal`);
    for (const file of files) {
      console.error(`\n— ${file} (${ENVIRONMENTS[mode].label})`);
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
console.error(`\n${requested.size ? "Selected" : "All eligible"} browser journeys passed (${[...groups.values()].flat().length} files).`);
