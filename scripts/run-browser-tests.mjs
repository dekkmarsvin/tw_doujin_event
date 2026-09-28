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
import { readFileSync } from "node:fs";
import { readdir, readFile, mkdir, writeFile, open } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOURNEYS = path.join(ROOT, "tests", "browser");
// Resolved rather than pointed at, as run-local-portal.mjs does for wrangler: a
// git worktree has no `node_modules` of its own and takes the checkout's, so a
// path under ROOT finds nothing.
const viteBin = () => {
  const manifest = createRequire(path.join(ROOT, "package.json")).resolve("vite/package.json");
  return path.join(path.dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.vite);
};
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
  const build = spawnSync(process.execPath, [viteBin(), "build", "--config", "vite.pages.config.ts"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) process.exit(build.status ?? 1);
  // The circle introduction pages exist only once this step writes them, and
  // it is also what takes the page script's template back out of dist.
  run("build-discovery-pages.mjs", []);
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
function killTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
  }
  else {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}

async function stopChild(child, closed) {
  killTree(child);
  let timer;
  const done = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
  clearTimeout(timer);
  if (!done) { killTree(child, "SIGKILL"); await closed; }
}

const output = path.resolve(process.env.MAP_TEST_OUTPUT ?? OUTPUT[matrix]);
const report = { matrix, node: process.version, startedAt: new Date().toISOString(), groups: [] };
let activeServer;
let activeJourney;
let interrupted;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  interrupted = signal;
  killTree(activeJourney);
  activeServer?.stop();
});

// Wrangler's debug file includes CLI bindings. Keep its raw file outside the
// uploaded directory and sanitize both it and the bounded process output.
const privateValues = Object.entries(process.env)
  .filter(([key, value]) => /secret|token|password|api.?key/i.test(key) && value.length >= 4)
  .map(([, value]) => value);
try {
  const local = await readFile(path.join(ROOT, "config/local-portal.env"), "utf8");
  for (const line of local.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (/secret|token|pepper|email|recipients/i.test(line.slice(0, separator))) privateValues.push(line.slice(separator + 1));
  }
} catch { /* runner fixtures and external reader checks need no portal config */ }
function sanitized(text) {
  for (const value of privateValues.filter(value => value.length >= 4)) text = text.split(value).join("[redacted]");
  return text.replace(/https?:\/\/[^\s"'<>]+/g, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "[url]"; }
  }).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/^.*(?:authorization|cookie|\bbody\b|\bheaders\b|\b(?:secret|token|password|pepper)\b).*$/gim, "[sensitive log line omitted]");
}
async function logTail(file) {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const bytes = Buffer.alloc(Math.min(size, 512 * 1024));
    await handle.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    return bytes.toString("utf8");
  } finally { await handle.close(); }
}

async function serve(mode) {
  if (external) return { base: external, assertRunning() {}, stop() {}, saveLogs: async () => {}, exited: new Promise(() => {}) };
  const spawned = ENVIRONMENTS[mode].server === "portal"
    // The same launcher `npm run dev:portal` uses, so the gate and the manual
    // recipe stand up the same isolated environment — local D1 and R2, always-
    // pass Turnstile, mail captured in D1, nothing remote and no mail sent.
    ? { command: [path.join(ROOT, "scripts", "run-local-portal.mjs")], base: PORTAL_ORIGIN }
    : await (async () => {
      const port = Number(process.env.MAP_TEST_PORT) || await freePort();
      return { command: [viteBin(), "--config", "vite.pages.config.ts", "--port", String(port), "--strictPort"], base: `http://localhost:${port}` };
    })();
  const log = { startedAt: new Date().toISOString(), base: spawned.base, exit: null };
  let stdout = "", stderr = "";
  const rawLog = path.join(ROOT, ".tmp", `browser-${process.pid}-${mode}.log`);
  await mkdir(path.dirname(rawLog), { recursive: true });
  const child = spawn(process.execPath, spawned.command, {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    env: { ...process.env, WRANGLER_LOG_PATH: rawLog, WRANGLER_LOG_SANITIZE: "true", WRANGLER_WRITE_LOGS: "true" },
  });
  child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-512 * 1024); });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-512 * 1024); });
  const exited = new Promise(resolve => {
    child.once("error", error => { log.exit = { error: sanitized(error.message), at: new Date().toISOString() }; resolve(log.exit); });
    child.once("exit", (code, signal) => { log.exit = { code, signal, at: new Date().toISOString() }; resolve(log.exit); });
  });
  const closed = new Promise(resolve => child.once("close", resolve));
  let stopping;
  return {
    base: spawned.base, log, exited,
    assertRunning() { if (log.exit) throw new Error(`${mode} server exited: ${JSON.stringify(log.exit)}`); },
    stop() { log.stopRequestedAt ??= new Date().toISOString(); return stopping ??= stopChild(child, closed); },
    async saveLogs() {
      await this.stop();
      let debug = "";
      try { debug = await logTail(rawLog); } catch { /* Vite has no Wrangler log */ }
      await writeFile(path.join(output, `server-${mode}.log`), sanitized(`STDOUT\n${stdout}\nSTDERR\n${stderr}\nWRANGLER\n${debug}`));
    },
  };
}

// Listening is not the same as ready to answer a browser. Fetching the page
// proves the port is live; fetching the entry module then makes Vite discover
// and pre-bundle the dependency graph, which on a cold cache takes longer than
// the journeys' ten-second navigation timeout. Paying it here rather than
// inside the first `page.goto` is the difference between a warm-up and a
// failure that looks like the app is broken.
async function ready(url, seconds, server) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    server.assertRunning();
    if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch { /* not up yet */ }
    server.assertRunning();
    if (Date.now() >= deadline) throw new Error(`${url} did not answer within ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const failures = [];
await mkdir(output, { recursive: true });
for (const [mode, files] of groups) {
  if (interrupted) break;
  const portal = ENVIRONMENTS[mode].server === "portal";
  if (!external) {
    if (portal) await preparePortal();
    else stage(mode);
  }
  const group = { mode, journeys: files.map(file => ({ file, status: "not_run" })) };
  report.groups.push(group);
  const server = activeServer = await serve(mode);
  if (server.log) group.server = server.log;
  try {
    // The portal serves a built bundle, so it is ready when it answers; only
    // the Vite environments have a dependency graph to pre-bundle first.
    await ready(portal ? `${server.base}/api/auth/config` : server.base, portal ? 180 : 60, server);
    if (!external && !portal) {
      console.error(`serving ${server.base} — pre-bundling dependencies`);
      await ready(`${server.base}/main.tsx`, 180, server);
    }
    if (portal) console.error(`serving ${server.base} — isolated local portal`);
    for (const entry of group.journeys) {
      server.assertRunning();
      if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
      const { file } = entry;
      console.error(`\n— ${file} (${ENVIRONMENTS[mode].label})`);
      entry.startedAt = new Date().toISOString();
      const child = activeJourney = spawn(process.execPath, [`tests/browser/${file}`], {
        cwd: ROOT,
        stdio: "inherit",
        detached: process.platform !== "win32",
        env: { ...process.env, ...(playwright ? { PLAYWRIGHT_MODULE: playwright } : {}), MAP_TEST_URL: server.base, MAP_TEST_MATRIX: matrix, MAP_TEST_OUTPUT: process.env.MAP_TEST_OUTPUT ?? OUTPUT[matrix] },
      });
      const completed = new Promise(resolve => {
        child.once("error", error => resolve({ code: 1, error: sanitized(error.message) }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const result = await Promise.race([completed, server.exited.then(() => null)]);
      entry.completedAt = new Date().toISOString();
      if (!result) {
        entry.status = "interrupted_by_server_exit";
        await stopChild(child, completed);
        server.assertRunning();
      }
      activeJourney = undefined;
      entry.status = result.code === 0 ? "passed" : "failed";
      entry.result = result;
      // Every journey runs even after one fails: a single report of what is
      // broken beats discovering the next failure only on the next push.
      if (result.code !== 0) failures.push(file);
    }
    server.assertRunning();
  } catch (error) {
    group.infrastructureFailure = sanitized(error.message);
    console.error(`\n${mode} environment failed: ${group.infrastructureFailure}; remaining journeys in this group were not run.`);
  } finally {
    await server.stop();
    await server.saveLogs();
    activeServer = undefined;
    await writeFile(path.join(output, "browser-runner-report.json"), JSON.stringify(report, null, 2));
  }
}

if (failures.length) {
  console.error(`\n${failures.length} browser journey(s) failed: ${failures.join(", ")}`);
}
if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
else if (failures.length || report.groups.some(group => group.infrastructureFailure)) process.exitCode = 1;
else console.error(`\n${requested.size ? "Selected" : "All eligible"} browser journeys passed (${[...groups.values()].flat().length} files).`);
